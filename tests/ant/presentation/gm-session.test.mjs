import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { GmTestProfile } from '../../assets/Colony/scripts/testing/gmTestProfile.ts';
import { PlayerProgress } from '../../assets/Colony/scripts/application/playerProgress.ts';
import { leaderboardTestConfig, socialTestConfig } from '../support/leaderboardTestConfig.ts';

function compile(file, modules) {
  const exports = {};
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(compiled, { exports, require: name => modules[name] ?? {}, Date });
  return exports;
}
function fixture(mode = 'main', development = true) {
  let writes = 0, page = null;
  const values = new Map(), calls = [];
  const original = new PlayerProgress({ read: key => values.get(key) ?? null, write: (key, value) => { writes++; values.set(key, value); } }, { now: () => Date.now() }, leaderboardTestConfig, socialTestConfig);
  const realAds = { hasPendingReward: () => false, cancel: () => { calls.push('cancel'); } };
  const ctx = { progress: original, ads: realAds, leaderboardConfig: leaderboardTestConfig, socialConfig: socialTestConfig,
    destroyed: false, app: { error: null }, round: { levelId: 7, mode }, play: { snapshot: () => ({ level: 7 }) } };
  const makePage = () => ({ showResultPreview: async success => { calls.push(success ? 'success' : 'fail'); }, refreshBoostBalance: () => { calls.push('boost-refresh'); } });
  page = makePage();
  const PlayState = { current: () => page,
    goHome: async context => { calls.push('home'); page = null; context.round = null; },
    enterLevel: async (context, levelId) => { assert.notEqual(context.progress, original); calls.push(`level:${levelId}`); context.round = { mode: 'main', levelId }; page = makePage(); },
    enterDaily: async context => { assert.notEqual(context.progress, original); calls.push('daily'); context.round = { mode: 'daily', levelId: 7 }; page = makePage(); } };
  const { GmTestSession } = compile('../../assets/Colony/scripts/testing/gmTestSession.ts', {
    'cc/env': { DEBUG: development, PREVIEW: false }, '../presentation/pageStates/playState': { PlayState }, './gmTestProfile': { GmTestProfile },
    '../application/rewardedAds': { RewardedAds: class { dispose() { calls.push('dispose'); } } },
  });
  const baseline = JSON.stringify(original.snapshot()), saved = writes;
  return { gm: new GmTestSession(ctx), ctx, original, realAds, calls, unchanged: () => { assert.equal(JSON.stringify(original.snapshot()), baseline); assert.equal(writes, saved); } };
}

test('first GM victory preview rebuilds the captured level only after swapping the save owner; exit restores it', async () => {
  const f = fixture();
  await f.gm.enter(); await f.gm.run('success', 7);
  assert.deepEqual(f.calls, ['cancel', 'home', 'level:7', 'success']);
  await f.gm.run('diamonds'); await f.gm.run('speed'); await f.gm.run('next', 7);
  assert.equal(f.ctx.round.levelId, 8); f.unchanged();
  await f.gm.exit();
  assert.equal(f.ctx.progress, f.original); assert.equal(f.ctx.ads, f.realAds); assert.equal(f.gm.active, false); f.unchanged();
});
test('first GM command preserves daily mode and blocks next; release denies entry and commands', async () => {
  const daily = fixture('daily'); await daily.gm.enter(); await daily.gm.run('fail', 7);
  assert.deepEqual(daily.calls.slice(-2), ['daily', 'fail']);
  await assert.rejects(daily.gm.run('next', 7), /下一关/); daily.unchanged();
  const release = fixture('main', false);
  assert.equal(release.gm.available, false);
  await assert.rejects(release.gm.enter(), /Preview/); await assert.rejects(release.gm.run('diamonds'), /Preview/);
  assert.deepEqual(release.calls, []); release.unchanged();
});
test('pending ad receipt blocks GM before changing the profile or cancelling the reward', async () => {
  const f = fixture(); f.realAds.hasPendingReward = () => true;
  await assert.rejects(f.gm.enter(), /奖励待保存/);
  assert.deepEqual(f.calls, []); assert.equal(f.ctx.progress, f.original); f.unchanged();
});

test('extra shovel finishing the last selectable group starts free boost, but stale clear callbacks do not', async () => {
  const { PlayState } = compile('../../assets/Colony/scripts/presentation/pageStates/playState.ts', { '../hardLevelNotice': { HardLevelNotice: class {} } });
  const page = new PlayState(), calls = [], event = { phase: 'INTERACT', cellId: 'last' };
  const ctx = { destroyed: false, generation: 1, StateMachine: { current: page }, app: { error: null }, play: {
    selectableQueueExhausted: true, snapshot: () => ({ result: 'PLAYING' }), usedToolList: () => [], lastEventList: () => [event], lastDispatchRoundList: () => [], suggestedStack: () => null,
  } };
  page.context = ctx; page.collectionFlight = { accept: () => {} }; page.speedBoost = { startFreeFinish: () => { calls.push('free'); } };
  page.board = { clearCell: async () => {}, applyCounts: () => { calls.push('counts'); } };
  await page.presentExtraSupply('trowel'); assert.deepEqual(calls, ['counts', 'free']);
  calls.length = 0; page.board.clearCell = async () => { ctx.generation++; };
  await page.presentExtraSupply('trowel'); assert.deepEqual(calls, []);
});
