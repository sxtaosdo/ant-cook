/** 全局关号 1..240 ↔ 餐厅/关卡下标（每店 40 关）。 */
export const COOK_LEVELS_PER_RESTAURANT = 40;
export const COOK_RESTAURANT_COUNT = 6;
export const COOK_GLOBAL_LEVEL_MIN = 1;
export const COOK_GLOBAL_LEVEL_MAX = COOK_RESTAURANT_COUNT * COOK_LEVELS_PER_RESTAURANT;

export interface CookLevelAddress {
    readonly restaurantIndex: number;
    readonly levelIndex: number;
}

export function encodeCookGlobalLevel(restaurantIndex: number, levelIndex: number): number | null {
    if (
        !Number.isInteger(restaurantIndex)
        || !Number.isInteger(levelIndex)
        || restaurantIndex < 0
        || restaurantIndex >= COOK_RESTAURANT_COUNT
        || levelIndex < 0
        || levelIndex >= COOK_LEVELS_PER_RESTAURANT
    ) {
        return null;
    }
    return restaurantIndex * COOK_LEVELS_PER_RESTAURANT + levelIndex + 1;
}

export function decodeCookGlobalLevel(globalLevel: number): CookLevelAddress | null {
    if (!Number.isInteger(globalLevel) || globalLevel < COOK_GLOBAL_LEVEL_MIN || globalLevel > COOK_GLOBAL_LEVEL_MAX) {
        return null;
    }
    const zeroBased = globalLevel - 1;
    return {
        restaurantIndex: Math.floor(zeroBased / COOK_LEVELS_PER_RESTAURANT),
        levelIndex: zeroBased % COOK_LEVELS_PER_RESTAURANT,
    };
}
