import { KitchenRulesReader, type KitchenRules } from './kitchenRules';
import {
    LEVELS,
    RESTAURANTS,
    getLevelConfig,
    getRestaurantConfig,
    nextRestaurantId,
} from './content';
import { KitchenRun } from './KitchenRun';
import { SaveCodec, createDefaultSave } from './SaveCodec';
import { RunStatus } from './types';
import type {
    GameProgressReadModel,
    GameSaveV2,
    GameSettings,
    RestaurantConfig,
    SettlementReceipt,
    UpgradeQuote,
    UpgradeReceipt,
} from './types';

const STATION_IDS = new Set(['grill', 'prep', 'tray']);

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

export class P10GameCore {
    private readonly save: GameSaveV2;
    private kitchenRules: KitchenRules | null = null;
    public configureKitchenRules(rules: KitchenRules | null): void {
        for (const override of rules?.levelOverrides ?? []) {
            if (getLevelConfig(override.levelId).restaurantId !== rules!.restaurantId) throw new Error(`Level override belongs to another restaurant: ${override.levelId}`);
        }
        this.kitchenRules = rules;
    }
    public listUpgradeIds(restaurantId: string): readonly string[] {
        return this.kitchenRules?.restaurantId === restaurantId
            ? [...this.kitchenRules.stations.map(station => station.upgradeId), ...this.kitchenRules.recipes.flatMap(recipe => [recipe.upgradeId, ...(recipe.toppings ?? []).flatMap(topping => topping.upgrade ? [topping.upgrade.upgradeId] : [])])]
            : [...STATION_IDS];
    }
    private createRun(levelId: string, attemptId: string): KitchenRun {
        const config = getLevelConfig(levelId);
        const rules = this.kitchenRules?.restaurantId === config.restaurantId ? this.kitchenRules : null;
        const override = rules?.levelOverrides?.find(row => row.levelId === config.id);
        return new KitchenRun(config, attemptId, rules
            ? { rules: override ? { ...rules, customers: override.customers, goal: override.goal } : rules, upgrades: { ...this.save.upgrades } } : undefined);
    }

    private constructor(save: GameSaveV2) {
        this.save = save;
    }

    public static createNew(): P10GameCore {
        return new P10GameCore(createDefaultSave());
    }

    public static load(serialized: string): P10GameCore {
        return new P10GameCore(SaveCodec.deserialize(serialized));
    }

    public listRestaurants(): readonly RestaurantConfig[] {
        return RESTAURANTS.map((restaurant) => ({
            ...restaurant,
            levelIds: [...restaurant.levelIds],
            renovationMilestones: [...restaurant.renovationMilestones],
        }));
    }

    public get progress(): GameProgressReadModel {
        return {
            coins: this.save.coins,
            reputation: this.save.reputation,
            totalStars: Object.values(this.save.levels).reduce((sum, level) => sum + level.bestStars, 0),
            levels: cloneJson(this.save.levels),
            restaurants: cloneJson(this.save.restaurants),
            upgrades: { ...this.save.upgrades },
            settings: { ...this.save.settings },
            hasCheckpoint: Boolean(this.save.checkpoint),
        };
    }

    public startLevel(levelId: string, attemptId: string): KitchenRun {
        const progress = this.save.levels[levelId];
        if (!progress?.unlocked) {
            throw new Error(`Level is locked: ${levelId}`);
        }
        const run = this.createRun(levelId, attemptId);
        this.save.checkpoint = { levelId, attemptId };
        return run;
    }

    public resumeCheckpoint(): KitchenRun | null {
        const checkpoint = this.save.checkpoint;
        return checkpoint ? this.createRun(checkpoint.levelId, checkpoint.attemptId) : null;
    }

    public abandonCheckpoint(): void {
        delete this.save.checkpoint;
    }

