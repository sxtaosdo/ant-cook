import type { KitchenRunReadModel, LevelConfig } from './types';
import { RunStatus } from './types';
import { KitchenRulesReader, type KitchenRules, type KitchenRecipeRule } from './kitchenRules';
import type { FoodState, CustomerItemReadModel } from './productionTypes';

type Slot = { id: string; stationId: string; dishId: string | null; state: FoodState; remainingSeconds: number; burnRemainingSeconds: number | null };
type Customer = { id: string; state: 'Waiting' | 'Active' | 'Served' | 'Lost'; patienceRemaining: number; patienceMax: number;
  items: Array<{ id: string; dishId: string; state: CustomerItemReadModel['state'] }> };

/** First-restaurant runtime owner. Engine nodes and persisted wallet never enter this class. */
export class ProductionKitchen {
  private readonly slots: Slot[] = [];
  private readonly customers: Customer[] = [];
  private status: KitchenRunReadModel['status'] = RunStatus.Running;
  private failureReason: KitchenRunReadModel['failureReason'];
  private elapsed = 0;
  private served = 0;
  private lost = 0;
  private burnt = 0;
  private discarded = 0;
  private baseCoins = 0;
  private comboCoins = 0;
  private combo = 0;
  private maxCombo = 0;
  private lastServeAt: number | null = null;
  private readonly target: number;

  public constructor(private readonly config: LevelConfig, private readonly attemptId: string,
    private readonly rules: KitchenRules, private readonly upgrades: Readonly<Record<string, number>>) {
    for (const station of rules.stations) {
      const level = KitchenRulesReader.levelIndex(upgrades, rules.restaurantId, station.upgradeId, station.capacityByLevel.length);
      for (let index = 0; index < station.capacityByLevel[level]!; index++) this.slots.push({
        id: `${station.id}-slot-${index + 1}`, stationId: station.id, dishId: null, state: 'Idle', remainingSeconds: 0, burnRemainingSeconds: null,
      });
    }
    const count = rules.customers.count ?? config.orderCount;
    for (let index = 0; index < count; index++) this.customers.push({
      id: `${attemptId}-customer-${index + 1}`, state: 'Waiting', patienceRemaining: rules.customers.patienceSeconds,
      patienceMax: rules.customers.patienceSeconds,
      items: Array.from({ length: rules.customers.itemsPerCustomer }, (_, item) => ({
        id: `${attemptId}-item-${index + 1}-${item + 1}`,
        dishId: rules.recipes[(index * rules.customers.itemsPerCustomer + item) % rules.recipes.length]!.dishId, state: 'Pending' as const,
      })),
    });
    this.target = rules.goal.target !== 'all' ? rules.goal.target : rules.goal.metric === 'customers' ? count
      : rules.goal.metric === 'dishes' ? count * rules.customers.itemsPerCustomer
        : this.customers.reduce((total, customer) => total + customer.items.reduce((sum, item) => sum + this.recipe(item.dishId).coinsByLevel[0]!, 0), 0);
    this.admitCustomers();
  }

  public get snapshot(): KitchenRunReadModel {
    const current = this.goalValue();
    return {
      levelId: this.config.id, attemptId: this.attemptId, status: this.status,
      remainingSeconds: Math.max(0, this.config.durationSeconds - this.elapsed), score: this.baseCoins + this.comboCoins,
      combo: this.combo, maxCombo: this.maxCombo, servedOrders: this.served, lostCustomers: this.lost,
      stars: this.status === RunStatus.Completed ? this.rules.goal.starRatios.filter(ratio => current >= this.target * ratio).length : 0,
      failureReason: this.failureReason,
      orders: this.customers.flatMap(customer => customer.items.map(item => ({ ...item,
        patienceRemaining: customer.patienceRemaining, patienceMax: customer.patienceMax, baseScore: this.recipe(item.dishId).coinsByLevel[0]!,
      }))),
      production: { recipes: this.rules.recipes.map(recipe => ({ dishId: recipe.dishId, label: recipe.label })), slots: this.slots.map(slot => ({ ...slot, stationLabel: this.rules.stations.find(station => station.id === slot.stationId)!.label, dishLabel: slot.dishId ? this.recipe(slot.dishId).label : null })), customers: this.customers.map(customer => ({ ...customer, items: customer.items.map(item => ({ ...item })) })),
        baseCoins: this.baseCoins, comboCoins: this.comboCoins, earnedCoins: this.baseCoins + this.comboCoins,
        burntCount: this.burnt, discardedCount: this.discarded, elapsedSeconds: this.elapsed, configSource: this.rules.source,
        goal: { mode: this.rules.goal.mode, metric: this.rules.goal.metric, target: this.target, current }, keepEarningsOnFailure: this.rules.goal.keepEarningsOnFailure },
    };
  }

