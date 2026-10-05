import assert from 'node:assert/strict';
import test from 'node:test';
import { leaderboardTestConfig, socialTestConfig } from '../ant/support/leaderboardTestConfig';
import {
  PlayerProgress, PROGRESS_SAVE_KEY, PROGRESS_BACKUP_KEY, PROGRESS_CALENDAR_START,
  type ProgressSavePort,
} from '../../assets/Colony/scripts/application/playerProgress.js';

import { DAILY_TASKS } from '../../assets/Colony/scripts/application/dailyTasks';
const DAY = 86400000;
function setup(time = PROGRESS_CALENDAR_START) {
  const values = new Map<string, string>();
  let now = time;
  let failPrimary = false;
  const save: ProgressSavePort = {
    read: key => values.get(key) ?? null,
    write(key, value) { if (failPrimary && key === PROGRESS_SAVE_KEY) throw new Error('disk full'); values.set(key, value); },
  };
  const clock = { now: () => now };
  let progress = new PlayerProgress(save, clock, leaderboardTestConfig, socialTestConfig);
  return { values, save, clock, get progress() { return progress; }, setTime(value: number) { now = value; },
    advance(days: number) { now += days * DAY; }, fail(value: boolean) { failPrimary = value; },
    restart() { progress = new PlayerProgress(save, clock, leaderboardTestConfig, socialTestConfig); return progress; } };
}
function clear(progress: PlayerProgress, level: number) {
  const round = progress.startRound(level, 'main');
  return progress.settleRound(round.id, 'SUCCESS', 100);
}
function clearThrough(progress: PlayerProgress, count: number) {
  for (let n = progress.snapshot().clearedLevels.length + 1; n <= count; n++) clear(progress, n);
}
function challenge(progress: PlayerProgress) {
  const round = progress.startRound(progress.dailyChallengeIndex() + 1, 'daily');
  return progress.settleRound(round.id, 'SUCCESS', 100);
}

test('first clear is atomic and idempotent across callbacks, replay and restart', () => {
  const env = setup();
  const round = env.progress.startRound(1);
  env.restart();
  assert.deepEqual(env.progress.settleRound(round.id, 'SUCCESS', 10), { duplicate: false, firstClear: true, coins: 40, stars: 0 });
  assert.equal(env.progress.settleRound(round.id, 'SUCCESS', 10).duplicate, true);
  clear(env.progress, 1);
  env.restart();
  assert.equal(env.progress.snapshot().coins, 40);
  assert.equal(env.progress.snapshot().stars, 0);
  assert.equal(env.progress.snapshot().totals.transported, 110);
  const firstTheme = env.progress.themeBasketProgress()[0]!;
  assert.equal(firstTheme.items.find(item => item.id === 'mango')!.count, 1);
  assert.equal(firstTheme.items.find(item => item.kind === 'stall')!.count, 0);
  assert.throws(() => env.progress.startRound(3), /前一关/);
});

test('theme baskets derive from first main clears across replay, daily challenge and restart', () => {
  const env = setup();
  const first = env.progress.themeBasketProgress();
  assert.equal(first.length, 5);
  assert.equal(first[0]!.unlocked, true);
  assert.equal(first[1]!.unlocked, false);
  clearThrough(env.progress, 12);
  assert.deepEqual(env.progress.themeBasketProgress()[0]!.items.map(item => item.count), [1, 2, 2, 2, 2, 1, 1, 1]);
  assert.equal(env.progress.themeBasketProgress()[1]!.unlocked, true);
  clear(env.progress, 1);
  challenge(env.progress);
  assert.deepEqual(env.restart().themeBasketProgress()[0]!.items.map(item => item.count), [1, 2, 2, 2, 2, 1, 1, 1]);
  clearThrough(env.progress, 60);
  assert.ok(env.progress.themeBasketProgress().every(theme => theme.cleared === 12 && theme.items.every(item => item.count === item.target)));
});

