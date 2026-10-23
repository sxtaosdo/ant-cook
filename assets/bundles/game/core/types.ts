export const RunStatus = {
    Running: 'Running',
    Completed: 'Completed',
    Failed: 'Failed',
} as const;

export type RunStatus = typeof RunStatus[keyof typeof RunStatus];
export type FailureReason = 'TARGET_NOT_MET' | 'TOO_MANY_LOST' | 'BURNT_LIMIT' | 'DISCARD_LIMIT';
export type OrderState = 'Pending' | 'Served' | 'Expired';

export interface RestaurantConfig {
    readonly id: string;
    readonly name: string;
    readonly levelIds: readonly string[];
    readonly renovationMilestones: readonly number[];
}

export interface LevelConfig {
    readonly id: string;
    readonly restaurantId: string;
    readonly index: number;
    readonly durationSeconds: number;
    readonly orderCount: number;
    readonly orderBaseScore: number;
    readonly orderPatienceSeconds: number;
    readonly dishPool: readonly string[];
    readonly story: {
        readonly title: string;
        readonly intro: string;
        readonly outro: string;
    };
    readonly maxLostCustomers: number;
    readonly objectiveScore: number;
    readonly starThresholds: readonly [number, number, number];
    readonly baseReward: number;
    readonly firstClearBonus: number;
}

export interface OrderReadModel {
    readonly id: string;
    readonly dishId: string;
    readonly state: OrderState;
    readonly patienceRemaining: number;
    readonly patienceMax: number;
    readonly baseScore: number;
}

export interface KitchenRunReadModel {
    readonly production?: import('./productionTypes').KitchenProductionReadModel;
    readonly levelId: string;
    readonly attemptId: string;
    readonly status: RunStatus;
    readonly remainingSeconds: number;
    readonly score: number;
    readonly combo: number;
    readonly maxCombo: number;
    readonly servedOrders: number;
    readonly lostCustomers: number;
    readonly stars: number;
    readonly failureReason?: FailureReason;
    readonly orders: readonly OrderReadModel[];
}

export interface LevelProgress {
    bestStars: number;
    highScore: number;
    failures: number;
    unlocked: boolean;
}

export interface RestaurantProgress {
    unlocked: boolean;
    highestUnlockedLevel: number;
    renovations: number[];
    chapterComplete: boolean;
}

export interface GameSettings {
    musicVolume: number;
    effectsVolume: number;
    vibration: boolean;
    reducedMotion: boolean;
    colorBlindMode: boolean;
}

export interface KitchenCheckpoint {
    levelId: string;
    attemptId: string;
}

export interface SettlementReceipt {
    attemptId?: string;
    settlementId: string;
    levelId: string;
    success: boolean;
    score: number;
    stars: number;
    coinsGranted: number;
    reputationGranted: number;
    renovationsUnlocked: number[];
    restaurantUnlocked?: string;
}

export interface UpgradeQuote {
    label?: string;
    kind?: 'equipment' | 'ingredient';
    currentEffect?: { capacity?: number; timeMultiplier?: number; coins?: number };
    nextEffect?: { capacity?: number; timeMultiplier?: number; coins?: number } | null;
    restaurantId: string;
    stationId: string;
    currentLevel: number;
    nextLevel: number | null;
    price: number | null;
    affordable: boolean;
}

export interface UpgradeReceipt {
    transactionId: string;
    applied: boolean;
    restaurantId: string;
    stationId: string;
    newLevel: number;
    coinsSpent: number;
}

export interface GameProgressReadModel {
    readonly coins: number;
    readonly reputation: number;
    readonly totalStars: number;
    readonly levels: Readonly<Record<string, Readonly<LevelProgress>>>;
    readonly restaurants: Readonly<Record<string, Readonly<RestaurantProgress>>>;
    readonly upgrades: Readonly<Record<string, number>>;
    readonly settings: Readonly<GameSettings>;
    readonly hasCheckpoint: boolean;
}

export interface GameSaveV2 {
    version: 2;
    coins: number;
    reputation: number;
    levels: Record<string, LevelProgress>;
    restaurants: Record<string, RestaurantProgress>;
    upgrades: Record<string, number>;
    settings: GameSettings;
    settlements: Record<string, SettlementReceipt>;
    upgradeTransactions: Record<string, UpgradeReceipt>;
    checkpoint?: KitchenCheckpoint;
}
