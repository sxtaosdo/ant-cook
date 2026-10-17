import assert from 'node:assert/strict';
import test from 'node:test';
import {
    COOK_GLOBAL_LEVEL_MAX,
    decodeCookGlobalLevel,
    encodeCookGlobalLevel,
} from '../../assets/bundles/game/application/cookLevelAddress.ts';
import { CookLevelSession } from '../../assets/bundles/game/application/cookLevelSession.ts';
import { P10CookApplication } from '../../assets/bundles/game/application/P10CookApplication.ts';
import { MemoryStorageAdapter } from '../../assets/bundles/game/infrastructure/save/MemoryStorageAdapter.ts';
import { RunStatus } from '../../assets/bundles/game/core/types.ts';

function createSession(): { app: P10CookApplication; session: CookLevelSession } {
    let sequence = 0;
    const app = new P10CookApplication({
        storage: new MemoryStorageAdapter(),
        clock: () => 200 + sequence,
        idGenerator: (seed) => `${seed}-${sequence++}`,
        saveScope: { frameworkVersion: '2.0.7', sectionId: 'cook.session.test', primaryKey: 'cook.session.test.progress' },
    });
    assert.equal(app.start().ok, true);
    return { app, session: new CookLevelSession(app) };
}

test('cook global level codec maps 1..240 to six restaurants × 40 levels', () => {
    assert.equal(encodeCookGlobalLevel(0, 0), 1);
    assert.equal(encodeCookGlobalLevel(0, 39), 40);
    assert.equal(encodeCookGlobalLevel(5, 39), 240);
    assert.equal(encodeCookGlobalLevel(-1, 0), null);
    assert.equal(encodeCookGlobalLevel(0, 40), null);
    assert.deepEqual(decodeCookGlobalLevel(1), { restaurantIndex: 0, levelIndex: 0 });
    assert.deepEqual(decodeCookGlobalLevel(41), { restaurantIndex: 1, levelIndex: 0 });
    assert.deepEqual(decodeCookGlobalLevel(240), { restaurantIndex: 5, levelIndex: 39 });
    assert.equal(decodeCookGlobalLevel(0), null);
    assert.equal(decodeCookGlobalLevel(COOK_GLOBAL_LEVEL_MAX + 1), null);
});

test('CookLevelSession bootReady and startLevel/retry/next/showHome gate the kitchen loop', (t) => {
    const { app, session } = createSession();
    t.after(() => app.dispose());
    assert.equal(app.isStarted, true);
    assert.equal(session.bootReady(), true);
    assert.equal(session.startLevel(0), false);
    assert.equal(session.startLevel(1), true);
    assert.equal(app.read().kitchen?.status, RunStatus.Running);
    const firstAttempt = app.read().kitchen!.attemptId;
    assert.equal(app.read().selection.restaurantIndex, 0);
    assert.equal(app.read().selection.levelIndex, 0);

    assert.equal(session.retry(), true);
    assert.equal(app.read().kitchen?.status, RunStatus.Running);
    assert.notEqual(app.read().kitchen!.attemptId, firstAttempt);

    // Business state owns settlement; the page StateMachine owns the displayed screen.
    let guard = 100;
    while (app.read().kitchen?.status === RunStatus.Running && guard-- > 0) {
        const pending = app.read().kitchen?.orders.find((order) => order.state === 'Pending');
        assert.ok(pending);
        const served = app.dispatch({ type: 'p10.serve-dish', payload: { dishId: pending.dishId } });
        assert.equal(served.ok, true);
    }
    assert.ok(guard > 0, 'level should settle within the bounded serve loop');
    assert.equal(app.read().kitchen, null, 'settlement releases the active kitchen');
    assert.ok(app.read().result);
    assert.equal(app.read().lastSuccess, true);
    assert.equal(session.nextLevel(), true);
    assert.equal(app.read().kitchen?.status, RunStatus.Running);
    assert.equal(app.read().selection.levelIndex, 1);

    assert.equal(session.showHome(), true);
    assert.equal(app.read().kitchen, null);
    assert.equal(app.hasCheckpoint, false);
});

test('CookLevelSession reset reopens the current global level', (t) => {
    const { app, session } = createSession();
    t.after(() => app.dispose());
    assert.equal(session.startLevel(1), true);
    const firstAttempt = app.read().kitchen!.attemptId;
    assert.equal(session.reset(1), true);
    assert.equal(app.read().selection.levelIndex, 0);
    assert.equal(app.read().kitchen?.status, RunStatus.Running);
    assert.notEqual(app.read().kitchen!.attemptId, firstAttempt);
});