  public startCooking(dishId: string): KitchenRunReadModel {
    this.requireRunning();
    const recipe = this.recipe(dishId);
    const station = this.rules.stations.find(candidate => candidate.id === recipe.stationId)!;
    const slot = this.slots.find(candidate => candidate.stationId === station.id && candidate.state === 'Idle');
    if (!slot) throw new Error('制作位已满，请先上菜或处理成品');
    const level = KitchenRulesReader.levelIndex(this.upgrades, this.rules.restaurantId, station.upgradeId, station.timeMultipliers.length);
    Object.assign(slot, { dishId, state: 'Cooking', remainingSeconds: recipe.cookSeconds * station.timeMultipliers[level]!, burnRemainingSeconds: null });
    return this.snapshot;
  }

  public serveReady(slotId: string, customerId?: string): KitchenRunReadModel {
    this.requireRunning();
    const slot = this.slots.find(candidate => candidate.id === slotId);
    if (!slot || slot.state !== 'Ready' || !slot.dishId) throw new Error('只有成熟成品可以上菜');
    const customer = this.customers.find(candidate => candidate.state === 'Active'
      && (customerId === undefined || candidate.id === customerId)
      && candidate.items.some(item => item.state === 'Pending' && item.dishId === slot.dishId));
    if (!customer) throw new Error('当前顾客没有匹配订单，成品已保留');
    const item = customer.items.find(candidate => candidate.state === 'Pending' && candidate.dishId === slot.dishId)!;
    const recipe = this.recipe(slot.dishId);
    const level = KitchenRulesReader.levelIndex(this.upgrades, this.rules.restaurantId, recipe.upgradeId, recipe.coinsByLevel.length);
    if (this.lastServeAt === null || this.elapsed - this.lastServeAt > this.rules.combo.windowSeconds) this.combo = 0;
    this.baseCoins += recipe.coinsByLevel[level]!;
    this.comboCoins += this.rules.combo.bonusCoins[Math.min(this.combo, this.rules.combo.bonusCoins.length - 1)]!;
    this.combo++; this.maxCombo = Math.max(this.maxCombo, this.combo); this.lastServeAt = this.elapsed;
    item.state = 'Served'; this.served++;
    this.emptySlot(slot);
    if (customer.items.every(candidate => candidate.state === 'Served')) customer.state = 'Served';
    else customer.patienceRemaining = Math.min(customer.patienceMax, customer.patienceRemaining + this.rules.customers.partialServeRecoverySeconds);
    this.plateReadyFood(); this.admitCustomers(); this.resolve();
    return this.snapshot;
  }

  public discardFood(slotId: string): KitchenRunReadModel {
    this.requireRunning();
    const slot = this.slots.find(candidate => candidate.id === slotId);
    if (!slot || (slot.state !== 'Ready' && slot.state !== 'Burnt')) throw new Error('当前没有可丢弃的成品');
    this.emptySlot(slot); this.discarded++; this.combo = 0; this.plateReadyFood();
    this.resolve(); return this.snapshot;
  }

