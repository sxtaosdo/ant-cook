import assert from 'node:assert/strict';
import test from 'node:test';
import { PlayerProgress, PROGRESS_SAVE_KEY, PROGRESS_BACKUP_KEY } from '../../assets/Colony/scripts/application/playerProgress';
import { SpeedBoostSession, FREE_BOOST_MS, AD_BOOST_MS } from '../../assets/Colony/scripts/application/speedBoost';
import { RewardedAds, type RewardedVideo } from '../../assets/Colony/scripts/application/rewardedAds';
import { leaderboardTestConfig, socialTestConfig } from '../ant/support/leaderboardTestConfig';

function fixture() {
  const values = new Map<string, string>();
  let now = Date.parse('2026-10-04T23:59:58+08:00'), fail = false;
  const save = { read: (key: string) => values.get(key) ?? null,
    write: (key: string, value: string) => { if (fail && key === PROGRESS_SAVE_KEY) throw new Error('disk full'); values.set(key, value); } };
  const clock = { now: () => now };
  const create = () => new PlayerProgress(save, clock, leaderboardTestConfig, socialTestConfig);
  const progress = create();
  return { values, progress, create, setTime: (at: number) => { now = at; }, move: (ms: number) => { now += ms; }, fail: (value: boolean) => { fail = value; } };
}

test('1→2→3→1 shares active seconds, including idle time and refunds unused reservation', () => {
  const f = fixture(), boost = new SpeedBoostSession(f.progress);
  assert.equal(boost.multiplier, 1);
  assert.equal(boost.cycle(), false); assert.equal(boost.multiplier, 2);
  boost.advance(5000); assert.equal(boost.read().remainingMs, FREE_BOOST_MS - 5000);
  boost.advance(250);
  assert.equal(boost.cycle(), false); assert.equal(boost.multiplier, 3);
  boost.advance(250);
  assert.equal(boost.read().remainingMs, FREE_BOOST_MS - 5500);
  boost.cycle(); assert.equal(boost.multiplier, 1);
  assert.equal(f.progress.readSpeedBoost().remainingMs, FREE_BOOST_MS - 5500);
  boost.stop(); assert.equal(f.progress.readSpeedBoost().remainingMs, FREE_BOOST_MS - 5500);
});

test('consumed tail is observed even if the next lease reservation cannot save', () => {
  const f = fixture(), boost = new SpeedBoostSession(f.progress);
  boost.cycle(); boost.advance(992); f.fail(true); let observed = 0;
  assert.throws(() => boost.advance(16, ms => { observed += ms; }), /disk full/);
  assert.equal(observed, 8);
});

test('unsupported old formats cannot silently create a new save in the new scope', () => {
  const f = fixture(); const unsupported = f.progress.snapshot(); unsupported.version = 5 as 6;
  f.values.set(PROGRESS_SAVE_KEY, JSON.stringify(unsupported)); f.values.delete(PROGRESS_BACKUP_KEY);
  assert.throws(() => f.create(), /存档损坏/);
});

test('exhaustion falls back to 1× without a modal; the next tap requests the panel', () => {
  const f = fixture(), boost = new SpeedBoostSession(f.progress);
  for (let n = 0; n < 179; n++) f.progress.reserveSpeedBoost(1000);
  boost.cycle(); boost.advance(1000);
  assert.equal(boost.multiplier, 1); assert.equal(boost.read().remainingMs, 0);
  assert.equal(boost.cycle(), true);
  f.progress.grantSpeedBoostReward('first');
  assert.equal(boost.multiplier, 1); assert.equal(boost.read().remainingMs, AD_BOOST_MS);
});

test('Beijing midnight resets free and advertised balance, ignoring yesterday’s unused lease', () => {
  const f = fixture(), boost = new SpeedBoostSession(f.progress);
  f.progress.grantSpeedBoostReward('old-day'); boost.cycle(); boost.advance(200);
  f.move(2000);
  assert.equal(boost.read().day, '2026-10-05'); assert.equal(boost.read().remainingMs, FREE_BOOST_MS);
  boost.stop(); assert.equal(f.progress.readSpeedBoost().remainingMs, FREE_BOOST_MS);
  boost.cycle(); boost.advance(100); boost.stop();
  assert.equal(f.progress.readSpeedBoost().remainingMs, FREE_BOOST_MS - 100);
  f.setTime(Date.parse('2026-10-03T10:00:00+08:00'));
  assert.equal(f.progress.readSpeedBoost().remainingMs, FREE_BOOST_MS - 100);
  assert.throws(() => f.progress.grantSpeedBoostReward('rollback'), /当前无法/);
});

test('idle active time stays spent after restart', () => {
  const f = fixture(), boost = new SpeedBoostSession(f.progress);
  boost.cycle(); boost.advance(9000);
  assert.equal(f.create().readSpeedBoost().remainingMs, FREE_BOOST_MS - 9000);
});