test('failed save rolls back memory and leaves a usable backup; corrupt saves are never silently reset', () => {
  const env = setup();
  const round = env.progress.startRound(1);
  const before = env.progress.snapshot();
  env.fail(true);
  assert.throws(() => env.progress.settleRound(round.id, 'SUCCESS', 10), /disk full/);
  assert.deepEqual(env.progress.snapshot(), before);
  env.fail(false);
  env.values.set(PROGRESS_SAVE_KEY, 'broken');
  assert.equal(env.restart().recoveredBackup, true);
  assert.equal(env.progress.settleRound(round.id, 'SUCCESS', 10).coins, 40);
  env.values.set(PROGRESS_SAVE_KEY, '{}'); env.values.set(PROGRESS_BACKUP_KEY, '{}');
  assert.throws(() => env.restart(), /存档损坏/);
  assert.equal(env.values.get(PROGRESS_SAVE_KEY), '{}');
});

test('all five themes complete from first clears without construction stars or spending legacy assets', () => {
  const env = setup();
  const legacy = env.progress.snapshot(); legacy.stars = 17; legacy.stalls[0] = 3; legacy.districts = [0];
  env.values.set(PROGRESS_SAVE_KEY, JSON.stringify(legacy)); env.restart();
  clearThrough(env.progress, 60);
  const before = env.progress.snapshot();
  assert.equal(before.stars, 17);
  assert.ok(env.progress.themeBasketProgress().every(theme => theme.items.every(item => item.count === item.target)));
  assert.throws(() => env.progress.build(0), /关卡收集/);
  assert.throws(() => env.progress.finishDistrict(0), /自动完成/);
  assert.throws(() => env.progress.redeemDecoration(0), /关卡收集/);
  assert.throws(() => env.progress.equipDecoration(0, 'lantern'), /自动展示/);
  assert.deepEqual(env.progress.snapshot(), before);
  const round = env.progress.startRound(1); env.progress.settleRound(round.id, 'FAIL', 0);
  assert.equal(env.progress.snapshot().coins, before.coins);
  assert.deepEqual(env.progress.snapshot().stalls, before.stalls);
  assert.throws(() => env.progress.startRound(61), /不存在/);
});

test('sign-in is cumulative, Beijing midnight resets once, and clock rollback cannot mint rewards', () => {
  const env = setup(PROGRESS_CALENDAR_START + DAY - 1000);
  clearThrough(env.progress, 3);
  env.progress.claimSignIn();
  assert.throws(() => env.progress.claimSignIn(), /已签到/);
  env.setTime(PROGRESS_CALENDAR_START + DAY);
  env.progress.claimSignIn();
  env.advance(4); env.progress.claimSignIn();
  env.setTime(PROGRESS_CALENDAR_START);
  assert.equal(env.progress.snapshot().clockRolledBack, true);
  assert.throws(() => env.progress.claimSignIn(), /时间回退/);
  env.setTime(PROGRESS_CALENDAR_START + 6 * DAY);
  for (let i = 0; i < 4; i++) { env.progress.claimSignIn(); env.advance(1); }
  assert.equal(env.progress.snapshot().signInCount, 7);
  assert.equal(env.progress.snapshot().vouchers, 1);
});

test('eight daily tasks remain completable at main cap and rewards total sixty', () => {
  const env = setup(); clearThrough(env.progress, 60); env.advance(1); env.progress.snapshot();
  for (let i = 0; i < 5; i++) clear(env.progress, 1);
  challenge(env.progress);
  const round = env.progress.startRound(1); env.progress.recordDailyTool(round.id, 'slot');
  const startAt = env.clock.now(); env.setTime(startAt + 900000);
  env.progress.recordDailyTime({ sequence: 1, startAt, endAt: env.clock.now(), onlineMs: 900000, boostMs: 120000 });
  const coins = env.progress.snapshot().coins;
  for (const task of DAILY_TASKS) env.progress.claimDailyTask(task.id);
  assert.equal(env.progress.snapshot().coins, coins + 60);
  assert.throws(() => env.progress.claimDailyTask('win-1'), /已领取/);
  assert.equal(challenge(env.progress).firstClear, false);
  env.advance(1); assert.deepEqual(env.progress.snapshot().daily.tasks.claimed, []);
  assert.equal('rerollOrder' in env.progress, false);
});