    public settle(run: KitchenRun, settlementId: string): SettlementReceipt {
        const existing = this.save.settlements[settlementId];
        if (existing) {
            return cloneJson(existing);
        }
        if (!settlementId.trim()) {
            throw new Error('settlementId is required');
        }

        const result = run.snapshot;
        const previousAttempt = Object.values(this.save.settlements).find(receipt => receipt.attemptId === result.attemptId && receipt.levelId === result.levelId);
        if (previousAttempt) return cloneJson(previousAttempt);
        if (result.status === RunStatus.Running) {
            throw new Error('Cannot settle a running level');
        }

        const config = getLevelConfig(result.levelId);
        const levelProgress = this.save.levels[result.levelId];
        const renovationsUnlocked: number[] = [];
        let coinsGranted = 0;
        let reputationGranted = 0;
        let restaurantUnlocked: string | undefined;

        if (result.status === RunStatus.Completed) {
            const previousStars = levelProgress.bestStars;
            const firstClear = previousStars === 0;
            reputationGranted = Math.max(0, result.stars - previousStars);
            coinsGranted = result.production?.earnedCoins ?? (config.baseReward + result.stars * 25 + (firstClear ? config.firstClearBonus : 0));
            this.save.coins += coinsGranted;
            this.save.reputation += reputationGranted;
            levelProgress.bestStars = Math.max(previousStars, result.stars);
            levelProgress.highScore = Math.max(levelProgress.highScore, result.score);
            levelProgress.failures = 0;
            const progressChanges = this.applyProgression(config.restaurantId, config.index);
            renovationsUnlocked.push(...progressChanges.renovations);
            restaurantUnlocked = progressChanges.restaurantUnlocked;
        } else {
            levelProgress.failures += 1;
            if (result.production?.keepEarningsOnFailure) { coinsGranted = result.production.earnedCoins; this.save.coins += coinsGranted; }
        }

        const receipt: SettlementReceipt = {
            settlementId,
            attemptId: result.attemptId,
            levelId: result.levelId,
            success: result.status === RunStatus.Completed,
            score: result.score,
            stars: result.stars,
            coinsGranted,
            reputationGranted,
            renovationsUnlocked,
            restaurantUnlocked,
        };
        this.save.settlements[settlementId] = receipt;
        delete this.save.checkpoint;
        return cloneJson(receipt);
    }

    public getUpgradeQuote(restaurantId: string, stationId: string): UpgradeQuote {
        getRestaurantConfig(restaurantId);
        const rules = this.kitchenRules?.restaurantId === restaurantId ? this.kitchenRules : null;
        const station = rules?.stations.find(candidate => candidate.upgradeId === stationId);
        const recipe = rules?.recipes.find(candidate => candidate.upgradeId === stationId);
        const topping = rules?.recipes.flatMap(candidate => candidate.toppings ?? []).find(candidate => candidate.upgrade?.upgradeId === stationId);
        const ingredient = recipe ?? (topping?.upgrade ? { ...topping.upgrade, label: topping.label } : undefined);
        if (rules && !station && !ingredient) throw new Error(`Unknown upgrade: ${stationId}`);
        if (rules && (station || ingredient)) {
            const prices = (station ?? ingredient)!.upgradePrices;
            const index = KitchenRulesReader.levelIndex(this.save.upgrades, restaurantId, stationId, prices.length + 1);
            const effect = (level: number) => station ? { capacity: station.capacityByLevel[level]!, timeMultiplier: station.timeMultipliers[level]! }
                : { coins: ingredient!.coinsByLevel[level]! };
            const price = index < prices.length ? prices[index]! : null;
            return { restaurantId, stationId, currentLevel: index + 1, nextLevel: price === null ? null : index + 2,
                price, affordable: price !== null && this.save.coins >= price, label: (station ?? ingredient)!.label,
                kind: station ? 'equipment' : 'ingredient', currentEffect: effect(index), nextEffect: price === null ? null : effect(index + 1) };
        }
        this.requireStation(stationId);
        const key = `${restaurantId}:${stationId}`;
        const currentLevel = this.save.upgrades[key] ?? 1;
        const nextLevel = currentLevel < 3 ? currentLevel + 1 : null;
        const restaurantIndex = RESTAURANTS.findIndex((restaurant) => restaurant.id === restaurantId) + 1;
        const price = nextLevel ? currentLevel * 100 + restaurantIndex * 50 : null;
        return {
            restaurantId,
            stationId,
            currentLevel,
            nextLevel,
            price,
            affordable: price !== null && this.save.coins >= price,
        };
    }

