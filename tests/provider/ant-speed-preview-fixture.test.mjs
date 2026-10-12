import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PlayerProgress, PROGRESS_SAVE_KEY } from '../../assets/Colony/scripts/application/playerProgress.ts';
import { RewardedAds } from '../../assets/Colony/scripts/application/rewardedAds.ts';
import { FREE_BOOST_MS, AD_BOOST_MS } from '../../assets/Colony/scripts/application/speedBoost.ts';
import { createProgressPreviewSession } from '../../assets/Colony/scripts/testing/progressPreviewFixture.ts';
import { leaderboardTestConfig, socialTestConfig } from '../ant/support/leaderboardTestConfig.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(preview = true) {
  const timers = [];
  class Button {}
  const ctx = { gm: { active: true, async enter() {} }, progress: null, ads: null,
    leaderboardConfig: leaderboardTestConfig, socialConfig: socialTestConfig, inputLocked: false };
  const modules = { 'cc': { Button }, 'cc/env': { PREVIEW: preview }, 'mk': { default: {} },
    playState: { PlayState: { async goHome() {}, current: () => null } },
    progressPreviewFixture: { createProgressPreviewSession }, rewardedAds: { RewardedAds },
    speedBoost: { FREE_BOOST_MS }, playerProgress: { PROGRESS_SAVE_KEY },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../../assets/Colony/scripts/testing/colonyTestBridge.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, useDefineForClassFields: false },
  }).outputText, { exports, require: name => modules[name] ?? modules[name.split('/').at(-1)] ?? {},
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); }, console });
  const bridge = new exports.ColonyTestBridge(ctx);
  return { bridge, ctx, timers };
}

test('speed reward fault rejects production, absent fixture, inactive GM and replaced save owners', async () => {
  assert.throws(() => fixture(false).bridge.failNextSpeedRewardSavePreview(), /Isolated speed Preview/);
  const f = fixture(); assert.throws(() => f.bridge.failNextSpeedRewardSavePreview(), /Isolated speed Preview/);
  await f.bridge.previewSpeedBoost(0);
  f.ctx.gm.active = false; assert.throws(() => f.bridge.failNextSpeedRewardSavePreview(), /Isolated speed Preview/);
  f.ctx.gm.active = true;
  const owned = f.ctx.progress;
  const unownedMemory = new Map(); let writes = 0;
  f.ctx.progress = new PlayerProgress({ read: key => unownedMemory.get(key) ?? null,
    write(key, value) { writes++; unownedMemory.set(key, value); } },
    { now: () => Date.parse('2026-10-04T12:00:00+08:00') }, leaderboardTestConfig, socialTestConfig);
  const before = writes;
  assert.throws(() => f.bridge.failNextSpeedRewardSavePreview(), /Isolated speed Preview/);
  assert.equal(writes, before);
  f.ctx.progress = owned; owned.save.testOnly = false;
  assert.throws(() => f.bridge.failNextSpeedRewardSavePreview(), /Private memory save/);
});

test('one primary reward failure retains the receipt and old balance, retries once without another video and survives private reload', async () => {
  const f = fixture(); await f.bridge.previewSpeedBoost(0, 'complete', 2000);
  f.bridge.failNextSpeedRewardSavePreview();
  // Unrelated progress writes must not consume the reward fault.
  f.ctx.progress.skipGuide();
  const grant = () => f.ctx.progress.grantSpeedBoostReward('preview-reward');
  const pending = f.ctx.ads.request('speed', grant, 'preview-reward'); await tick();
  assert.equal(f.timers[0].ms, 2000); f.timers[0].fn();
  assert.equal(await pending, 'pending');
  assert.equal(f.ctx.progress.readSpeedBoost().remainingMs, 0);
  assert.equal(f.ctx.progress.snapshot().daily.boostAds, 0);
  assert.equal(f.ctx.ads.pendingRequestKey('speed'), 'preview-reward');
  assert.equal(await f.ctx.ads.request('speed', grant, 'preview-reward'), 'completed');
  assert.equal(f.timers.length, 1); assert.equal(f.ctx.ads.hasPendingReward(), false);
  assert.equal(f.ctx.progress.readSpeedBoost().remainingMs, AD_BOOST_MS);
  assert.equal(f.ctx.progress.snapshot().daily.boostAds, 1);
  await f.bridge.restartLeaderboardPreview(0);
  assert.equal(f.ctx.progress.readSpeedBoost().remainingMs, AD_BOOST_MS);
  assert.equal(f.ctx.progress.snapshot().daily.boostAds, 1);
  assert.equal(f.ctx.progress.grantSpeedBoostReward('preview-reward'), false);
});

test('invalid video delay fails before replacing the current owner or SDK', async () => {
  const f = fixture(); await f.bridge.previewSpeedBoost(1000);
  const owner = f.ctx.progress, ads = f.ctx.ads;
  for (const delay of [-1, 0.5, NaN, Infinity, 10001]) {
    await assert.rejects(f.bridge.previewSpeedBoost(0, 'complete', delay), /Invalid speed Preview/);
    assert.equal(f.ctx.progress, owner); assert.equal(f.ctx.ads, ads);
  }
});

test('read-only Speed evidence counts only the mock port and reports real button/pending state', async () => {
  const f = fixture(); await f.bridge.previewSpeedBoost(0, 'cancel', 1000);
  const popup = { isAvailable: () => true, actionLabel: { string: '处理中' },
    actionButton: { getComponent: () => ({ interactable: false }) },
    dismissButton: { getComponent: () => ({ interactable: false }) }, feedbackLabel: { string: '' } };
  f.ctx.popupRoot = { getComponentsInChildren: () => [popup] };
  const pending = f.ctx.ads.request('speed', () => { throw Error('Cancelled mock must not grant'); }, 'cancel-reward'); await tick();
  const e = f.bridge.speedPopupEvidencePreview();
  assert.deepEqual({ ...e.video }, { loads: 1, shows: 1, closes: 0 });
  assert.equal(e.actionEnabled, false); assert.equal(e.dismissEnabled, false);
  f.timers[0].fn(); assert.equal(await pending, 'cancelled');
  assert.deepEqual({ ...f.bridge.speedPopupEvidencePreview().video }, { loads: 1, shows: 1, closes: 1 });
  assert.equal(f.ctx.progress.readSpeedBoost().remainingMs, 0);
  assert.equal(f.ctx.progress.snapshot().daily.boostAds, 0);
});
