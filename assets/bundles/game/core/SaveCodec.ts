import { LEVELS, RESTAURANTS } from './content';
import type {
    GameSaveV2,
    GameSettings,
    LevelProgress,
    RestaurantProgress,
} from './types';

const DEFAULT_SETTINGS: GameSettings = {
    musicVolume: 0.8,
    effectsVolume: 0.9,
    vibration: true,
    reducedMotion: false,
    colorBlindMode: false,
};

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(min, Math.min(max, value))
        : fallback;
}

function readSettings(value: unknown): GameSettings {
    const source = value && typeof value === 'object' ? value as Partial<GameSettings> : {};
    return {
        musicVolume: clampNumber(source.musicVolume, 0, 1, DEFAULT_SETTINGS.musicVolume),
        effectsVolume: clampNumber(source.effectsVolume, 0, 1, DEFAULT_SETTINGS.effectsVolume),
        vibration: typeof source.vibration === 'boolean' ? source.vibration : DEFAULT_SETTINGS.vibration,
        reducedMotion: typeof source.reducedMotion === 'boolean' ? source.reducedMotion : DEFAULT_SETTINGS.reducedMotion,
        colorBlindMode: typeof source.colorBlindMode === 'boolean' ? source.colorBlindMode : DEFAULT_SETTINGS.colorBlindMode,
    };
}

export function createDefaultSave(): GameSaveV2 {
    const levels: Record<string, LevelProgress> = {};
    for (const level of LEVELS) {
        levels[level.id] = {
            bestStars: 0,
            highScore: 0,
            failures: 0,
            unlocked: level.restaurantId === 'r01' && level.index === 1,
        };
    }

    const restaurants: Record<string, RestaurantProgress> = {};
    for (const restaurant of RESTAURANTS) {
        restaurants[restaurant.id] = {
            unlocked: restaurant.id === 'r01',
            highestUnlockedLevel: restaurant.id === 'r01' ? 1 : 0,
            renovations: [],
            chapterComplete: false,
        };
    }

    return {
        version: 2,
        coins: 0,
        reputation: 0,
        levels,
        restaurants,
        upgrades: {},
        settings: { ...DEFAULT_SETTINGS },
        settlements: {},
        upgradeTransactions: {},
    };
}

export class SaveCodec {
    public static serialize(save: GameSaveV2): string {
        return JSON.stringify(save);
    }

    public static deserialize(serialized: string): GameSaveV2 {
        const raw: unknown = JSON.parse(serialized);
        if (!raw || typeof raw !== 'object') {
            throw new Error('Save root must be an object');
        }
        const version = (raw as { version?: unknown }).version;
        if (version !== 2) {
            throw new Error(`Unsupported save version: ${String(version)}`);
        }
        return this.sanitizeV2(raw as Partial<GameSaveV2>);
    }

    private static sanitizeV2(raw: Partial<GameSaveV2>): GameSaveV2 {
        const save = createDefaultSave();
        save.coins = Math.floor(clampNumber(raw.coins, 0, Number.MAX_SAFE_INTEGER, 0));
        save.settings = readSettings(raw.settings);

        for (const level of LEVELS) {
            const source = raw.levels?.[level.id];
            if (!source) {
                continue;
            }
            save.levels[level.id] = {
                bestStars: Math.floor(clampNumber(source.bestStars, 0, 3, 0)),
                highScore: Math.floor(clampNumber(source.highScore, 0, Number.MAX_SAFE_INTEGER, 0)),
                failures: Math.floor(clampNumber(source.failures, 0, Number.MAX_SAFE_INTEGER, 0)),
                unlocked: source.unlocked === true,
            };
        }
        save.reputation = Object.values(save.levels).reduce((sum, level) => sum + level.bestStars, 0);

        for (const restaurant of RESTAURANTS) {
            const source = raw.restaurants?.[restaurant.id];
            if (!source) {
                continue;
            }
            save.restaurants[restaurant.id] = {
                unlocked: source.unlocked === true,
                highestUnlockedLevel: Math.floor(clampNumber(source.highestUnlockedLevel, 0, 40, 0)),
                renovations: [...new Set((Array.isArray(source.renovations) ? source.renovations : []).filter((value) =>
                    restaurant.renovationMilestones.includes(value),
                ))].sort((a, b) => a - b),
                chapterComplete: source.chapterComplete === true,
            };
        }
        save.restaurants.r01.unlocked = true;
        save.restaurants.r01.highestUnlockedLevel = Math.max(1, save.restaurants.r01.highestUnlockedLevel);
        save.levels['r01-l01'].unlocked = true;

        for (const [key, level] of Object.entries(raw.upgrades ?? {})) {
            save.upgrades[key] = Math.floor(clampNumber(level, 1, 3, 1));
        }
        save.settlements = { ...(raw.settlements ?? {}) };
        save.upgradeTransactions = { ...(raw.upgradeTransactions ?? {}) };
        if (raw.checkpoint && save.levels[raw.checkpoint.levelId]?.unlocked && raw.checkpoint.attemptId) {
            save.checkpoint = { ...raw.checkpoint };
        }
        return save;
    }

}
