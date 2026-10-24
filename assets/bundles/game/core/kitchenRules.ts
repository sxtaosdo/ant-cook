export interface KitchenStationRule {
  readonly id: string; readonly label: string; readonly upgradeId: string;
  readonly capacityByLevel: readonly number[]; readonly timeMultipliers: readonly number[]; readonly upgradePrices: readonly number[];
}
export interface KitchenIngredientUpgradeRule {
  readonly upgradeId: string; readonly coinsByLevel: readonly number[]; readonly upgradePrices: readonly number[];
}
export interface KitchenToppingRule { readonly id: string; readonly label: string; readonly upgrade?: KitchenIngredientUpgradeRule; }
export interface KitchenRecipeRule {
  readonly toppings?: readonly KitchenToppingRule[];
  readonly orderToppingSets?: readonly (readonly string[])[];
  readonly dishId: string; readonly label: string; readonly stationId: string; readonly cookSeconds: number;
  readonly plateStationId?: string; readonly burnAfterSeconds: number | null; readonly coinsByLevel: readonly number[];
  readonly upgradeId: string; readonly upgradePrices: readonly number[];
}
export interface KitchenLevelRulesOverride {
  readonly levelId: string; readonly customers: KitchenRules['customers']; readonly goal: KitchenRules['goal'];
}
export interface KitchenRules {
  readonly schema: 'cook-kitchen-rules-v1'; readonly source: string; readonly restaurantId: string;
  readonly stations: readonly KitchenStationRule[]; readonly recipes: readonly KitchenRecipeRule[];
  readonly levelOverrides?: readonly KitchenLevelRulesOverride[];
  readonly customers: { readonly count: number | null; readonly activeCapacity: number; readonly itemsPerCustomer: number;
    readonly patienceSeconds: number; readonly partialServeRecoverySeconds: number };
  readonly combo: { readonly windowSeconds: number; readonly bonusCoins: readonly number[] };
  readonly limits: { readonly maxBurnt: number | null; readonly maxDiscarded: number | null; readonly maxLost: number | null };
  readonly goal: { readonly mode: 'timed' | 'customers'; readonly metric: 'coins' | 'dishes' | 'customers';
    readonly target: number | 'all'; readonly starRatios: readonly [number, number, number]; readonly keepEarningsOnFailure: boolean };
}

