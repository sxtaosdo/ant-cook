import assert from 'node:assert/strict';
import test from 'node:test';
import { P10CookApplication } from '../assets/bundles/game/application/P10CookApplication.ts';
import type { StoragePort } from '../assets/bundles/game/application/contracts.ts';
import { MemoryStorageAdapter } from '../assets/bundles/game/infrastructure/save/MemoryStorageAdapter.ts';

const LEGACY_KEY = 'p10_cook_game_save_v2';
const FRAMEWORK_KEY = 'p10_cook_framework_snapshot_v1';

function start(storage: StoragePort): P10CookApplication {
    const app = new P10CookApplication({
        storage,
        clock: () => 123,
        idGenerator: (seed) => seed,
    });
    app.start();
    return app;
}

test('v1 and v2 legacy saves migrate to FrameworkSnapshot and keep the rollback key', () => {
    for (const legacy of [
        { version: 1, coins: 321, starsByLevel: { 'r01-l01': 2 } },
        { version: 2, coins: 654, levels: {}, restaurants: {}, upgrades: {}, settings: {}, settlements: {}, upgradeTransactions: {} },
    ]) {
        const storage = new MemoryStorageAdapter();
        const raw = JSON.stringify(legacy);
        storage.setItem(LEGACY_KEY, raw);
        const app = start(storage);
        assert.equal(app.read().progress.coins, legacy.coins);
        assert.equal(storage.getItem(LEGACY_KEY), raw);
        const snapshot = JSON.parse(storage.getItem(FRAMEWORK_KEY) ?? 'null') as { schemaVersion?: number; sections?: object };
        assert.equal(snapshot.schemaVersion, 1);
        assert.ok(snapshot.sections && 'p10-cook.save.game' in snapshot.sections);
        app.shutdown();
    }
});

test('FrameworkSnapshot restarts without consulting a changed legacy rollback key', () => {
    const storage = new MemoryStorageAdapter();
    storage.setItem(LEGACY_KEY, JSON.stringify({ version: 1, coins: 777 }));
    const first = start(storage);
    assert.equal(first.read().progress.coins, 777);
    first.shutdown();
    storage.setItem(LEGACY_KEY, JSON.stringify({ version: 1, coins: 1 }));
    const second = start(storage);
    assert.equal(second.read().progress.coins, 777);
    second.shutdown();
});

test('corrupt JSON, unknown version and missing section recover to a new save with structured errors', () => {
    const cases = [
        '{broken',
        JSON.stringify({ schemaVersion: 1, frameworkVersion: '9.9.9', sections: {} }),
        JSON.stringify({ schemaVersion: 1, frameworkVersion: '1.5.0', sections: {} }),
    ];

    for (const primary of cases) {
        const storage = new MemoryStorageAdapter();
        storage.setItem(FRAMEWORK_KEY, primary);
        storage.setItem(LEGACY_KEY, '{also-broken');
        const app = start(storage);
        const read = app.read();
        assert.equal(read.progress.coins, 0);
        assert.equal(read.saveStatus.state, 'error');
        assert.equal(read.error?.code, 'SAVE');
        assert.ok(read.saveStatus.details.sectionErrors.length > 0);
        assert.equal(storage.getItem(LEGACY_KEY), '{also-broken');
        assert.doesNotThrow(() => JSON.parse(storage.getItem(FRAMEWORK_KEY) ?? ''));
        app.shutdown();
    }
});

test('write failure is surfaced and does not masquerade as a valid save', () => {
    class FailingStorage implements StoragePort {
        public getItem(): string | null { return null; }
        public setItem(): void { throw new Error('quota exceeded'); }
        public removeItem(): void {}
    }
    const app = start(new FailingStorage());
    assert.equal(app.read().saveStatus.state, 'error');
    assert.equal(app.read().error?.code, 'SAVE');
    assert.match(app.read().error?.message ?? '', /SAVE_SECTION_WRITE_FAILED/);
    app.shutdown();
});
