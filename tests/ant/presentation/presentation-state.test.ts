import assert from 'node:assert/strict';
import test from 'node:test';
import './collection-flight.test.js';
import './collection-flight-motion.test.mjs';
import { leaderboardTestConfig, socialTestConfig } from '../support/leaderboardTestConfig';
import './construction-presentation.test.js';
import './leaderboard-presentation.test.mjs';
import './social-presentation.test.js';
import './transport-movement.test.mjs';
import './page-lifecycle.test.mjs';
import './speed-feedback.test.mjs';
import './gm-session.test.mjs';
import { StateMachine, type IState } from 'db://shidai3/index';
import { createProgressPreviewFixture, createProgressPreviewSession } from '../../assets/Colony/scripts/testing/progressPreviewFixture.js';

test('legacy Preview profiles retain GM-only permissions across their memory restart', () => {
  const fixture = createProgressPreviewFixture(0, '2026-10-04', leaderboardTestConfig, socialTestConfig);
  fixture.applyTestResources('diamonds');
  assert.ok(fixture.snapshot().diamonds >= 100);
  assert.equal(fixture.startRound(7).levelId, 7);
  const session = createProgressPreviewSession(0, '2026-10-04', leaderboardTestConfig, socialTestConfig);
  session.progress.applyTestResources('coins');
  const originalCoins = session.progress.snapshot().coins;
  const restored = session.restart(); restored.applyTestResources('speed');
  assert.equal(restored.snapshot().coins, originalCoins);
  assert.equal(restored.startRound(60).levelId, 60);
});

test('Preview chooses a daily date in isolated memory and preserves its default profile', () => {
  assert.equal(createProgressPreviewFixture(59, '2026-09-25', leaderboardTestConfig, socialTestConfig).snapshot().daily.day, '2026-09-25');
  assert.equal(createProgressPreviewFixture(60, '2026-09-25', leaderboardTestConfig, socialTestConfig).snapshot().daily.day, '2026-10-02');
  const maximum = createProgressPreviewFixture(59, '2026-10-03', leaderboardTestConfig, socialTestConfig);
  assert.equal(maximum.snapshot().daily.day, '2026-10-03');
  assert.equal(maximum.dailyChallengeIndex(), 29);
});

test('Preview rejects invalid dates before creating a QA profile', () => {
  for (const day of ['invalid', '2026-02-30', '2026-2-03']) {
    assert.throws(() => createProgressPreviewFixture(59, day, leaderboardTestConfig, socialTestConfig), /Invalid Preview day/);
  }
});

test('state machine exits before enter and re-enters a fresh state instance', async () => {
  const calls: string[] = [];
  type TestContext = { readonly calls: string[] };
  class HomeTestState implements IState<TestContext> {
    public context!: TestContext;
    public enter(): void { this.context.calls.push('home.enter'); }
    public exit(): void { this.context.calls.push('home.exit'); }
  }
  class PlayTestState implements IState<TestContext> {
    public context!: TestContext;
    public enter(): void { this.context.calls.push('play.enter'); }
    public exit(): void { this.context.calls.push('play.exit'); }
  }
  const machine = new StateMachine<TestContext>({ calls });
  await machine.changeState(HomeTestState);
  await machine.changeState(PlayTestState);
  await machine.changeState(PlayTestState);
  assert.deepEqual(calls, [
    'home.enter',
    'home.exit', 'play.enter',
    'play.exit', 'play.enter',
  ]);
});

test('state machine manages global states and clears every context on release', async () => {
  const calls: string[] = [];
  type TestContext = { readonly calls: string[] };
  class GlobalState implements IState<TestContext> {
    public static lastInstance: GlobalState | null = null;
    public context!: TestContext;
    public constructor() { GlobalState.lastInstance = this; }
    public enter(): void { this.context.calls.push('global.enter'); }
    public exit(): void { this.context.calls.push('global.exit'); }
    public update(): void { this.context.calls.push('global.update'); }
  }
  class CurrentState implements IState<TestContext> {
    public static lastInstance: CurrentState | null = null;
    public context!: TestContext;
    public constructor() { CurrentState.lastInstance = this; }
    public enter(): void { this.context.calls.push('current.enter'); }
    public exit(): void { this.context.calls.push('current.exit'); }
    public update(): void { this.context.calls.push('current.update'); }
  }
  const machine = new StateMachine<TestContext>({ calls });
  await machine.addGlobalState(GlobalState);
  await machine.changeState(CurrentState);
  await machine.update();
  await machine.releaseAllStates();
  assert.deepEqual(calls, [
    'global.enter', 'current.enter', 'global.update', 'current.update',
    'current.exit', 'global.exit',
  ]);
  assert.equal(GlobalState.lastInstance?.context, null);
  assert.equal(CurrentState.lastInstance?.context, null);
  assert.equal('rollback' in machine, false);
  assert.equal('stateStack' in machine, false);
});

test('removing a global state exits it and clears its context', async () => {
  const calls: string[] = [];
  type TestContext = { readonly calls: string[] };
  class GlobalState implements IState<TestContext> {
    public static lastInstance: GlobalState | null = null;
    public context!: TestContext;
    public constructor() { GlobalState.lastInstance = this; }
    public enter(): void { this.context.calls.push('global.enter'); }
    public exit(): void { this.context.calls.push('global.exit'); }
  }
  const machine = new StateMachine<TestContext>({ calls });
  await machine.addGlobalState(GlobalState);
  await machine.removeGlobalState(GlobalState);
  assert.deepEqual(calls, ['global.enter', 'global.exit']);
  assert.equal(GlobalState.lastInstance?.context, null);
});

test('state machine retains the current instance for page queries', async () => {
  type TestContext = { readonly id: number };
  class PlayTestState implements IState<TestContext> {
    public context!: TestContext;
    public enter(): void {}
    public exit(): void {}
  }
  class HomeTestState implements IState<TestContext> {
    public context!: TestContext;
    public enter(): void {}
    public exit(): void {}
  }
  const machine = new StateMachine<TestContext>({ id: 1 });
  await machine.changeState(PlayTestState);
  assert.equal(machine.is(PlayTestState), true);
  await machine.changeState(HomeTestState);
  assert.equal(machine.is(PlayTestState), false);
  assert.equal(machine.is(HomeTestState), true);
});

import './settings-controls.test.mjs';
import './level-rail-return.test.mjs';
