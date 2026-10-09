import assert from 'node:assert/strict';
import test from 'node:test';
import { PlayerProgress, PROGRESS_SAVE_KEY, PROGRESS_BACKUP_KEY, PROGRESS_CALENDAR_START } from '../../assets/Colony/scripts/application/playerProgress';
import { leaderboardTestConfig, socialTestConfig } from '../ant/support/leaderboardTestConfig';
function setup() {
  const values = new Map<string, string>(); let fail = false, now = PROGRESS_CALENDAR_START;
  const save = { read: (key: string) => values.get(key) ?? null, write: (key: string, value: string) => { if (fail && key === PROGRESS_SAVE_KEY) throw Error('disk full'); values.set(key, value); } };
  let p = new PlayerProgress(save, { now: () => now }, leaderboardTestConfig, socialTestConfig);
  return { get p() { return p; }, values, fail: (v: boolean) => fail = v, restart: (days = 0) => { now += days * 86400000; p = new PlayerProgress(save, { now: () => now }, leaderboardTestConfig, socialTestConfig); } };
}
test('old v6 archives start permanent guide pending without consuming daily tutorial', () => {
  const f = setup(); f.p.startRound(1); const raw = JSON.parse(f.values.get(PROGRESS_SAVE_KEY)!); delete raw.guide;
  f.values.set(PROGRESS_SAVE_KEY, JSON.stringify(raw)); f.restart();
  assert.deepEqual(f.p.readGuide(), { status: 'pending', segment: 0 }); assert.deepEqual(f.p.snapshot().tutorialDays, {});
});
test('core gate accepts completed main transport only, preserving all rewards', () => {
  const f = setup(), round = f.p.startRound(1); const coins = f.p.snapshot().coins;
  assert.throws(() => f.p.advanceGuide(0), /实际操作/);
  assert.throws(() => f.p.advanceGuide(0, { roundId: round.id, transported: 0 }), /实际操作/);
  assert.throws(() => f.p.advanceGuide(0, { roundId: 'unknown', transported: 1 }), /实际操作/);
  assert.equal(f.p.advanceGuide(0, { roundId: round.id, transported: 1 }), true);
  assert.equal(f.p.advanceGuide(0, { roundId: round.id, transported: 1 }), false);
  assert.equal(f.p.snapshot().coins, coins); f.restart(); assert.equal(f.p.readGuide().segment, 1);
});
test('skip failure rolls back; retry saves permanent skipped across days and repeats', () => {
  const f = setup(); f.fail(true); assert.throws(() => f.p.skipGuide(), /disk full/); assert.equal(f.p.readGuide().status, 'pending');
  f.fail(false); assert.equal(f.p.skipGuide(), true); assert.equal(f.p.skipGuide(), false); f.restart(10);
  assert.deepEqual(f.p.readGuide(), { status: 'skipped', segment: 0 }); assert.equal(f.p.advanceGuide(0), false);
});
test('four segments require saved first clear, tracked target and same-object partner dialogue', () => {
  const f = setup(); f.p.settleRound(f.p.startRound(1).id, 'SUCCESS', 1); f.p.advanceGuide(0); f.p.advanceGuide(1);
  assert.throws(() => f.p.advanceGuide(2), /实际操作/); f.p.trackObject('mango'); f.p.advanceGuide(2);
  assert.throws(() => f.p.advanceGuide(3), /实际操作/);
  for (const level of [2, 3]) f.p.settleRound(f.p.startRound(level).id, 'SUCCESS', 1);
  f.p.beginPartnerDialogue('bot-0'); f.p.advancePartnerDialogue('ask'); f.p.advancePartnerDialogue('source'); f.p.advancePartnerDialogue('track');
  f.p.trackObject('banana'); assert.throws(() => f.p.advanceGuide(3), /实际操作/); f.p.trackObject('mango');
  const coins = f.p.snapshot().coins; f.fail(true); assert.throws(() => f.p.advanceGuide(3), /disk full/); assert.equal(f.p.readGuide().status, 'pending');
  f.fail(false); f.p.advanceGuide(3); f.restart(7); assert.deepEqual(f.p.readGuide(), { status: 'done', segment: 4 });
  assert.equal(f.p.snapshot().coins, coins); assert.equal(f.p.skipGuide(), false); assert.equal(f.p.advanceGuide(3), false);
});
test('out-of-order commands and failed core receipt do not advance or settle a round', () => {
  const f = setup(), round = f.p.startRound(1); assert.equal(f.p.advanceGuide(2), false);
  f.fail(true); assert.throws(() => f.p.advanceGuide(0, { roundId: round.id, transported: 1 }), /disk full/);
  assert.equal(f.p.readGuide().segment, 0); assert.equal(f.p.snapshot().rounds[round.id]!.settled, false);
  f.fail(false); f.p.advanceGuide(0, { roundId: round.id, transported: 1 }); assert.equal(f.p.snapshot().rounds[round.id]!.settled, false);
});
test('invalid permanent status/segment archive preserves corrupt raw input', () => {
  const f = setup(); f.p.startRound(1); const raw = JSON.parse(f.values.get(PROGRESS_SAVE_KEY)!); raw.guide = { status: 'done', segment: 0 };
  const corrupt = JSON.stringify(raw); f.values.set(PROGRESS_SAVE_KEY, corrupt); f.values.delete(PROGRESS_BACKUP_KEY);
  assert.throws(() => f.restart(), /存档损坏/); assert.equal(f.values.get(PROGRESS_SAVE_KEY), corrupt);
});