    public purchaseUpgrade(restaurantId: string, stationId: string, transactionId: string): UpgradeReceipt {
        const existing = this.save.upgradeTransactions[transactionId];
        if (existing) {
            return cloneJson(existing);
        }
        if (!transactionId.trim()) {
            throw new Error('transactionId is required');
        }

        const quote = this.getUpgradeQuote(restaurantId, stationId);
        const applied = quote.nextLevel !== null && quote.price !== null && quote.affordable;
        if (applied) {
            this.save.coins -= quote.price!;
            this.save.upgrades[`${restaurantId}:${stationId}`] = quote.nextLevel!;
        }
        const receipt: UpgradeReceipt = {
            transactionId,
            applied,
            restaurantId,
            stationId,
            newLevel: applied ? quote.nextLevel! : quote.currentLevel,
            coinsSpent: applied ? quote.price! : 0,
        };
        this.save.upgradeTransactions[transactionId] = receipt;
        return cloneJson(receipt);
    }

    public updateSettings(settings: Partial<GameSettings>): GameSettings {
        this.save.settings = {
            musicVolume: this.clampVolume(settings.musicVolume, this.save.settings.musicVolume),
            effectsVolume: this.clampVolume(settings.effectsVolume, this.save.settings.effectsVolume),
            vibration: typeof settings.vibration === 'boolean'
                ? settings.vibration
                : this.save.settings.vibration,
            reducedMotion: typeof settings.reducedMotion === 'boolean'
                ? settings.reducedMotion
                : this.save.settings.reducedMotion,
            colorBlindMode: typeof settings.colorBlindMode === 'boolean'
                ? settings.colorBlindMode
                : this.save.settings.colorBlindMode,
        };
        return { ...this.save.settings };
    }

    public serialize(): string {
        return SaveCodec.serialize(this.save);
    }

    private applyProgression(restaurantId: string, levelIndex: number): {
        renovations: number[];
        restaurantUnlocked?: string;
    } {
        const restaurant = getRestaurantConfig(restaurantId);
        const restaurantProgress = this.save.restaurants[restaurantId];
        const nextLevelId = restaurant.levelIds[levelIndex];
        if (nextLevelId) {
            this.save.levels[nextLevelId].unlocked = true;
            restaurantProgress.highestUnlockedLevel = Math.max(
                restaurantProgress.highestUnlockedLevel,
                levelIndex + 1,
            );
        }

        const renovations = restaurant.renovationMilestones.filter((milestone) =>
            milestone === levelIndex && !restaurantProgress.renovations.includes(milestone),
        );
        restaurantProgress.renovations.push(...renovations);
        restaurantProgress.renovations.sort((a, b) => a - b);

        let restaurantUnlocked: string | undefined;
        if (levelIndex === restaurant.levelIds.length) {
            restaurantProgress.chapterComplete = true;
            const nextId = nextRestaurantId(restaurantId);
            if (nextId && !this.save.restaurants[nextId].unlocked) {
                restaurantUnlocked = nextId;
                this.save.restaurants[nextId].unlocked = true;
                this.save.restaurants[nextId].highestUnlockedLevel = 1;
                this.save.levels[`${nextId}-l01`].unlocked = true;
            }
        }
        return { renovations, restaurantUnlocked };
    }

    private requireStation(stationId: string): void {
        if (!STATION_IDS.has(stationId)) {
            throw new Error(`Unknown station: ${stationId}`);
        }
    }

    private clampVolume(value: number | undefined, fallback: number): number {
        return typeof value === 'number' && Number.isFinite(value)
            ? Math.max(0, Math.min(1, value))
            : fallback;
    }
}

export const GAME_CONTENT_COUNTS = {
    restaurants: RESTAURANTS.length,
    levels: LEVELS.length,
} as const;
