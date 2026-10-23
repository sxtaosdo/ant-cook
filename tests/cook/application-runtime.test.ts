import assert from 'node:assert/strict';
import test from 'node:test';
import { P10CookApplication } from '../../assets/bundles/game/application/P10CookApplication.ts';
import type { P10Intent, StoragePort } from '../../assets/bundles/game/application/contracts.ts';
import { LEVELS, P10GameCore, RESTAURANTS } from '../../assets/bundles/game/core/index.ts';
import { createDefaultSave } from '../../assets/bundles/game/core/SaveCodec';
import { FrameworkSaveCoordinatorAdapter } from '../../assets/bundles/game/infrastructure/save/SaveCoordinatorAdapter';
import { MemoryStorageAdapter } from '../../assets/bundles/game/infrastructure/save/MemoryStorageAdapter.ts';

function createApplication(storage: StoragePort = new MemoryStorageAdapter(), fixedId?: string) {
    let sequence = 0;
    const app = new P10CookApplication({
        storage,
        saveScope: { frameworkVersion: '2.0.7', sectionId: 'cook.runtime.test', primaryKey: 'cook.runtime.test.progress' },
        clock: () => 100 + sequence,
        idGenerator: (seed) => fixedId ?? `${seed}-${sequence++}`,
    });
    app.start();
    return app;
}

function seedOwnSave(storage: StoragePort, value: ReturnType<typeof createDefaultSave>): void {
    let core = P10GameCore.load(JSON.stringify(value));
    const adapter = new FrameworkSaveCoordinatorAdapter(storage, { frameworkVersion: '2.0.7', sectionId: 'cook.runtime.test', primaryKey: 'cook.runtime.test.progress' });
    assert.equal(adapter.attachCoreState(() => core, restored => { core = restored; }).ok, true);
    assert.equal(adapter.save().ok, true);
}

function dispatch(app: P10CookApplication, intent: P10Intent): void {
    const result = app.dispatch(intent);
    assert.equal(result.ok, true, result.ok ? undefined : result.error.message);
}

function startFirstLevel(app: P10CookApplication): void {
    dispatch(app, { type: 'p10.select-restaurant', payload: { restaurantIndex: 0 } });
    dispatch(app, { type: 'p10.select-level', payload: { levelIndex: 0 } });
    dispatch(app, { type: 'p10.start-level', payload: {} });
}

function completeCurrentLevel(app: P10CookApplication): void {
    let guard = 100;
    while (app.read().kitchen !== null && guard-- > 0) {
        const pending = app.read().kitchen?.orders.find((order) => order.state === 'Pending');
        assert.ok(pending, 'running kitchen must expose a pending order');
        dispatch(app, { type: 'p10.serve-dish', payload: { dishId: pending.dishId } });
    }
    assert.ok(guard > 0, 'level should settle');
}

test('catalog exposes six restaurants and 240 unique levels through the read model', () => {
    const app = createApplication();
    const read = app.read();
    assert.equal(read.catalog.restaurants.length, 6);
    assert.equal(read.catalog.levels.length, 240);
    assert.equal(new Set(read.catalog.levels.map((level) => level.id)).size, 240);
    assert.deepEqual(read.catalog.restaurants.map((restaurant) => restaurant.levelIds.length), [40, 40, 40, 40, 40, 40]);
    assert.equal(RESTAURANTS.length, 6);
    assert.equal(LEVELS.length, 240);
    app.shutdown();
});

test('success, pause, resume, failure and result continuation preserve the previous flow', () => {
    const app = createApplication();
    startFirstLevel(app);

    const beforePause = app.read().kitchen?.remainingSeconds;
    dispatch(app, { type: 'p10.pause', payload: {} });
    app.update(5);
    assert.equal(app.read().kitchen?.remainingSeconds, beforePause);
    dispatch(app, { type: 'p10.resume', payload: {} });
    app.update(1);
    assert.ok((app.read().kitchen?.remainingSeconds ?? 0) < (beforePause ?? 0));

    completeCurrentLevel(app);
    assert.equal(app.read().kitchen, null);
    assert.ok(app.read().result);
    assert.equal(app.read().result?.success, true);
    dispatch(app, { type: 'p10.next-after-result', payload: {} });
    assert.ok(app.read().kitchen);
    assert.equal(app.read().selection.levelIndex, 1);

    app.update(10000);
    assert.equal(app.read().kitchen, null);
    assert.ok(app.read().result);
    assert.equal(app.read().result?.success, false);
    dispatch(app, { type: 'p10.next-after-result', payload: {} });
    assert.ok(app.read().kitchen);
    assert.equal(app.read().selection.levelIndex, 1);
    app.shutdown();
});

