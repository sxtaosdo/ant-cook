import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function loadSource(path, require) {
  const exports = {};
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, useDefineForClassFields: false,
  } }).outputText, { exports, require, console });
  return exports;
}
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture(remainingMs = 300) {
  const state = { remainingMs, day: '2026-10-11', result: 'PLAYING', activeWorkers: 1, delta: 0, feedback: [], draws: [], consumed: [], controls: [], attempts: 0, guideCalls: 0 };
  const directorEvents = new Map(), gameEvents = new Map();
  const director = { on: (key, action) => directorEvents.set(key, action), off: key => directorEvents.delete(key), getDeltaTime: () => state.delta };
  const game = { on: (key, action) => gameEvents.set(key, action), off: key => gameEvents.delete(key) };
  const context = {
    generation: 1, StateMachine: { current: {} }, round: { id: 'round-1' }, destroyed: false, navigating: false,
    inputLocked: false, progressPopup: null, popupRoot: {}, play: { snapshot: () => ({ result: state.result }) },
    app: { setError: error => { state.error = error; } },
    guide: { cancel: async () => { state.guideCalls++; if (state.failGuide) throw new Error('guide cleanup failed'); if (state.guideWait) await state.guideWait; } },
    progress: {
      readSpeedBoost: () => { if (state.failRead) throw new Error('storage failed'); return { day: state.day, remainingMs: state.remainingMs }; },
      reserveSpeedBoost: requested => { const ms = Math.min(requested, state.remainingMs); state.remainingMs -= ms; return { day: state.day, ms }; },
      refundSpeedBoost: (day, ms) => { if (day === state.day) state.remainingMs += ms; },
    },
    dailyActivity: { boost: ms => state.consumed.push(ms), flush() {} },
    hudView: {
      bind: cycle => { state.cycle = cycle; }, hideRailBackground() {},
      setSpeedBoost: (...draw) => state.draws.push(draw), setFeedback: message => state.feedback.push(message),
    },
  };
  class ProgressControl {
    constructor(_root, navigation) { this.navigation = navigation; state.controls.push(this); }
    async whenOpened() { if (state.openWait) await state.openWait; if (state.failOpen) throw new Error('missing resource'); }
    async forceClose() { this.navigation.closing(); this.navigation.closed(); }
    close() { this.navigation.closing(); this.navigation.closed(); }
  }
  const { ProgressPresentation } = loadSource('assets/Colony/scripts/presentation/progressPresentation.ts', module => {
    if (module.endsWith('/progressControl')) return { ProgressControl };
    if (module.endsWith('/progressView')) return { ColonyProgressView: class {} };
    if (module.endsWith('/playState')) return { PlayState: { current: () => null } };
    return {};
  });
  const actualOpen = ProgressPresentation.open.bind(ProgressPresentation);
  ProgressPresentation.open = (...args) => { state.attempts++; return actualOpen(...args); };
  const speed = loadSource('assets/Colony/scripts/application/speedBoost.ts', () => ({}));
  const { SpeedBoostPresentation } = loadSource('assets/Colony/scripts/presentation/speedBoostPresentation.ts', module => {
    if (module === 'cc') return { director, Director: { EVENT_BEFORE_UPDATE: 'update' }, game, Game: { EVENT_HIDE: 'hide', EVENT_SHOW: 'show' } };
    if (module.endsWith('/speedBoost')) return speed;
    return { ProgressPresentation };
  });
  const presentation = new SpeedBoostPresentation(context, {
    get evidence() { return { activeWorkers: state.activeWorkers }; },
    setSpeedMultiplier: multiplier => { state.multiplier = multiplier; },
  });
  return { state, context, presentation, ProgressPresentation,
    frame(ms = 0) { state.delta = ms / 1000; directorEvents.get('update')?.(); },
    hide() { gameEvents.get('hide')(); }, show() { gameEvents.get('show')(); },
    holdGuide() { state.guideWait = new Promise(resolve => { state.finishGuide = () => { state.guideWait = null; resolve(); }; }); },
    holdOpen() { state.openWait = new Promise(resolve => { state.finishOpen = () => { state.openWait = null; resolve(); }; }); },
  };
}

