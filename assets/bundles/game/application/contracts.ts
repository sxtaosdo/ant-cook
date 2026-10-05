import type {
    GameProgressReadModel,
    GameSettings,
    KitchenRunReadModel,
    LevelConfig,
    RestaurantConfig,
    SettlementReceipt,
    UpgradeReceipt,
} from '../core';
import type { UpgradeQuote } from '../core';

export const P10_SCREENS = [
    'map',
    'level',
    'kitchen',
    'pause',
    'result',
    'upgrade',
    'decor',
    'story',
    'unlock',
    'settings',
    'recovery',
] as const;
export type P10Screen = (typeof P10_SCREENS)[number];

export interface P10Selection {
    readonly restaurantIndex: number;
    readonly levelIndex: number;
    readonly levelPage: number;
    readonly storyPage: number;
}

export interface P10BusinessReadModel {
    readonly paused: boolean;
    readonly catalog: P10RestaurantCatalog;
    readonly progress: GameProgressReadModel;
    readonly upgradeQuotes: Readonly<Record<string, UpgradeQuote>>;
    readonly selection: P10Selection;
    readonly level: Readonly<LevelConfig> | null;
    readonly kitchen: KitchenRunReadModel | null;
    readonly result: SettlementReceipt | null;
    readonly lastSuccess: boolean;
    readonly saveStatus: SaveStatusView;
    readonly error: P10ApplicationError | null;
}

/** Presentation page is derived only from the current PageState. */
export interface P10ReadModel extends P10BusinessReadModel { readonly screen: P10Screen; }

export interface P10Config {
    readonly autoResumeCheckpoint: boolean;
    readonly idPrefix: string;
}

export const DEFAULT_P10_APP_CONFIG: P10Config = {
    autoResumeCheckpoint: true,
    idPrefix: 'p10',
};

export interface P10FeatureRuntimePorts {
    readonly saveSectionId: string;
}

export interface P10RuntimePorts {
    readonly saveScope: { readonly frameworkVersion: string; readonly sectionId: string; readonly primaryKey: string };
    readonly storage: StoragePort;
    readonly clock: () => number;
    readonly idGenerator: (seed: string) => string;
}

export interface StoragePort {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export type SaveStatus = 'unknown' | 'ready' | 'loading' | 'saving' | 'error';

export type SaveStatusView = Readonly<{
    readonly state: SaveStatus;
    readonly details: Readonly<{
        readonly key: string | null;
        readonly sectionErrors: readonly Readonly<SaveSectionProblem>[];
    }>;
}>;

export interface P10ApplicationError {
    readonly code: 'BAD_CONFIG' | 'INVALID_INTENT' | 'INVALID_OPERATION' | 'SAVE' | 'RUNTIME';
    readonly message: string;
}

export interface SaveSectionProblem {
    readonly code: StructuredSaveError['code'];
    readonly sectionId: string;
    readonly cause?: string;
}

export interface StructuredSaveError {
    readonly code:
        | 'SAVE_SECTION_DUPLICATE'
        | 'SAVE_CAPTURE_FAILED'
        | 'SAVE_RESTORE_FAILED'
        | 'SAVE_SECTION_MISSING'
        | 'SAVE_VERSION_UNSUPPORTED'
        | 'SAVE_SECTION_INVALID'
        | 'SAVE_SECTION_CORRUPT'
        | 'SAVE_SECTION_WRITE_FAILED'
        | 'SAVE_UNKNOWN_ERROR';
    readonly sectionId: string;
    readonly cause?: string;
}

export type P10Intent =
    | { type: 'p10.select-restaurant'; payload: { readonly restaurantIndex: number } }
    | { type: 'p10.set-level-page'; payload: { readonly page: number } }
    | { type: 'p10.set-story-page'; payload: { readonly page: number } }
    | { type: 'p10.select-level'; payload: { readonly levelIndex: number } }
    | { type: 'p10.start-level'; payload: { readonly attemptId?: string; readonly levelIndex?: number } }
    | { type: 'p10.serve-dish'; payload: { readonly dishId: string } }
    | { type: 'p10.pause'; payload: Record<string, never> }
    | { type: 'p10.resume'; payload: Record<string, never> }
    | { type: 'p10.restart'; payload: { readonly reason: string } }
    | { type: 'p10.abandon'; payload: Record<string, never> }
    | { type: 'p10.next-after-result'; payload: Record<string, never> }
    | { type: 'p10.purchase-upgrade'; payload: { readonly stationId: string; readonly restaurantId: string } }
    | { type: 'p10.toggle-setting'; payload: { readonly key: keyof GameSettings; readonly value: number | boolean } }
    | { type: 'p10.resume-checkpoint'; payload: Record<string, never> }
    | { type: 'p10.reset-save'; payload: Record<string, never> };

export type P10Command = Exclude<
    P10Intent,
    { type: 'p10.read'; payload: Record<string, never> }
>;

export type P10Query = { type: 'p10.read'; payload: Record<string, never> };
export type P10Event =
    | { type: 'p10.kitchen-updated'; payload: { readonly paused: boolean } }
    | { type: 'p10.settlement-applied'; payload: { readonly settlementId: string; readonly success: boolean; readonly stars: number } }
    | { type: 'p10.save-status-changed'; payload: { readonly state: SaveStatus } }
    | { type: 'p10.upgrade-applied'; payload: { readonly receipt: UpgradeReceipt } };

export interface P10RestaurantCatalog {
    readonly restaurants: readonly RestaurantConfig[];
    readonly levels: readonly LevelConfig[];
}
