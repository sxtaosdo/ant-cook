import {
    GAME_CONTENT_COUNTS,
    LEVELS,
    P10GameCore,
    RunStatus,
} from '../assets/bundles/game/core/index';
import type { KitchenRun } from '../assets/bundles/game/core/index';

function equal<T>(actual: T, expected: T, message: string): void {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
    }
}

function truthy(value: unknown, message: string): void {
    if (!value) {
        throw new Error(message);
    }
}

function completeRun(run: KitchenRun): void {
    for (const order of run.snapshot.orders) {
        run.serveOrder(order.id);
    }
    equal(run.snapshot.status, RunStatus.Completed, 'run should complete');
}

function verifiesContentAndFullChapterClear(): P10GameCore {
    const game = P10GameCore.createNew();
    equal(GAME_CONTENT_COUNTS.restaurants, 6, 'restaurant count');
    equal(GAME_CONTENT_COUNTS.levels, 240, 'level count');
    truthy(LEVELS.every((level) => level.story.intro && level.story.outro), 'all levels have story beats');
    truthy(LEVELS.every((level) => level.objectiveScore === level.starThresholds[0]), 'level objectives');
    for (const restaurant of game.listRestaurants()) {
        equal(restaurant.levelIds.length, 40, `${restaurant.id} level count`);
    }

    for (let levelIndex = 1; levelIndex <= 40; levelIndex += 1) {
        const levelId = `r01-l${String(levelIndex).padStart(2, '0')}`;
        const run = game.startLevel(levelId, `chapter-attempt-${levelIndex}`);
        truthy(run.snapshot.orders.every((order) => Boolean(order.dishId)), `${levelId} order dish IDs`);
        completeRun(run);
        equal(run.snapshot.maxCombo, run.snapshot.orders.length, `${levelId} combo chain`);
        const receipt = game.settle(run, `chapter-settlement-${levelIndex}`);
        equal(receipt.success, true, `${levelId} settlement success`);
        equal(receipt.stars, 3, `${levelId} stars`);
        truthy(receipt.coinsGranted > 0, `${levelId} grants coins`);

        const duplicate = game.settle(run, `chapter-settlement-${levelIndex}`);
        equal(duplicate.coinsGranted, receipt.coinsGranted, 'settlement must be idempotent');
    }

    equal(game.progress.restaurants.r01.chapterComplete, true, 'first restaurant chapter complete');
    equal(game.progress.restaurants.r02.unlocked, true, 'second restaurant unlocked');
    equal(game.progress.levels['r02-l01'].unlocked, true, 'second restaurant first level unlocked');
    equal(game.progress.restaurants.r01.renovations.join(','), '10,25,40', 'renovation milestones');
    return game;
}

function verifiesFailure(game: P10GameCore): void {
    const coinsBefore = game.progress.coins;
    const run = game.startLevel('r02-l01', 'failure-attempt');
    run.tick(10_000);
    equal(run.snapshot.status, RunStatus.Failed, 'expired run should fail');
    const receipt = game.settle(run, 'failure-settlement');
    equal(receipt.success, false, 'failure receipt');
    equal(receipt.coinsGranted, 0, 'failure reward');
    equal(game.progress.coins, coinsBefore, 'failure does not change coins');
    equal(game.progress.levels['r02-l01'].failures, 1, 'failure count');
}

function verifiesUpgradeAndSettings(game: P10GameCore): void {
    const quote = game.getUpgradeQuote('r01', 'grill');
    equal(quote.affordable, true, 'upgrade affordability');
    const before = game.progress.coins;
    const receipt = game.purchaseUpgrade('r01', 'grill', 'upgrade-1');
    equal(receipt.applied, true, 'upgrade applied');
    equal(game.progress.coins, before - receipt.coinsSpent, 'upgrade coin deduction');
    const duplicate = game.purchaseUpgrade('r01', 'grill', 'upgrade-1');
    equal(duplicate.coinsSpent, receipt.coinsSpent, 'upgrade transaction idempotency');
    equal(game.progress.coins, before - receipt.coinsSpent, 'duplicate upgrade does not charge');

    const settings = game.updateSettings({
        musicVolume: 2,
        effectsVolume: -1,
        vibration: false,
        reducedMotion: true,
        colorBlindMode: true,
    });
    equal(settings.musicVolume, 1, 'music volume clamp');
    equal(settings.effectsVolume, 0, 'effects volume clamp');
    equal(settings.vibration, false, 'vibration setting');
    equal(settings.reducedMotion, true, 'reduced motion setting');
    equal(settings.colorBlindMode, true, 'color blind setting');
}

function verifiesCheckpointAndSerialization(game: P10GameCore): void {
    const run = game.startLevel('r02-l01', 'checkpoint-attempt');
    run.serveOrder(run.snapshot.orders[0].id);
    truthy(run.snapshot.score > 0, 'live run score');

    const restored = P10GameCore.load(game.serialize());
    const resumed = restored.resumeCheckpoint();
    truthy(resumed, 'checkpoint should restore');
    equal(resumed!.snapshot.score, 0, 'checkpoint resumes from wave start score');
    equal(resumed!.snapshot.servedOrders, 0, 'checkpoint resumes from wave start orders');
    equal(restored.progress.settings.reducedMotion, true, 'settings survive serialization');
    equal(restored.progress.upgrades['r01:grill'], 2, 'upgrade survives serialization');
    equal(restored.progress.restaurants.r02.unlocked, true, 'unlock survives serialization');
}

function verifiesV1Migration(): void {
    const legacy = JSON.stringify({
        version: 1,
        coins: 321,
        starsByLevel: {
            'r03-l25': 1,
            'r02-l40': 1,
            'r01-l40': 2,
        },
        upgrades: { 'r01:prep': 2 },
        settings: { vibration: false },
    });
    const migrated = P10GameCore.load(legacy);
    equal(migrated.progress.coins, 321, 'migrated coins');
    equal(migrated.progress.reputation, 4, 'migrated reputation');
    equal(migrated.progress.levels['r01-l40'].bestStars, 2, 'migrated stars');
    equal(migrated.progress.restaurants.r01.chapterComplete, true, 'migration chapter complete');
    equal(migrated.progress.restaurants.r01.renovations.join(','), '10,25,40', 'migration renovations');
    equal(migrated.progress.restaurants.r02.unlocked, true, 'migration unlocks next restaurant');
    equal(migrated.progress.restaurants.r02.chapterComplete, true, 'migration second chapter complete');
    equal(migrated.progress.restaurants.r02.renovations.join(','), '10,25,40', 'migration second renovations');
    equal(migrated.progress.restaurants.r03.highestUnlockedLevel, 26, 'migration preserves higher progress');
    equal(migrated.progress.levels['r03-l26'].unlocked, true, 'migration unlocks next level');
    equal(migrated.progress.restaurants.r03.renovations.join(','), '10,25', 'migration partial renovations');
    equal(migrated.progress.upgrades['r01:prep'], 2, 'migrated upgrade');
    equal(migrated.progress.settings.vibration, false, 'migrated settings');
}

const game = verifiesContentAndFullChapterClear();
verifiesFailure(game);
verifiesUpgradeAndSettings(game);
verifiesCheckpointAndSerialization(game);
verifiesV1Migration();
console.log('P10 game core smoke: PASS');
