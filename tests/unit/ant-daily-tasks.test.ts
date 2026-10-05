import assert from 'node:assert/strict';
import test from 'node:test';
import { PlayerProgress, PROGRESS_SAVE_KEY, PROGRESS_BACKUP_KEY } from '../../assets/Colony/scripts/application/playerProgress';
import { DAILY_TASKS, freshDailyTasks } from '../../assets/Colony/scripts/application/dailyTasks';
import { DailyActivityBuffer } from '../../assets/Colony/scripts/application/dailyActivity';
import { leaderboardTestConfig, socialTestConfig } from '../ant/support/leaderboardTestConfig';
function fixture(resetDay = true) {
  let now = Date.parse('2026-10-05T12:00:00+08:00'), fail = false;
  const data = new Map<string, string>();
  const save = { read: (key: string) => data.get(key) ?? null, write: (key: string, value: string) => { if (fail && key === PROGRESS_SAVE_KEY) throw Error('disk'); data.set(key, value); } };
  const create = () => new PlayerProgress(save, { now: () => now }, leaderboardTestConfig, socialTestConfig);
  let p = create();
  for (let i = 1; i <= 5; i++) { const r = p.startRound(i); p.settleRound(r.id, 'SUCCESS', 10); }
  if (resetDay) { now += 86400000; p.snapshot(); }
  return { data, get p() { return p; }, restart() { p = create(); }, now: () => now, time: (value: number) => { now = value; }, fail: (value: boolean) => { fail = value; } };
}
test('each task pays once; valid replay, failure and duplicate settlement are distinguished', () => {
  const f = fixture(), initial = f.p.snapshot().coins;
  const r = f.p.startRound(1); f.p.settleRound(r.id, 'SUCCESS', 1); f.p.settleRound(r.id, 'SUCCESS', 1);
  f.p.claimDailyTask('win-1'); assert.equal(f.p.snapshot().coins, initial + 5);
  assert.throws(() => f.p.claimDailyTask('win-1')); assert.throws(() => f.p.claimDailyTask('win-3'));
  const failure = f.p.startRound(1); f.p.settleRound(failure.id, 'FAIL', 1);
  assert.equal(f.p.snapshot().daily.tasks.wins, 1); f.restart(); assert.deepEqual(f.p.snapshot().daily.tasks.claimed, ['win-1']);
});
test('tool success records before settlement, deduplicates, and failed primary write retries atomically', () => {
  const f = fixture(), r = f.p.startRound(1);
  f.fail(true); assert.throws(() => f.p.recordDailyTool(r.id, 'slot')); assert.equal(f.p.snapshot().daily.tasks.tools, 0);
  f.fail(false); f.p.recordDailyTool(r.id, 'slot'); f.p.recordDailyTool(r.id, 'slot'); f.restart();
  assert.equal(f.p.snapshot().daily.tasks.tools, 1); assert.throws(() => f.p.recordDailyTool(r.id, 'unknown'));
});
test('actual milliseconds persist once, rollover counts current-day overlap and rollback earns no time', () => {
  const f = fixture(), start = f.now(); f.time(start + 30000);
  const receipt = { sequence: 1, startAt: start, endAt: f.now(), onlineMs: 30000, boostMs: 9000 };
  f.fail(true); assert.throws(() => f.p.recordDailyTime(receipt)); f.fail(false);
  f.p.recordDailyTime(receipt); f.p.recordDailyTime(receipt); f.restart();
  assert.equal(f.p.snapshot().daily.tasks.onlineMs, 30000); assert.equal(f.p.snapshot().daily.tasks.boostMs, 9000);
  const midnight = Date.parse('2026-10-07T00:00:00+08:00'); f.time(midnight + 5000);
  f.p.recordDailyTime({ sequence: 2, startAt: midnight - 5000, endAt: midnight + 5000, onlineMs: 10000, boostMs: 2000 });
  assert.equal(f.p.snapshot().daily.tasks.onlineMs, 5000); assert.equal(f.p.snapshot().daily.tasks.boostMs, 1000);
  f.time(midnight - 120000); f.p.recordDailyTime({ sequence: 3, startAt: midnight - 125000, endAt: midnight - 120000, onlineMs: 5000, boostMs: 0 });
  assert.equal(f.p.snapshot().daily.tasks.onlineMs, 5000); assert.equal(f.p.snapshot().clockRolledBack, true);
});
test('all goals pay sixty coins and one season bonus, including repeated daily wins', () => {
  const f = fixture();
  for (let i = 6; i <= 20; i++) { const r = f.p.startRound(i); f.p.settleRound(r.id, 'SUCCESS', 1); }
  f.time(f.now() + 86400000); f.p.snapshot();
  for (let i = 0; i < 5; i++) { const r = f.p.startRound(f.p.dailyChallengeIndex() + 1, 'daily'); f.p.settleRound(r.id, 'SUCCESS', 1); }
  const r = f.p.startRound(1); f.p.recordDailyTool(r.id, 'trowel');
  const start = f.now(); f.time(start + 900000);
  f.p.recordDailyTime({ sequence: 1, startAt: start, endAt: f.now(), onlineMs: 900000, boostMs: 120000 });
  const season = f.p.calendar().season, before = f.p.snapshot();
  for (const task of DAILY_TASKS) f.p.claimDailyTask(task.id);
  f.p.recordDailyTime({ sequence: 1, startAt: start, endAt: f.now(), onlineMs: 900000, boostMs: 120000 });
  const after = f.p.snapshot(); assert.equal(after.coins, before.coins + 60); assert.equal(after.seasons[season]!.points, before.seasons[season]!.points);
  assert.ok(after.daily.tasks.seasonClaimed); assert.equal(after.totals.orders, 1);
});
test('backup recovery keeps receipt idempotence and rejects corrupt v6 task data', () => {
  const f = fixture(), start = f.now(); f.time(start + 30000);
  const receipt = { sequence: 1, startAt: start, endAt: f.now(), onlineMs: 30000, boostMs: 10000 };
  f.p.recordDailyTime(receipt); f.p.startRound(1); f.data.set(PROGRESS_SAVE_KEY, '{broken'); f.restart();
  f.p.recordDailyTime(receipt); assert.equal(f.p.snapshot().daily.tasks.onlineMs, 30000);
  const broken = JSON.parse(f.data.get(PROGRESS_SAVE_KEY)!); broken.daily.tasks.onlineMs = -1;
  f.data.set(PROGRESS_SAVE_KEY, JSON.stringify(broken)); f.data.delete(PROGRESS_BACKUP_KEY); assert.throws(() => f.restart(), /存档损坏/);
});
test('monotonic activity buffer splits midnight, excludes inactive observations and retries the exact failed receipt', () => {
  const midnight = Date.parse('2026-10-06T00:00:00+08:00'), b = new DailyActivityBuffer(0, 0, midnight - 10000);
  b.sample(10000, midnight, true, 4000); b.sample(20000, midnight + 10000, true, 0);
  const written: {sequence: number; onlineMs: number; boostMs: number}[] = [];
  assert.throws(() => b.flush(r => { written.push(r); throw Error('disk'); }));
  b.flush(r => written.push(r)); assert.equal(written[0]!.sequence, written[1]!.sequence);
  assert.deepEqual(written.slice(1).map(r => [r.onlineMs, r.boostMs]), [[10000, 4000], [10000, 0]]);
  b.sample(30000, midnight + 20000, false, 10000); b.flush(r => written.push(r)); assert.equal(written.length, 3);
  b.reset(40000, midnight + 30000); b.sample(40000.5, midnight + 30000, true); b.sample(40001.5, midnight + 30001, true);
  b.flush(r => written.push(r)); assert.equal(written.at(-1)!.onlineMs, 1);
});
test('first five main wins are already counted when the task entry unlocks', () => {
  const f = fixture(false); assert.equal(f.p.snapshot().daily.tasks.wins, 5);
  const before = f.p.snapshot().coins; f.p.claimDailyTask('win-5'); assert.equal(f.p.snapshot().coins, before + 15);
});
test('midnight uses action time, while an old failed tool write cannot count today', () => {
  const f = fixture(), midnight = Date.parse('2026-10-07T00:00:00+08:00'); f.time(midnight - 1000);
  const r = f.p.startRound(1), occurredAt = f.now();
  f.fail(true); assert.throws(() => f.p.recordDailyTool(r.id, 'slot', occurredAt)); f.fail(false);
  f.time(midnight + 1000); f.p.recordDailyTool(r.id, 'slot', occurredAt); assert.equal(f.p.snapshot().daily.tasks.tools, 0);
  f.p.recordDailyTool(r.id, 'compass', f.now()); f.p.settleRound(r.id, 'SUCCESS', 1);
  assert.equal(f.p.snapshot().daily.tasks.tools, 1); assert.equal(f.p.snapshot().daily.tasks.wins, 1);
});
test('finishing tasks before season unlock preserves the later one-time 120 XP', () => {
  const f = fixture(false), r = f.p.startRound(1); f.p.recordDailyTool(r.id, 'slot');
  const start = f.now(); f.time(start + 900000);
  f.p.recordDailyTime({ sequence: 1, startAt: start, endAt: f.now(), onlineMs: 900000, boostMs: 120000 });
  assert.equal(f.p.snapshot().daily.tasks.seasonClaimed, false);
  for (let level = 6; level <= 20; level++) { const round = f.p.startRound(level); f.p.settleRound(round.id, 'SUCCESS', 1); }
  const season = f.p.calendar().season; assert.equal(f.p.snapshot().seasons[season]!.points, 120);
  for (const task of DAILY_TASKS) f.p.claimDailyTask(task.id); f.restart();
  assert.equal(f.p.snapshot().seasons[season]!.points, 120); assert.equal(f.p.snapshot().totals.orders, 1);
});