test('streak starts at level six, replay does not advance and failure resets', () => {
  const { progress } = setup();
  clearThrough(progress, 7);
  assert.equal(progress.snapshot().streak, 2);
  clear(progress, 1);
  assert.equal(progress.snapshot().streak, 2);
  assert.equal(clear(progress, 8).coins, 60);
  const round = progress.startRound(9); progress.settleRound(round.id, 'FAIL', 0);
  assert.equal(progress.snapshot().streak, 0);
  assert.equal(clear(progress, 9).coins, 40);
});

test('round captures weekend and season; late settlement auto-delivers expired milestones exactly once', () => {
  const env = setup(PROGRESS_CALENDAR_START + 6 * DAY);
  clearThrough(env.progress, 22); // 21 and 22 score this weekend.
  const round = env.progress.startRound(23);
  env.advance(1);
  env.progress.settleRound(round.id, 'SUCCESS', 100);
  const weekend = round.weekend;
  assert.equal(env.progress.snapshot().weekends[weekend].points, 3);
  assert.deepEqual(env.progress.snapshot().weekends[weekend].claimed, [0]);
  const coins = env.progress.snapshot().coins;
  env.restart();
  assert.equal(env.progress.snapshot().coins, coins);
  env.setTime(PROGRESS_CALENDAR_START + 28 * DAY);
  env.restart();
  const season = env.progress.snapshot().seasons[round.season];
  assert.equal(season.points, 120);
  assert.deepEqual(season.claimed, [1]);
  const after = env.progress.snapshot().coins;
  env.restart(); assert.equal(env.progress.snapshot().coins, after);
});

test('daily challenge opened before midnight retains its original reward day', () => {
  const env = setup(PROGRESS_CALENDAR_START + DAY - 1000);
  clearThrough(env.progress, 10);
  const round = env.progress.startRound(env.progress.dailyChallengeIndex() + 1, 'daily');
  env.advance(1);
  assert.equal(env.progress.settleRound(round.id, 'SUCCESS', 100).coins, 40);
  assert.equal(challenge(env.progress).coins, 40);
  assert.equal(env.progress.snapshot().dailyCompleted.length, 2);
});

test('ad receipts are idempotent and extra supplies cannot grow slots or be bought twice', () => {
  const { progress } = setup();
  clearThrough(progress, 3);
  progress.claimStarterDiamonds();
  const round = progress.startRound(4);
  progress.buyExtraSupply(round.id, 'trowel', 'diamond');
  const { coins, diamonds } = progress.snapshot();
  assert.throws(() => progress.buyExtraSupply(round.id, 'compass', 'diamond'), /无法领取/);
  assert.throws(() => progress.grantAdReward('supply', round.id, 'supply', 'compass'), /无法领取/);
  assert.equal(progress.snapshot().coins, coins);
  assert.equal(progress.snapshot().diamonds, diamonds);
  progress.settleRound(round.id, 'SUCCESS', 100);
  assert.equal(progress.grantAdReward('reward-1', round.id, 'clear'), true);
  assert.equal(progress.grantAdReward('reward-1', round.id, 'clear'), false);
  assert.throws(() => progress.grantAdReward('reward-2', round.id, 'clear'), /无法领取/);
});

test('extra supply uses a return token first then costs ten diamonds without spending coins', () => {
  const env = setup();
  clearThrough(env.progress, 60);
  env.advance(7); env.restart();
  clear(env.progress, 1); env.progress.claimReturn(0);
  env.progress.claimStarterDiamonds();
  const before = env.progress.snapshot();
  const tokenRound = env.progress.startRound(1);
  env.progress.buyExtraSupply(tokenRound.id, 'trowel', 'token');
  assert.equal(env.progress.snapshot().supplyTokens, before.supplyTokens - 1);
  assert.equal(env.progress.snapshot().diamonds, before.diamonds);
  const diamondRound = env.progress.startRound(1);
  env.progress.buyExtraSupply(diamondRound.id, 'compass', 'diamond');
  assert.equal(env.progress.snapshot().diamonds, before.diamonds - 10);
  assert.equal(env.progress.snapshot().coins, before.coins);
});

