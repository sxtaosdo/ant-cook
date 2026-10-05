import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../../assets/Colony/scripts/presentation/progressPresentation.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

test('pending speed credit followed by terminal transport resumes settlement once after retry', async () => {
  const exports = {}, state = { day: '2026-10-04', boostAds: 0 }, round = { settled: false };
  let pending = true, closed = 0, results = 0;
  const page = { waitForTransportIdle: async () => {}, showResult: async success => { assert.equal(success, true); results++; round.settled = true; } };
  runInNewContext(compiled, { exports, require: module => module === './pageStates/playState' ? { PlayState: { current: () => page } } : {} });
  const context = { progressPopup: null, round: { id: 'round-1' }, play: { snapshot: () => ({ result: 'SUCCESS' }) },
    progress: { snapshot: () => ({ daily: state, rounds: { 'round-1': round } }), grantSpeedBoostReward: () => { state.boostAds++; } },
    ads: { hasPendingReward: () => pending, pendingRequestKey: () => 'receipt', request: async (_placement, callback) => {
      if (pending) return 'pending'; callback(); return 'completed';
    } } };
  const presentation = new exports.ProgressPresentation(context, 'speed');
  presentation.close = async () => { closed++; };
  assert.match(await presentation.act('ad-speed'), /待保存/);
  assert.equal(results, 0); assert.equal(closed, 0);
  pending = false;
  await presentation.act('ad-speed');
  assert.equal(results, 1); assert.equal(closed, 1);
  await presentation.act('ad-speed'); assert.equal(results, 1);
});

test('normal transport settlement winning the retry race is not opened or awarded twice', async () => {
  const exports = {}, round = { settled: false }; let results = 0;
  const page = { waitForTransportIdle: async () => { round.settled = true; }, showResult: async () => { results++; } };
  runInNewContext(compiled, { exports, require: module => module === './pageStates/playState' ? { PlayState: { current: () => page } } : {} });
  const context = { progressPopup: null, round: { id: 'round-1' }, play: { snapshot: () => ({ result: 'SUCCESS' }) },
    progress: { snapshot: () => ({ daily: { day: '2026-10-04', boostAds: 0 }, rounds: { 'round-1': round } }), grantSpeedBoostReward: () => {} },
    ads: { hasPendingReward: () => false, pendingRequestKey: () => null, request: async (_placement, cb) => { cb(); return 'completed'; } } };
  const presentation = new exports.ProgressPresentation(context, 'speed'); presentation.close = async () => {};
  await presentation.act('ad-speed'); assert.equal(results, 0);
});

test('late completed speed credit cannot close, unlock or refresh a newer round', async () => {
  const exports = {}; let current = {}, finish, credits = 0, closed = 0, refreshed = 0;
  runInNewContext(compiled, { exports, require: module => module === './pageStates/playState' ? { PlayState: { current: () => current } } : {} });
  const context = { generation: 1, progressPopup: null, inputLocked: true, round: { id: 'round-1' }, play: { snapshot: () => ({ result: 'PLAYING' }) },
    progress: { snapshot: () => ({ daily: { day: '2026-10-04', boostAds: 0 } }), grantSpeedBoostReward: () => { credits++; } },
    ads: { hasPendingReward: () => false, pendingRequestKey: () => null, request: (_placement, callback) => new Promise(resolve => {
      finish = () => { callback(); resolve('completed'); };
    }) } };
  const presentation = new exports.ProgressPresentation(context, 'speed', () => { refreshed++; }); presentation.close = async () => { closed++; context.inputLocked = false; };
  const pending = presentation.act('ad-speed');
  current = {}; context.round = { id: 'round-2' }; context.generation++;
  const newerPopup = {}; context.progressPopup = newerPopup;
  finish(); await pending;
  assert.equal(credits, 1); assert.equal(closed, 0); assert.equal(refreshed, 0);
  assert.equal(context.progressPopup, newerPopup); assert.equal(context.inputLocked, true);
});
