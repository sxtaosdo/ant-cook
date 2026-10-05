import type { LevelConfig, RestaurantConfig } from './types';

const RESTAURANT_NAMES = [
    '煎饼早餐',
    '岭南早茶',
    '川味小馆',
    '西北面坊',
    '江南夜市',
    '海港烧烤',
] as const;

const RESTAURANT_DISHES = [
    ['jianbing', 'soy_milk', 'tea_egg'],
    ['shrimp_dumpling', 'siu_mai', 'rice_roll'],
    ['mapo_tofu', 'spicy_noodle', 'kungpao_chicken'],
    ['beef_noodle', 'roujiamo', 'lamb_skewer'],
    ['wonton', 'fried_bun', 'sweet_rice_cake'],
    ['grilled_fish', 'oyster', 'seafood_skewer'],
] as const;

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

function createLevel(restaurantIndex: number, levelIndex: number): LevelConfig {
    const restaurantId = `r${pad(restaurantIndex)}`;
    const restaurantName = RESTAURANT_NAMES[restaurantIndex - 1];
    const orderCount = 3 + levelIndex;
    const orderBaseScore = 90 + restaurantIndex * 10 + levelIndex * 10;
    const oneStar = orderCount * orderBaseScore;
    return {
        id: `${restaurantId}-l${pad(levelIndex)}`,
        restaurantId,
        index: levelIndex,
        durationSeconds: 28 + orderCount * 7,
        orderCount,
        orderBaseScore,
        orderPatienceSeconds: 18 + levelIndex * 2,
        dishPool: [...RESTAURANT_DISHES[restaurantIndex - 1]],
        story: {
            title: `${restaurantName}·第${levelIndex}章`,
            intro: `完成第${levelIndex}场营业，帮助街坊守住${restaurantName}的招牌。`,
            outro: `今日营业目标达成，${restaurantName}离焕新又近了一步。`,
        },
        maxLostCustomers: Math.max(1, Math.floor(orderCount / 3)),
        objectiveScore: oneStar,
        starThresholds: [oneStar, Math.ceil(oneStar * 1.2), Math.ceil(oneStar * 1.38)],
        baseReward: 100 + restaurantIndex * 20 + levelIndex * 10,
        firstClearBonus: 80 + restaurantIndex * 20,
    };
}

export const RESTAURANTS: readonly RestaurantConfig[] = RESTAURANT_NAMES.map((name, offset) => {
    const restaurantIndex = offset + 1;
    const id = `r${pad(restaurantIndex)}`;
    return {
        id,
        name,
        levelIds: Array.from({ length: 40 }, (_, levelOffset) => `${id}-l${pad(levelOffset + 1)}`),
        renovationMilestones: [10, 25, 40],
    };
});

export const LEVELS: readonly LevelConfig[] = RESTAURANTS.flatMap((restaurant, offset) =>
    restaurant.levelIds.map((_, levelOffset) => createLevel(offset + 1, levelOffset + 1)),
);

const LEVEL_BY_ID = new Map(LEVELS.map((level) => [level.id, level]));
const RESTAURANT_BY_ID = new Map(RESTAURANTS.map((restaurant) => [restaurant.id, restaurant]));

export function getLevelConfig(levelId: string): LevelConfig {
    const level = LEVEL_BY_ID.get(levelId);
    if (!level) {
        throw new Error(`Unknown level: ${levelId}`);
    }
    return level;
}

export function getRestaurantConfig(restaurantId: string): RestaurantConfig {
    const restaurant = RESTAURANT_BY_ID.get(restaurantId);
    if (!restaurant) {
        throw new Error(`Unknown restaurant: ${restaurantId}`);
    }
    return restaurant;
}

export function nextRestaurantId(restaurantId: string): string | undefined {
    const index = RESTAURANTS.findIndex((restaurant) => restaurant.id === restaurantId);
    return index >= 0 ? RESTAURANTS[index + 1]?.id : undefined;
}