  /** Advance to semantic boundaries so a large frame never ages newly seated customers retroactively. */
  public tick(seconds: number): KitchenRunReadModel {
    this.requireRunning();
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('tick seconds must be non-negative and finite');
    let remaining = seconds;
    while (remaining > 0 && this.status === RunStatus.Running) {
      const deadlines = [remaining];
      if (this.rules.goal.mode === 'timed') deadlines.push(Math.max(0, this.config.durationSeconds - this.elapsed));
      for (const slot of this.slots) {
        if (slot.state === 'Cooking') deadlines.push(slot.remainingSeconds);
        if (slot.state === 'Ready' && slot.burnRemainingSeconds !== null) deadlines.push(slot.burnRemainingSeconds);
      }
      for (const customer of this.customers) if (customer.state === 'Active') deadlines.push(customer.patienceRemaining);
      const step = Math.min(...deadlines);
      this.elapsed += step; remaining = Math.max(0, remaining - step);
      for (const slot of this.slots) {
        if (slot.state === 'Cooking') slot.remainingSeconds = Math.max(0, slot.remainingSeconds - step);
        else if (slot.state === 'Ready' && slot.burnRemainingSeconds !== null) slot.burnRemainingSeconds = Math.max(0, slot.burnRemainingSeconds - step);
      }
      for (const customer of this.customers) if (customer.state === 'Active') customer.patienceRemaining = Math.max(0, customer.patienceRemaining - step);
      for (const slot of this.slots) {
        if (slot.state === 'Cooking' && slot.remainingSeconds === 0) { slot.state = 'Ready'; slot.burnRemainingSeconds = this.recipe(slot.dishId!).burnAfterSeconds; }
        else if (slot.state === 'Ready' && slot.burnRemainingSeconds === 0) { slot.state = 'Burnt'; this.burnt++; }
      }
      for (const customer of this.customers) if (customer.state === 'Active' && customer.patienceRemaining === 0) {
        customer.state = 'Lost'; this.lost++; this.combo = 0;
        for (const item of customer.items) if (item.state === 'Pending') item.state = 'Expired';
      }
      if (this.lastServeAt !== null && this.elapsed - this.lastServeAt > this.rules.combo.windowSeconds) this.combo = 0;
      this.plateReadyFood(); this.admitCustomers(); this.resolve();
      if (step === 0 && this.status === RunStatus.Running) throw new Error('Kitchen time could not advance');
    }
    return this.snapshot;
  }

  private recipe(dishId: string): KitchenRecipeRule {
    const recipe = this.rules.recipes.find(candidate => candidate.dishId === dishId);
    if (!recipe) throw new Error(`Unknown recipe: ${dishId}`);
    return recipe;
  }
  private plateReadyFood(): void {
    for (const food of this.slots) {
      if (food.state !== 'Ready' || !food.dishId) continue;
      const plateStationId = this.recipe(food.dishId).plateStationId;
      if (!plateStationId || food.stationId === plateStationId) continue;
      const plate = this.slots.find(slot => slot.stationId === plateStationId && slot.state === 'Idle');
      if (!plate) continue;
      Object.assign(plate, { state: 'Ready', dishId: food.dishId, remainingSeconds: 0, burnRemainingSeconds: null });
      this.emptySlot(food);
    }
  }
  private emptySlot(slot: Slot): void { Object.assign(slot, { dishId: null, state: 'Idle', remainingSeconds: 0, burnRemainingSeconds: null }); }
  private admitCustomers(): void {
    let places = this.rules.customers.activeCapacity - this.customers.filter(customer => customer.state === 'Active').length;
    for (const customer of this.customers) if (places > 0 && customer.state === 'Waiting') { customer.state = 'Active'; places--; }
  }
  private goalValue(): number {
    return this.rules.goal.metric === 'coins' ? this.baseCoins + this.comboCoins : this.rules.goal.metric === 'dishes' ? this.served
      : this.customers.filter(customer => customer.state === 'Served').length;
  }
  private resolve(): void {
    const limits = this.rules.limits;
    if (limits.maxBurnt !== null && this.burnt > limits.maxBurnt) this.fail('BURNT_LIMIT');
    else if (limits.maxDiscarded !== null && this.discarded > limits.maxDiscarded) this.fail('DISCARD_LIMIT');
    else if (limits.maxLost !== null && this.lost > limits.maxLost) this.fail('TOO_MANY_LOST');
    else if (this.customers.every(customer => customer.state === 'Served' || customer.state === 'Lost')
      || (this.rules.goal.mode === 'timed' && this.elapsed >= this.config.durationSeconds)) {
      if (this.goalValue() >= this.target) this.status = RunStatus.Completed;
      else this.fail('TARGET_NOT_MET');
    }
  }
  private fail(reason: NonNullable<KitchenRunReadModel['failureReason']>): void { this.failureReason = reason; this.status = RunStatus.Failed; }
  private requireRunning(): void { if (this.status !== RunStatus.Running) throw new Error('本局已结束'); }
}