test('natural manual depletion returns to 1x and opens once without a second speed-button tap', async () => {
  const f = fixture(); f.state.cycle(); f.frame(300); await flush();
  assert.equal(f.state.multiplier, 1); assert.deepEqual(f.state.consumed, [300]);
  assert.equal(f.state.controls.length, 1); assert.equal(f.context.progressPopup, f.state.controls[0]);
  f.frame(300); f.state.controls[0].close(); f.frame(300); await flush();
  assert.equal(f.state.attempts, 1); assert.equal(f.context.progressPopup, null);
});

test('manual speed keeps the full balance between transports and depletes only while workers are active', async () => {
  const f = fixture(1000); f.state.activeWorkers = 0; f.state.cycle();
  f.frame(5000); await flush();
  assert.equal(f.presentation.evidence.remainingMs, 1000);
  assert.equal(f.state.multiplier, 2); assert.deepEqual(f.state.consumed, []);
  assert.equal(f.state.controls.length, 0);
  f.state.activeWorkers = 1; f.frame(300);
  assert.equal(f.presentation.evidence.remainingMs, 700);
  assert.deepEqual(f.state.consumed, [300]);
  f.state.activeWorkers = 0; f.frame(5000);
  assert.equal(f.presentation.evidence.remainingMs, 700);
  f.state.activeWorkers = 1; f.frame(700); await flush();
  assert.equal(f.presentation.evidence.remainingMs, 0);
  assert.equal(f.state.multiplier, 1); assert.equal(f.state.controls.length, 1);
});

test('depletion queues behind another business popup until gameplay unlocks', async () => {
  const f = fixture(); f.state.cycle(); const other = {}; f.context.progressPopup = other; f.context.inputLocked = true;
  f.frame(300); await flush(); assert.equal(f.state.attempts, 0); assert.equal(f.context.progressPopup, other);
  f.context.progressPopup = null; f.frame(); await flush(); assert.equal(f.state.attempts, 0);
  f.context.inputLocked = false; f.frame(); await flush(); assert.equal(f.state.controls.length, 1);
});

test('a popup winning during guide cancellation defers rather than loses the expiry notice', async () => {
  const f = fixture(); f.holdGuide(); f.state.cycle(); f.frame(300); f.frame(); f.frame();
  assert.equal(f.state.attempts, 1); const other = {}; f.context.progressPopup = other; f.context.inputLocked = true;
  f.state.finishGuide(); await flush(); assert.equal(f.state.controls.length, 0);
  f.context.progressPopup = null; f.context.inputLocked = false; f.frame(); await flush();
  assert.equal(f.state.attempts, 2); assert.equal(f.state.controls.length, 1);
});

test('an in-flight control load cannot produce repeated expiry requests', async () => {
  const f = fixture(); f.holdOpen(); f.state.cycle(); f.frame(300); await flush();
  f.frame(); f.frame(); assert.equal(f.state.controls.length, 1); assert.equal(f.state.attempts, 1);
  f.state.finishOpen(); await flush(); f.state.controls[0].close(); f.frame(); await flush();
  assert.equal(f.state.attempts, 1);
});

for (const reason of ['navigation', 'dispose', 'freeFinish', 'generation', 'page', 'round', 'result']) {
  test(`${reason} cancels an expiry request waiting for guide cleanup`, async () => {
    const f = fixture(); f.holdGuide(); f.state.cycle(); f.frame(300);
    if (reason === 'navigation') f.presentation.stopForNavigation();
    if (reason === 'dispose') f.presentation.dispose();
    if (reason === 'freeFinish') f.presentation.startFreeFinish();
    if (reason === 'generation') f.context.generation++;
    if (reason === 'page') f.context.StateMachine.current = {};
    if (reason === 'round') f.context.round = { id: 'round-2' };
    if (reason === 'result') f.state.result = 'SUCCESS';
    f.state.finishGuide(); await flush(); f.frame(); await flush();
    assert.equal(f.state.controls.length, 0); assert.equal(f.state.attempts, 1);
  });
}

