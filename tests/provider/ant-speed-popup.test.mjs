import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PlayerProgress, PROGRESS_SAVE_KEY } from '../../assets/Colony/scripts/application/playerProgress.ts';
import { RewardedAds } from '../../assets/Colony/scripts/application/rewardedAds.ts';
import { AD_BOOST_MS, FREE_BOOST_MS } from '../../assets/Colony/scripts/application/speedBoost.ts';
import { leaderboardTestConfig, socialTestConfig } from '../ant/support/leaderboardTestConfig.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const source = readFileSync(new URL('../../assets/Colony/scripts/presentation/progressPresentation.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture() {
  const stored = new Map(); let fail = false, now = Date.parse('2026-10-09T12:00:00+08:00'), closes = 0;
  const progress = new PlayerProgress({ read: key => stored.get(key) ?? null, write(key, value) {
    if (fail && key === PROGRESS_SAVE_KEY) throw Error('disk full'); stored.set(key, value);
  } }, { now: () => now }, leaderboardTestConfig, socialTestConfig);
  for (let n = 0; n < FREE_BOOST_MS / 1000; n++) progress.reserveSpeedBoost(1000);
  let closeVideo, errorVideo, shows = 0;
  const video = { load: async () => {}, show: async () => { shows++; },
    onClose: callback => { closeVideo = callback; }, offClose() {}, onError: callback => { errorVideo = callback; }, offError() {}, destroy() {} };
  const ads = new RewardedAds({ createRewardedVideoAd: () => video }, { speed: 'isolated-unit', clear: 'isolated-clear' }, () => 'round');
  const owner = { close: async () => { closes++; } };
  const context = { generation: 1, destroyed: false, progress, ads, progressPopup: owner, round: { id: 'round' } };
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => name === './pageStates/playState' ? { PlayState: { current: () => null } }
    : name === '../application/speedBoost' ? { AD_BOOST_MS, FREE_BOOST_MS }
    : name.endsWith('resultPopupNav') ? { swallowMkInterrupt: promise => promise }
    : name.endsWith('toolControl') ? { ToolControl: class {} } : {} });
  const presentation = new exports.ProgressPresentation(context, 'speed');
  presentation.control = context.progressPopup;
  return { progress, ads, context, presentation, stored, owner, fail: value => { fail = value; },
    setTime: value => { now = value; }, shows: () => shows, closes: () => closes,
    videoEnd: ended => closeVideo({ isEnded: ended }), videoError: () => errorVideo(Error('platform failed')) };
}

test('actual speed projection uses existing durations and one ad tier; unavailable units never enable purchasing', () => {
  const f = fixture(), page = f.presentation.read();
  assert.equal(page.layout, 'speed'); assert.equal(page.rows.length, 1); assert.equal(page.rows[0].action, 'ad-speed');
  assert.equal(page.title, '加速时间已用完'); assert.equal(page.speed.durationText, `${AD_BOOST_MS / 60000}分钟`);
  assert.equal(page.speed.remainingText, '剩余 0:00'); assert.equal(page.rows[0].enabled, true);
  assert.match(page.summary, new RegExp(`赠送${FREE_BOOST_MS / 60000}分钟`));
  f.context.ads = new RewardedAds(null, {}, () => 'round');
  assert.equal(f.presentation.read().rows[0].enabled, false);
  assert.equal(f.presentation.read().rows[0].button, '视频暂不可用');
});

test('actual completed ad save failure projects retry; retry reuses the receipt and closes only after one durable grant', async () => {
  const f = fixture(), first = f.presentation.act('ad-speed'); await tick();
  assert.equal(f.presentation.read().rows[0].enabled, false); assert.equal(f.presentation.read().rows[0].button, '视频播放中');
  assert.equal(await f.presentation.act('ad-speed'), '视频播放中'); assert.equal(f.shows(), 1);
  f.fail(true); f.videoEnd(true); assert.match(await first, /奖励待保存/);
  assert.equal(f.progress.readSpeedBoost().remainingMs, 0); assert.equal(f.closes(), 0);
  const retryPage = f.presentation.read(); assert.equal(retryPage.rows[0].enabled, true); assert.equal(retryPage.rows[0].button, '重试领取');
  const receipt = f.ads.pendingRequestKey('speed'); f.fail(false); await f.presentation.act('ad-speed');
  assert.equal(f.shows(), 1); assert.equal(f.closes(), 1); assert.equal(f.progress.readSpeedBoost().remainingMs, AD_BOOST_MS);
  assert.equal(f.progress.snapshot().daily.boostAds, 1);
  assert.equal(f.progress.grantSpeedBoostReward(receipt), false);
  assert.equal(f.presentation.read().title, '加速时间'); assert.equal(f.presentation.read().speed.remainingText, '剩余 2:00');
});