test('failed diamond supply save preserves diamonds and leaves the round eligible', () => {
  const env = setup(); env.progress.claimStarterDiamonds();
  const round = env.progress.startRound(1);
  const before = env.progress.snapshot();
  env.fail(true);
  assert.throws(() => env.progress.buyExtraSupply(round.id, 'trowel', 'diamond'), /disk full/);
  assert.deepEqual(env.progress.snapshot(), before);
});

test('unfunded supply choices do not consume currency or mark the round', () => {
  const env = setup();
  const round = env.progress.startRound(1);
  const before = env.progress.snapshot();
  assert.throws(() => env.progress.buyExtraSupply(round.id, 'trowel', 'diamond'), /钻石不足/);
  assert.throws(() => env.progress.buyExtraSupply(round.id, 'trowel', 'token'), /补给券不足/);
  assert.deepEqual(env.progress.snapshot(), before);
});

test('newcomer, collection, achievements, return and tutorials have durable one-time rewards', () => {
  const env = setup();
  clearThrough(env.progress, 20);
  env.progress.claimNewcomer(0);
  assert.throws(() => env.progress.claimNewcomer(0), /已领取/);
  env.progress.redeemCollection('lantern');
  env.progress.claimNewcomer(3);
  env.progress.claimAchievement('clear-20');
  assert.throws(() => env.progress.claimAchievement('clear-20'), /已领取/);
  assert.equal(env.progress.takeTutorial(), 'construction');
  assert.equal(env.progress.takeTutorial(), null);
  env.advance(7); env.restart();
  assert.ok(env.progress.snapshot().returnVisit);
  assert.equal(env.progress.takeTutorial(), 'daily');
  clear(env.progress, 21);
  env.progress.claimReturn(0);
  assert.throws(() => env.progress.claimReturn(0), /已领取/);
});

test('structurally valid JSON with broken progression or round identity restores backup', () => {
  for (const mutate of [
    (s: ReturnType<PlayerProgress['snapshot']>) => { s.clearedLevels = [60]; },
    (s: ReturnType<PlayerProgress['snapshot']>) => { s.nextRound = 0; },
    (s: ReturnType<PlayerProgress['snapshot']>) => { s.rounds['round-1'].result = 'FAIL'; },
    (s: ReturnType<PlayerProgress['snapshot']>) => { s.rounds['round-1'].day = '2026-99-90'; },
    (s: ReturnType<PlayerProgress['snapshot']>) => { s.maxTime = Number.MAX_SAFE_INTEGER; },
  ]) {
    const env = setup(); env.progress.startRound(1);
    // Make both storage slots contain this durable, valid round before introducing corruption.
    env.progress.acknowledgeMessages();
    const bad = env.progress.snapshot(); mutate(bad);
    env.values.set(PROGRESS_SAVE_KEY, JSON.stringify(bad));
    assert.equal(env.restart().recoveredBackup, true);
    assert.equal(env.progress.snapshot().rounds['round-1'].settled, false);
  }
});

test('weekend is completable after content cap using three daily challenges', () => {
  const env = setup(); clearThrough(env.progress, 60);
  env.advance(4);
  for (let i = 0; i < 3; i++) { challenge(env.progress); if (i < 2) env.advance(1); }
  const period = env.progress.calendar().weekend;
  assert.equal(env.progress.snapshot().weekends[period].points, 15);
  env.progress.claimWeekend(0); env.progress.claimWeekend(1); env.progress.claimWeekend(2);
  assert.equal(env.progress.snapshot().weekends[period].claimed.length, 3);
});

test('completed rewarded video crossing midnight grants once against the captured day quota', () => {
  const env = setup(PROGRESS_CALENDAR_START + DAY - 1000);
  const round = env.progress.startRound(1); env.progress.settleRound(round.id, 'SUCCESS', 10);
  env.advance(1);
  assert.equal(env.progress.grantAdReward('crossday', round.id, 'clear'), true);
  assert.equal(env.progress.snapshot().coins, 80);
  assert.equal(env.progress.snapshot().daily.adClears, 0);
  assert.equal(env.progress.snapshot().adDays[round.day].clears, 1);
  env.restart();
  assert.equal(env.progress.grantAdReward('crossday', round.id, 'clear'), false);
});