test('a late close callback cannot redraw a presentation whose navigation token expired', async () => {
  const f = fixture(); f.state.cycle(); f.frame(300); await flush();
  f.presentation.stopForNavigation(); const draws = f.state.draws.length;
  f.state.controls[0].close(); assert.equal(f.state.draws.length, draws);
});

for (const restored of ['reward', 'nextDay']) {
  test(`${restored} balance restoration cancels an obsolete queued notice`, async () => {
    const f = fixture(); f.state.cycle(); f.context.inputLocked = true; f.frame(300);
    f.state.remainingMs = 180000; if (restored === 'nextDay') f.state.day = '2026-10-12';
    f.context.inputLocked = false; f.frame(); await flush();
    assert.equal(f.state.attempts, 0); assert.equal(f.presentation.evidence.remainingMs, 180000);
  });
}

test('balance restoration during guide cleanup cancels the delayed request', async () => {
  const f = fixture(); f.holdGuide(); f.state.cycle(); f.frame(300); f.state.remainingMs = 120000;
  f.state.finishGuide(); await flush(); f.frame(); await flush(); assert.equal(f.state.controls.length, 0);
  assert.equal(f.state.attempts, 1); assert.equal(f.presentation.evidence.remainingMs, 120000);
});

test('background suspension postpones the notice and discards the resume-frame elapsed time', async () => {
  const f = fixture(); f.holdGuide(); f.state.cycle(); f.frame(300); f.hide();
  f.state.finishGuide(); await flush(); f.frame(60000); assert.equal(f.state.controls.length, 0);
  f.show(); f.frame(60000); await flush(); assert.equal(f.state.controls.length, 1);
  assert.deepEqual(f.state.consumed, [300]);
});

test('storage failure cancels the pending notice instead of claiming normal depletion', async () => {
  const f = fixture(); f.state.cycle(); f.context.inputLocked = true; f.frame(300);
  f.state.failRead = true; f.frame(); assert.equal(f.state.feedback.length, 1);
  f.state.failRead = false; f.context.inputLocked = false; f.show(); f.frame(); await flush();
  assert.equal(f.state.attempts, 0);
});

test('a failed resource load is an accepted request and does not retry each frame', async () => {
  const f = fixture(); f.state.failOpen = true; f.state.cycle(); f.frame(300); await flush();
  assert.equal(f.state.controls.length, 1); assert.equal(f.context.progressPopup, null);
  assert.equal(f.state.error.code, 'INVALID_OPERATION'); f.frame(); f.frame(); await flush();
  assert.equal(f.state.attempts, 1);
});

test('guide cleanup rejection cancels the request without an unhandled promise or automatic retry', async () => {
  const f = fixture(); f.state.failGuide = true; f.state.cycle(); f.frame(300); await flush();
  assert.equal(f.state.controls.length, 0); assert.equal(f.state.feedback.length, 1);
  f.state.failGuide = false; f.show(); f.frame(); await flush(); assert.equal(f.state.attempts, 1);
  f.state.cycle(); await flush(); assert.equal(f.state.controls.length, 1);
});

test('an already empty balance still opens through the existing speed-button action', async () => {
  const f = fixture(0); f.state.cycle(); await flush(); assert.equal(f.state.controls.length, 1);
  assert.equal(f.state.multiplier, 1); assert.deepEqual(f.state.consumed, []);
});

test('a declined page-local request leaves guide and popup ownership untouched', async () => {
  const f = fixture(); const other = {}; f.context.progressPopup = other;
  assert.equal(await f.ProgressPresentation.open(f.context, 'speed', undefined, () => false), false);
  assert.equal(f.state.guideCalls, 0); assert.equal(f.context.progressPopup, other); assert.equal(f.state.controls.length, 0);
});
