import assert from 'node:assert/strict';
import test from 'node:test';
import { collectionObject, readCollectionObject } from '../../assets/Colony/scripts/application/collectionObject';
import { THEME_BASKETS } from '../../assets/Colony/scripts/application/operationalLevels';
import { PlayerProgress, PROGRESS_SAVE_KEY, PROGRESS_BACKUP_KEY, PROGRESS_CALENDAR_START, type ProgressSavePort } from '../../assets/Colony/scripts/application/playerProgress';
import { leaderboardTestConfig, socialTestConfig } from '../ant/support/leaderboardTestConfig';
function setup() {
  const values = new Map<string, string>(); let fail = false, writes = 0;
  const save: ProgressSavePort = { read: key => values.get(key) ?? null, write: (key, value) => {
    if (fail && key === PROGRESS_SAVE_KEY) throw Error('disk full'); values.set(key, value); writes++;
  } };
  const clock = { now: () => PROGRESS_CALENDAR_START };
  let p = new PlayerProgress(save, clock, leaderboardTestConfig, socialTestConfig);
  return { get p() { return p; }, values, writes: () => writes, fail: (value: boolean) => { fail = value; },
    restart: () => p = new PlayerProgress(save, clock, leaderboardTestConfig, socialTestConfig),
    win: (level: number) => { const round = p.startRound(level); return p.settleRound(round.id, 'SUCCESS', 1); } };
}
test('all forty existing objects have deterministic campaign sources and permanent display uses', () => {
  const ids = THEME_BASKETS.flatMap(theme => theme.items.map(item => item.id)); assert.equal(ids.length, 40);
  const sources = ids.flatMap(id => {
    const detail = readCollectionObject([], id)!;
    assert.equal(detail.count, 0); assert.equal(detail.sourceLevels.length, detail.item.target); assert.ok(detail.purpose.includes('展示'));
    const completed = readCollectionObject(Array.from({ length: 60 }, (_, i) => i + 1), id)!;
    assert.equal(completed.count, completed.item.target); assert.equal(completed.nextLevel, null); return detail.sourceLevels;
  });
  assert.deepEqual(sources.sort((a, b) => a - b), Array.from({ length: 60 }, (_, i) => i + 1));
  assert.equal(collectionObject('made-up-reward'), null); assert.equal(readCollectionObject([], 'made-up-reward'), null);
});
test('tracking persists exactly one valid object and failed replacement leaves it unchanged', () => {
  const f = setup(); assert.equal(f.p.snapshot().trackedObjectId, null);
  assert.equal(f.p.trackObject('mango'), true); const writes = f.writes(); assert.equal(f.p.trackObject('mango'), false); assert.equal(f.writes(), writes);
  assert.equal(f.restart().trackedObject()?.item.id, 'mango'); const before = f.p.snapshot();
  f.fail(true); assert.throws(() => f.p.trackObject('banana'), /disk full/); assert.deepEqual(f.p.snapshot(), before);
  f.fail(false); assert.throws(() => f.p.trackObject('made-up-reward'), /不存在/); assert.equal(f.p.snapshot().trackedObjectId, 'mango');
  f.p.trackObject('banana'); assert.equal(f.restart().snapshot().trackedObjectId, 'banana'); f.p.trackObject(null); assert.equal(f.restart().trackedObject(), null);
});
test('completion saves a notice with the first clear and never pays an extra reward', () => {
  const f = setup(); f.p.trackObject('mango'); const end = readCollectionObject([], 'mango')!.sourceLevels.at(-1)!;
  for (let level = 1; level <= end; level++) f.win(level);
  assert.equal(f.p.trackedObject()?.complete, true); assert.equal(f.p.wallet().coins, 40 * end);
  assert.equal(f.restart().takeTrackedObjectNotice(), '收集目标已完成：热带水果·芒果'); assert.equal(f.p.takeTrackedObjectNotice(), null);
  f.p.trackObject(null); f.p.trackObject('mango'); f.win(end); assert.equal(f.p.takeTrackedObjectNotice(), null); assert.equal(f.p.wallet().coins, 40 * end);
});
test('failed completion save and failed acknowledgement retain their retry boundary', () => {
  const f = setup(); f.p.trackObject('tropical-fruit-stall'); f.win(1); const round = f.p.startRound(2); f.fail(true);
  assert.throws(() => f.p.settleRound(round.id, 'SUCCESS', 1), /disk full/); assert.equal(f.p.trackedObject()?.count, 0); assert.equal(f.p.snapshot().pendingMessages.length, 0);
  f.fail(false); f.p.settleRound(round.id, 'SUCCESS', 1); f.fail(true); assert.throws(() => f.p.takeTrackedObjectNotice(), /disk full/);
  f.fail(false); assert.equal(f.restart().takeTrackedObjectNotice(), '收集目标已完成：热带水果·摊位'); assert.equal(f.p.takeTrackedObjectNotice(), null);
});
test('old saves default to no tracker and invalid IDs preserve the corrupt physical data', () => {
  const f = setup(), old = f.p.snapshot() as unknown as Record<string, unknown>; delete old.trackedObjectId;
  f.values.set(PROGRESS_SAVE_KEY, JSON.stringify(old)); assert.equal(f.restart().snapshot().trackedObjectId, null);
  const raw = JSON.stringify({ ...f.p.snapshot(), trackedObjectId: 'unknown' }); f.values.set(PROGRESS_SAVE_KEY, raw); f.values.set(PROGRESS_BACKUP_KEY, raw);
  assert.throws(() => f.restart(), /存档损坏/); assert.equal(f.values.get(PROGRESS_SAVE_KEY), raw);
});
test('different same-name objects keep separate notices and duplicate wording is acknowledged one at a time', () => {
  const f = setup(); f.p.trackObject('tropical-fruit-stall'); f.win(1); f.win(2);
  f.p.trackObject('tropical-vegetable-stall');
  const end = readCollectionObject([], 'tropical-vegetable-stall')!.sourceLevels.at(-1)!;
  for (let level = 3; level <= end; level++) f.win(level);
  const messages = f.p.snapshot().pendingMessages.filter(value => value.startsWith('收集目标已完成：'));
  assert.equal(messages.length, 2); assert.notEqual(messages[0], messages[1]);
  assert.equal(f.p.takeTrackedObjectNotice(), messages[0]); assert.equal(f.p.takeTrackedObjectNotice(), messages[1]); assert.equal(f.p.takeTrackedObjectNotice(), null);
  const s = f.p.snapshot(); s.pendingMessages.push('收集目标已完成：摊位', '收集目标已完成：摊位');
  f.values.set(PROGRESS_SAVE_KEY, JSON.stringify(s)); f.restart();
  assert.equal(f.p.takeTrackedObjectNotice(), '收集目标已完成：摊位'); assert.equal(f.p.snapshot().pendingMessages.filter(value => value.startsWith('收集目标已完成：')).length, 1);
  assert.equal(f.p.takeTrackedObjectNotice(), '收集目标已完成：摊位'); assert.equal(f.p.takeTrackedObjectNotice(), null);
});