test('wrong dish consumes patience without serving an order', () => {
    const app = createApplication();
    startFirstLevel(app);
    const before = app.read().kitchen;
    assert.ok(before);
    dispatch(app, { type: 'p10.serve-dish', payload: { dishId: 'not-a-real-dish' } });
    const after = app.read().kitchen;
    assert.ok(after);
    assert.equal(after.servedOrders, before.servedOrders);
    assert.ok(after.orders[0].patienceRemaining < before.orders[0].patienceRemaining);
    app.shutdown();
});

test('settlement and upgrade transaction ids are idempotent', () => {
    const run = P10GameCore.createNew().startLevel('r01-l01', 'attempt-fixed');
    while (run.snapshot.status === 'Running') {
        const pending = run.snapshot.orders.find((order) => order.state === 'Pending');
        assert.ok(pending);
        run.serveOrder(pending.id);
    }
    const core = P10GameCore.createNew();
    const settledRun = core.startLevel('r01-l01', 'attempt-fixed');
    while (settledRun.snapshot.status === 'Running') {
        const pending = settledRun.snapshot.orders.find((order) => order.state === 'Pending');
        assert.ok(pending);
        settledRun.serveOrder(pending.id);
    }
    const first = core.settle(settledRun, 'settlement-fixed');
    const coins = core.progress.coins;
    const second = core.settle(settledRun, 'settlement-fixed');
    assert.deepEqual(second, first);
    assert.equal(core.progress.coins, coins);

    const storage = new MemoryStorageAdapter();
    const seed = createDefaultSave(); seed.coins = 10000; seedOwnSave(storage, seed);
    const app = createApplication(storage, 'upgrade-fixed');
    const quote = app.read().upgradeQuotes.grill;
    assert.equal(quote.currentLevel, 1);
    assert.equal(quote.affordable, true);
    dispatch(app, { type: 'p10.purchase-upgrade', payload: { restaurantId: 'r01', stationId: 'grill' } });
    const coinsAfterFirst = app.read().progress.coins;
    dispatch(app, { type: 'p10.purchase-upgrade', payload: { restaurantId: 'r01', stationId: 'grill' } });
    assert.equal(app.read().progress.coins, coinsAfterFirst);
    assert.equal(app.read().upgradeQuotes.grill.currentLevel, 2);
    app.shutdown();
});

test('own saved progression restores renovations and the unlocked next restaurant', () => {
    const storage = new MemoryStorageAdapter();
    const seed = createDefaultSave();
    for (const levelId of RESTAURANTS[0].levelIds) { seed.levels[levelId].bestStars = 3; seed.levels[levelId].unlocked = true; }
    seed.restaurants.r01 = { unlocked: true, highestUnlockedLevel: 40, renovations: [10,25,40], chapterComplete: true };
    seed.restaurants.r02.unlocked = true; seed.restaurants.r02.highestUnlockedLevel = 1; seed.levels['r02-l01'].unlocked = true;
    seedOwnSave(storage, seed);
    const app = createApplication(storage);
    const progress = app.read().progress;
    assert.deepEqual(progress.restaurants.r01.renovations, [10, 25, 40]);
    assert.equal(progress.restaurants.r01.chapterComplete, true);
    assert.equal(progress.restaurants.r02.unlocked, true);
    assert.equal(progress.levels['r02-l01'].unlocked, true);
    app.shutdown();
});

test('command, query, event, immutable snapshot and shutdown cleanup use P0002 runtimes', () => {
    const app = createApplication();
    const events: string[] = [];
    const unsubscribe = app.subscribeToEvents((event) => events.push(event.type));
    startFirstLevel(app);
    app.update(1);
    assert.ok(events.includes('p10.kitchen-updated'));
    const queried = app.dispatch({ type: 'p10.read', payload: {} });
    assert.equal(queried.ok, true);

    const snapshot = app.read();
    (snapshot.catalog.restaurants as unknown as Array<{ name: string }>)[0].name = 'mutated';
    (snapshot.progress.settings as { vibration: boolean }).vibration = false;
    assert.notEqual(app.read().catalog.restaurants[0].name, 'mutated');
    assert.equal(app.read().progress.settings.vibration, true);

    unsubscribe();
    app.shutdown();
    const afterShutdown = app.dispatch({ type: 'p10.read', payload: {} });
    assert.equal(afterShutdown.ok, false);
});