/** Validate external configuration; no timing, capacity or economy defaults live in code. */
export class KitchenRulesReader {
  public static parse(raw: unknown): KitchenRules {
    const root = this.record(raw, 'kitchen rules');
    if (root.schema !== 'cook-kitchen-rules-v1') throw new Error('Unsupported kitchen rules schema');
    const stations = this.array(root.stations, 'stations').map(value => {
      const station = this.record(value, 'station');
      const capacityByLevel = this.numbers(station.capacityByLevel, 'capacityByLevel', true, true);
      const timeMultipliers = this.numbers(station.timeMultipliers, 'timeMultipliers', false, true);
      const upgradePrices = this.numbers(station.upgradePrices, 'upgradePrices', true, false, true);
      if (capacityByLevel.length !== timeMultipliers.length || upgradePrices.length !== capacityByLevel.length - 1)
        throw new Error('Station upgrade tables must describe the same levels');
      return { id: this.text(station.id, 'station.id'), label: this.text(station.label, 'station.label'),
        upgradeId: this.text(station.upgradeId, 'station.upgradeId'), capacityByLevel, timeMultipliers, upgradePrices };
    });
    const recipes = this.array(root.recipes, 'recipes').map(value => {
      const recipe = this.record(value, 'recipe');
      const coinsByLevel = this.numbers(recipe.coinsByLevel, 'coinsByLevel', true, true);
      const upgradePrices = this.numbers(recipe.upgradePrices, 'recipe.upgradePrices', true, false, true);
      if (upgradePrices.length !== coinsByLevel.length - 1) throw new Error('Ingredient upgrade tables must describe the same levels');
      const stationId = this.text(recipe.stationId, 'recipe.stationId');
      if (!stations.some(station => station.id === stationId)) throw new Error(`Unknown recipe station: ${stationId}`);
      const plateStationId = recipe.plateStationId === undefined ? undefined : this.text(recipe.plateStationId, 'plateStationId');
      if (plateStationId && (!stations.some(station => station.id === plateStationId) || plateStationId === stationId)) throw new Error('Invalid plate station');
      const toppings = recipe.toppings === undefined ? [] : this.array(recipe.toppings, 'toppings').map(value => {
        const topping = this.record(value, 'topping');
        const upgrade = topping.upgrade === undefined ? undefined : this.toppingUpgrade(topping.upgrade);
        return { id: this.text(topping.id, 'topping.id'), label: this.text(topping.label, 'topping.label'), ...(upgrade ? { upgrade } : {}) };
      });
      this.unique(toppings.map(topping => topping.id), 'topping IDs');
      if (toppings.length && !plateStationId) throw new Error('Toppings require a plate station');
      const orderToppingSets = recipe.orderToppingSets === undefined ? [[]] : this.array(recipe.orderToppingSets, 'orderToppingSets').map(value => {
        if (!Array.isArray(value)) throw new Error('Topping set must be an array');
        const ids = value.map(id => this.text(id, 'order topping ID'));
        this.unique(ids, 'order toppings');
        if (ids.some(id => !toppings.some(topping => topping.id === id))) throw new Error('Unknown order topping');
        return ids;
      });
      return { toppings, orderToppingSets, ...(plateStationId ? { plateStationId } : {}), dishId: this.text(recipe.dishId, 'recipe.dishId'), label: this.text(recipe.label, 'recipe.label'), stationId,
        cookSeconds: this.number(recipe.cookSeconds, 'cookSeconds', false, true),
        burnAfterSeconds: recipe.burnAfterSeconds === null ? null : this.number(recipe.burnAfterSeconds, 'burnAfterSeconds', false, true),
        coinsByLevel, upgradeId: this.text(recipe.upgradeId, 'recipe.upgradeId'), upgradePrices };
    });
    this.unique(stations.map(station => station.id), 'station IDs');
    this.unique(recipes.map(recipe => recipe.dishId), 'recipe IDs');
    this.unique([...stations.map(station => station.upgradeId), ...recipes.flatMap(recipe => [recipe.upgradeId, ...recipe.toppings.flatMap(topping => topping.upgrade ? [topping.upgrade.upgradeId] : [])])], 'upgrade IDs');
    const customers = this.customers(root.customers), goal = this.goal(root.goal);
    const combo = this.record(root.combo, 'combo'), limits = this.record(root.limits, 'limits');
    const parsed: KitchenRules = {
      schema: 'cook-kitchen-rules-v1', source: this.text(root.source, 'source'), restaurantId: this.text(root.restaurantId, 'restaurantId'), stations, recipes,
      customers,
      combo: { windowSeconds: this.number(combo.windowSeconds, 'combo.windowSeconds', false, true),
        bonusCoins: this.numbers(combo.bonusCoins, 'combo.bonusCoins', true, false) },
      limits: { maxBurnt: this.limit(limits.maxBurnt, 'maxBurnt'), maxDiscarded: this.limit(limits.maxDiscarded, 'maxDiscarded'), maxLost: this.limit(limits.maxLost, 'maxLost') },
      goal,
    };
    if (root.levelOverrides === undefined) return parsed;
    if (!Array.isArray(root.levelOverrides)) throw new Error('levelOverrides must be an array');
    const levelOverrides = root.levelOverrides.map(value => {
      const row = this.record(value, 'level override');
      this.onlyKeys(row, ['levelId', 'customers', 'goal'], 'level override');
      if (row.customers === undefined && row.goal === undefined) throw new Error('Level override must specify customers or goal');
      const customerPatch = row.customers === undefined ? {} : this.patch(row.customers, ['count', 'activeCapacity', 'itemsPerCustomer', 'patienceSeconds', 'partialServeRecoverySeconds'], 'level customers');
      const goalPatch = row.goal === undefined ? {} : this.patch(row.goal, ['mode', 'metric', 'target', 'starRatios', 'keepEarningsOnFailure'], 'level goal');
      return { levelId: this.text(row.levelId, 'levelId'), customers: this.customers({ ...customers, ...customerPatch }), goal: this.goal({ ...goal, ...goalPatch }) };
    });
    this.unique(levelOverrides.map(row => row.levelId), 'level override IDs');
    return { ...parsed, levelOverrides };
  }
  public static levelIndex(levels: Readonly<Record<string, number>>, restaurantId: string, upgradeId: string, length: number): number {
    const saved = levels[`${restaurantId}:${upgradeId}`] ?? 1;
    return Math.min(length - 1, Math.max(0, Math.floor(saved) - 1));
  }
  private static customers(value: unknown): KitchenRules['customers'] {
    const row = this.record(value, 'customers');
    return { count: row.count === null ? null : this.number(row.count, 'customer count', true, true),
      activeCapacity: this.number(row.activeCapacity, 'activeCapacity', true, true), itemsPerCustomer: this.number(row.itemsPerCustomer, 'itemsPerCustomer', true, true),
      patienceSeconds: this.number(row.patienceSeconds, 'patienceSeconds', false, true), partialServeRecoverySeconds: this.number(row.partialServeRecoverySeconds, 'partialServeRecoverySeconds', false, false) };
  }
  private static goal(value: unknown): KitchenRules['goal'] {
    const row = this.record(value, 'goal');
    if (row.mode !== 'timed' && row.mode !== 'customers') throw new Error('Invalid goal mode');
    if (row.metric !== 'coins' && row.metric !== 'dishes' && row.metric !== 'customers') throw new Error('Invalid goal metric');
    const ratios = this.numbers(row.starRatios, 'starRatios', false, true);
    if (ratios.length !== 3 || ratios[0]! > 1 || ratios.some((value, i) => i > 0 && value < ratios[i - 1]!)) throw new Error('Invalid starRatios');
    if (typeof row.keepEarningsOnFailure !== 'boolean') throw new Error('Missing keepEarningsOnFailure policy');
    return { mode: row.mode, metric: row.metric, target: row.target === 'all' ? 'all' : this.number(row.target, 'goal.target', true, true),
      starRatios: [ratios[0]!, ratios[1]!, ratios[2]!], keepEarningsOnFailure: row.keepEarningsOnFailure };
  }
  private static onlyKeys(row: Record<string, unknown>, keys: readonly string[], name: string): void {
    if (Object.keys(row).some(key => !keys.includes(key))) throw new Error(`Unsupported ${name} field`);
  }
  private static patch(value: unknown, keys: readonly string[], name: string): Record<string, unknown> {
    const row = this.record(value, name);
    this.onlyKeys(row, keys, name);
    if (!Object.keys(row).length) throw new Error(`${name} must not be empty`);
    return row;
  }
  private static toppingUpgrade(value: unknown): KitchenIngredientUpgradeRule {
    const upgrade = this.record(value, 'topping.upgrade');
    const coinsByLevel = this.numbers(upgrade.coinsByLevel, 'topping.coinsByLevel', true, false);
    const upgradePrices = this.numbers(upgrade.upgradePrices, 'topping.upgradePrices', true, false, true);
    if (upgradePrices.length !== coinsByLevel.length - 1) throw new Error('Topping upgrade tables must describe the same levels');
    return { upgradeId: this.text(upgrade.upgradeId, 'topping.upgradeId'), coinsByLevel, upgradePrices };
  }
  private static record(value: unknown, name: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
    return value as Record<string, unknown>;
  }
  private static text(value: unknown, name: string): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${name}`); return value; }
  private static array(value: unknown, name: string): unknown[] { if (!Array.isArray(value) || value.length === 0) throw new Error(`${name} must not be empty`); return value; }
  private static number(value: unknown, name: string, integer: boolean, positive: boolean): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (positive && value === 0) || (integer && !Number.isSafeInteger(value))) throw new Error(`Invalid ${name}`);
    return value;
  }
  private static numbers(value: unknown, name: string, integer: boolean, positive: boolean, allowEmpty = false): number[] {
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new Error(`Invalid ${name}`);
    return value.map(item => this.number(item, name, integer, positive));
  }
  private static limit(value: unknown, name: string): number | null { return value === null ? null : this.number(value, name, true, false); }
  private static unique(values: string[], name: string): void { if (new Set(values).size !== values.length) throw new Error(`Duplicate ${name}`); }
}