test('cancelled and failed ads grant no time and preserve the usable offer', async () => {
  const f = fixture(), cancelled = f.presentation.act('ad-speed'); await tick(); f.videoEnd(false);
  assert.match(await cancelled, /视频未完成/); assert.equal(f.progress.readSpeedBoost().remainingMs, 0); assert.equal(f.closes(), 0);
  const failed = f.presentation.act('ad-speed'); await tick(); f.videoError();
  assert.match(await failed, /视频加载失败/); assert.equal(f.progress.readSpeedBoost().remainingMs, 0);
  assert.equal(f.presentation.read().rows[0].enabled, true);
});

test('other pending rewards disable the speed offer and a direct action cannot request a different video', async () => {
  const f = fixture(), pending = f.ads.request('clear', () => { throw Error('save blocked'); }, 'clear-receipt');
  await tick(); f.videoEnd(true); assert.equal(await pending, 'pending');
  const page = f.presentation.read(); assert.equal(page.rows[0].enabled, false); assert.match(page.rows[0].detail, /其他奖励待保存/);
  assert.match(await f.presentation.act('ad-speed'), /其他奖励待保存/); assert.equal(f.shows(), 1);
  assert.equal(f.ads.pendingRequestKey('clear'), 'clear-receipt'); assert.equal(f.progress.readSpeedBoost().remainingMs, 0);
});

test('clock rollback prevents a fresh speed video; restored clock refreshes the projection without a guessed tier', async () => {
  const f = fixture(); f.setTime(Date.parse('2026-10-08T12:00:00+08:00'));
  assert.equal(f.presentation.read().rows[0].enabled, false); assert.match(await f.presentation.act('ad-speed'), /时间回退/);
  assert.equal(f.shows(), 0); f.setTime(Date.parse('2026-10-09T12:00:00+08:00'));
  assert.equal(f.presentation.read().rows[0].enabled, true); assert.equal(f.presentation.read().rows.length, 1);
});

test('late speed completion credits the shared budget without closing or unlocking a newer round popup', async () => {
  const f = fixture(), request = f.presentation.act('ad-speed'); await tick();
  f.context.generation++; f.context.round = { id: 'new-round' }; const nextPopup = f.context.progressPopup = {};
  f.context.inputLocked = true; f.videoEnd(true); await request;
  assert.equal(f.progress.readSpeedBoost().remainingMs, AD_BOOST_MS); assert.equal(f.closes(), 0);
  assert.equal(f.context.progressPopup, nextPopup); assert.equal(f.context.inputLocked, true);
});

test('same-generation force-closed speed popup cannot unlock a result modal on late completion even when both owners are null', async () => {
  const f = fixture(), request = f.presentation.act('ad-speed'); await tick();
  // Navigation.closed clears both owners after forceClose while the result remains locked.
  f.presentation.control = null; f.presentation.cancelled = true; f.context.progressPopup = null;
  f.context.inputLocked = true; f.videoEnd(true); await request;
  assert.equal(f.progress.readSpeedBoost().remainingMs, AD_BOOST_MS);
  assert.equal(f.context.inputLocked, true); assert.equal(f.closes(), 0);
});

test('completed receipt survives clock rollback and midnight; the original callback retries without replaying the ad', async () => {
  const f = fixture(), request = f.presentation.act('ad-speed'); await tick(); f.fail(true); f.videoEnd(true);
  assert.match(await request, /奖励待保存/); const receipt = f.ads.pendingRequestKey('speed'); f.fail(false);
  f.setTime(Date.parse('2026-10-08T12:00:00+08:00'));
  assert.match(await f.presentation.act('ad-speed'), /时间回退/); assert.equal(f.ads.pendingRequestKey('speed'), receipt);
  f.setTime(Date.parse('2026-10-10T00:00:01+08:00'));
  assert.equal(f.presentation.read().rows[0].button, '重试领取');
  await f.presentation.act('ad-speed'); assert.equal(f.shows(), 1);
  assert.equal(f.progress.readSpeedBoost().remainingMs, FREE_BOOST_MS + AD_BOOST_MS);
  assert.equal(f.progress.snapshot().daily.boostAds, 1); assert.equal(f.closes(), 1);
});

test('actual Presenter close failure retains ownership and input lock after the reward is already durable', async () => {
  const f = fixture(); f.context.inputLocked = true; f.owner.close = async () => { throw Error('close failed'); };
  const request = f.presentation.act('ad-speed'); await tick(); f.videoEnd(true);
  await assert.rejects(request, /close failed/);
  assert.equal(f.context.progressPopup, f.owner); assert.equal(f.context.inputLocked, true);
  assert.equal(f.progress.readSpeedBoost().remainingMs, AD_BOOST_MS); assert.equal(f.progress.snapshot().daily.boostAds, 1);
});