test('clock rollback postpones the season unlock bonus until time recovers', () => {
  const f = fixture(false), r = f.p.startRound(1); f.p.recordDailyTool(r.id, 'slot');
  const start = f.now(); f.time(start + 900000);
  f.p.recordDailyTime({ sequence: 1, startAt: start, endAt: f.now(), onlineMs: 900000, boostMs: 120000 });
  const savedTime = f.now(); f.time(savedTime - 120000);
  for (let level = 6; level <= 20; level++) { const round = f.p.startRound(level); f.p.settleRound(round.id, 'SUCCESS', 1); }
  assert.equal(f.p.snapshot().clockRolledBack, true); assert.equal(f.p.snapshot().daily.tasks.seasonClaimed, false);
  const season = f.p.calendar().season; assert.equal(f.p.snapshot().seasons[season]?.points ?? 0, 0);
  assert.throws(() => f.p.claimDailyTask('win-1'));
  f.time(savedTime); f.p.claimDailyTask('win-1'); f.p.claimDailyTask('win-3'); f.restart();
  assert.equal(f.p.snapshot().seasons[season]!.points, 120);
});

test('a rolled-back tool timestamp is dropped so queued time can save after recovery', () => {
  const f = fixture(), r = f.p.startRound(1), start = f.now(); f.time(start - 120000);
  const occurredAt = f.now(); f.p.recordDailyTool(r.id, 'slot', occurredAt);
  assert.equal(f.p.snapshot().daily.tasks.tools, 0);
  f.time(start + 30000); f.p.recordDailyTool(r.id, 'slot', occurredAt);
  f.p.recordDailyTime({ sequence: 1, startAt: start, endAt: f.now(), onlineMs: 30000, boostMs: 0 }); f.restart();
  assert.equal(f.p.snapshot().daily.tasks.onlineMs, 30000); assert.equal(f.p.snapshot().daily.tasks.tools, 0);
});