test('return tasks work through replay at content cap, supply tokens and decoration choices persist', () => {
  const env = setup(); clearThrough(env.progress, 60);
  const legacy = env.progress.snapshot(); legacy.stalls[0] = 3; legacy.decorations.push('stall-0-lantern'); legacy.equippedDecorations[0] = 'lantern';
  env.values.set(PROGRESS_SAVE_KEY, JSON.stringify(legacy)); env.restart();
  env.advance(7); env.restart();
  clear(env.progress, 1); env.progress.claimReturn(0);
  const before = env.progress.snapshot().coins;
  const round = env.progress.startRound(1); env.progress.buyExtraSupply(round.id, 'compass', 'token');
  assert.equal(env.progress.snapshot().coins, before);
  assert.equal(env.progress.snapshot().supplyTokens, 0);
  env.restart();
  assert.equal(env.progress.snapshot().equippedDecorations[0], 'lantern');
  assert.throws(() => env.progress.equipDecoration(0, 'base'), /自动展示/);
  assert.equal(env.progress.snapshot().equippedDecorations[0], 'lantern');
});

test('daily challenge ID matches the content catalog UTC day rotation', () => {
  const env = setup(); clearThrough(env.progress, 10);
  for (let day = 0; day < 31; day++) {
    const date = env.progress.snapshot().daily.day;
    const index = Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY) % 30;
    assert.equal(env.progress.dailyChallengeIndex(), index);
    assert.equal(env.progress.startRound(index + 1, 'daily').levelId, index + 1);
    env.advance(1);
  }
});

test('ad preflight uses captured quota and full completion still awards after a mid-video clock change', () => {
  const env = setup();
  const round = env.progress.startRound(1); env.progress.settleRound(round.id, 'SUCCESS', 10);
  assert.equal(env.progress.isAdEligible(round.id, 'clear'), true);
  env.setTime(PROGRESS_CALENDAR_START - DAY);
  assert.equal(env.progress.isAdEligible(round.id, 'clear'), false);
  // Request had already passed preflight; this callback is the platform's complete-watch acknowledgement.
  assert.equal(env.progress.grantAdReward('completed-before-clock-check', round.id, 'clear'), true);
  assert.deepEqual(env.progress.adQuota(round.id), { day: round.day, clears: 1, supplies: 0 });
  assert.equal(env.progress.isAdEligible(round.id, 'clear'), false);
});

test('an unsupported pending content version is retained without granting a mismatched clear', () => {
  const env = setup(); const round = env.progress.startRound(1);
  const saved = env.progress.snapshot(); saved.rounds[round.id].contentVersion = 'unavailable-content-v2';
  env.values.set(PROGRESS_SAVE_KEY, JSON.stringify(saved)); env.restart();
  assert.throws(() => env.progress.settleRound(round.id, 'SUCCESS', 10), /内容版本/);
  assert.equal(env.progress.snapshot().rounds[round.id].settled, false);
  assert.equal(env.progress.snapshot().stars, 0);
});

test('local baseline records cohort, active days, sessions and idempotent failures', () => {
  const env = setup(); clear(env.progress, 1);
  const failed = env.progress.startRound(2);
  env.progress.settleRound(failed.id, 'FAIL', 10); env.progress.settleRound(failed.id, 'FAIL', 10);
  env.advance(1); env.restart(); env.restart();
  const s = env.progress.snapshot();
  assert.equal(s.createdAt, PROGRESS_CALENDAR_START);
  assert.equal(s.firstBuildAt, null);
  assert.equal(s.sessionCount, 3);
  assert.equal(s.activeDays.length, 2);
  assert.equal(s.totals.failures, 1);
  assert.equal(s.rounds[failed.id].completedAt, PROGRESS_CALENDAR_START);
});

