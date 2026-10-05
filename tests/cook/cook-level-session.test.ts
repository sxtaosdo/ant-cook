import assert from 'node:assert/strict';
import test from 'node:test';
import {
    COOK_GLOBAL_LEVEL_MAX,
    decodeCookGlobalLevel,
    encodeCookGlobalLevel,
} from '../assets/bundles/game/application/cookLevelAddress.ts';
import { CookLevelSession } from '../assets/bundles/game/application/cookLevelSession.ts';
import { P10CookApplication } from '../assets/bundles/game/application/P10CookApplication.ts';
import { MemoryStorageAdapter } from '../assets/bundles/game/infrastructure/save/MemoryStorageAdapter.ts';

function createSession(): { app: P10CookApplication; session: CookLevelSession } {
    let sequence = 0;
    const app = new P10CookApplication({
        storage: new MemoryStorageAdapter(),
        clock: () => 200 + sequence,
        idGenerator: (seed) => `${seed}-${sequence++}`,
    });
    app.start();
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

test('CookLevelSession bootReady and startLevel/retry/next/showHome gate the kitchen loop', () => {
    const { app, session } = createSession();
    assert.equal(app.isStarted, true);
    assert.equal(session.bootReady(), true);
    assert.equal(session.startLevel(0), false);
    assert.equal(session.startLevel(1), true);
    assert.equal(app.read().screen, 'kitchen');
    assert.equal(app.read().selection.restaurantIndex, 0);
    assert.equal(app.read().selection.levelIndex, 0);

    assert.equal(session.retry(), true);
    assert.equal(app.read().screen, 'kitchen');

    // settle by serving until result
    let guard = 100;
    while (app.read().screen === 'kitchen' && guard-- > 0) {
        const pending = app.read().kitchen?.orders.find((order) => order.state === 'Pending');
        assert.ok(pending);
        const served = app.dispatch({ type: 'p10.serve-dish', payload: { dishId: pending.dishId } });
        assert.equal(served.ok, true);
    }
    assert.equal(app.read().screen, 'result');
    assert.equal(session.nextLevel(), true);
    assert.equal(app.read().screen, 'kitchen');
    assert.equal(app.read().selection.levelIndex, 1);

    assert.equal(session.showHome(), true);
    assert.equal(app.read().screen, 'map');
    app.shutdown();
});

test('CookLevelSession reset reopens the current global level', () => {
    const { app, session } = createSession();
    assert.equal(session.startLevel(1), true);
    assert.equal(session.reset(1), true);
    assert.equal(app.read().selection.levelIndex, 0);
    assert.equal(app.read().screen, 'kitchen');
    app.shutdown();
});