test('restart keeps prepaid usage; a new round starts at 1× without recovering time', () => {
  const f = fixture(), boost = new SpeedBoostSession(f.progress);
  boost.cycle(); boost.advance(650);
  const restarted = f.create(), next = new SpeedBoostSession(restarted);
  assert.equal(next.multiplier, 1);
  assert.equal(next.read().remainingMs, FREE_BOOST_MS - 1000);
});

test('failed reservation never activates boost and failed ad save retries exactly once', () => {
  const f = fixture(), boost = new SpeedBoostSession(f.progress);
  f.fail(true);
  assert.throws(() => boost.cycle(), /disk full/); assert.equal(boost.multiplier, 1);
  assert.equal(f.progress.readSpeedBoost().remainingMs, FREE_BOOST_MS);
  assert.throws(() => f.progress.grantSpeedBoostReward('receipt'), /disk full/);
  f.fail(false);
  assert.equal(f.progress.grantSpeedBoostReward('receipt'), true);
  assert.equal(f.progress.grantSpeedBoostReward('receipt'), false);
  assert.equal(f.progress.readSpeedBoost().remainingMs, FREE_BOOST_MS + AD_BOOST_MS);
  assert.equal(f.create().readSpeedBoost().remainingMs, FREE_BOOST_MS + AD_BOOST_MS);
});

test('backup recovery preserves balance and does not repeat daily reset', () => {
  const f = fixture(); f.progress.grantSpeedBoostReward('receipt');
  for (let n = 0; n < 2; n++) f.progress.reserveSpeedBoost(1000);
  const expected = JSON.parse(f.values.get(PROGRESS_BACKUP_KEY)!).daily.boostRemainingMs;
  f.values.set(PROGRESS_SAVE_KEY, '{broken');
  const recovered = f.create(); assert.equal(recovered.recoveredBackup, true);
  assert.equal(recovered.readSpeedBoost().remainingMs, expected);
  assert.equal(f.create().readSpeedBoost().remainingMs, expected);
});

test('invalid v5 time balances recover from backup rather than silently refilling', () => {
  for (const bad of [undefined, -1, 0.5, FREE_BOOST_MS + 1, Number.MAX_SAFE_INTEGER]) {
    const f = fixture(); f.progress.reserveSpeedBoost(1000);
    f.values.set(PROGRESS_BACKUP_KEY, f.values.get(PROGRESS_SAVE_KEY)!);
    const damaged = f.progress.snapshot(); damaged.daily.boostRemainingMs = bad as number;
    f.values.set(PROGRESS_SAVE_KEY, JSON.stringify(damaged));
    const recovered = f.create(); assert.equal(recovered.recoveredBackup, true);
    assert.equal(recovered.readSpeedBoost().remainingMs, FREE_BOOST_MS - 1000);
  }
});

test('a completed speed ad remains retryable across rounds and midnight; incomplete viewing grants nothing', async () => {
  const f = fixture(); let close: (r?: { isEnded?: boolean }) => void = () => {};
  let shows = 0, round = 'round-1';
  const video: RewardedVideo = { load: async () => {}, show: async () => { shows++; },
    onClose: cb => { close = cb; }, offClose: () => {}, onError: () => {}, offError: () => {} };
  const ads = new RewardedAds({ createRewardedVideoAd: () => video }, { speed: 'real-unit' }, () => round);
  assert.equal(ads.available('speed'), true);
  const cancelled = ads.request('speed', () => { f.progress.grantSpeedBoostReward('cancelled'); }, 'cancelled');
  await new Promise<void>(resolve => setImmediate(resolve)); close({ isEnded: false });
  assert.equal(await cancelled, 'cancelled'); assert.equal(f.progress.snapshot().daily.boostAds, 0);
  const result = ads.request('speed', () => { f.progress.grantSpeedBoostReward('receipt'); }, 'receipt');
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(ads.isShowingSpeed(), true); f.fail(true); close({ isEnded: true });
  assert.equal(await result, 'pending'); assert.equal(ads.pendingRequestKey('speed'), 'receipt');
  f.fail(false); f.move(2000); round = 'round-2';
  assert.equal(await ads.request('speed', () => assert.fail('must reuse saved callback'), 'receipt'), 'completed');
  close({ isEnded: true }); assert.equal(shows, 2);
  assert.equal(f.progress.readSpeedBoost().remainingMs, FREE_BOOST_MS + AD_BOOST_MS);
  assert.equal(f.progress.snapshot().daily.boostAds, 1);
});

test('1x and free finish spend no manual budget; idle expiry returns to 1x',()=>{
 const f=fixture(),boost=new SpeedBoostSession(f.progress);boost.advance(6000);assert.equal(boost.read().remainingMs,FREE_BOOST_MS);
 boost.cycle();boost.advance(400);boost.startFreeFinish();boost.advance(6000);assert.equal(boost.read().remainingMs,FREE_BOOST_MS-400);
 boost.stop();boost.cycle();boost.advance(FREE_BOOST_MS-400);assert.equal(boost.multiplier,1);assert.equal(boost.read().remainingMs,0);
});
