import assert from 'node:assert/strict';
import test from 'node:test';
import { leaderboardTestConfig, socialTestConfig } from '../support/leaderboardTestConfig';
import { PlayerProgress, PROGRESS_CALENDAR_START, PROGRESS_SAVE_KEY } from '../../assets/Colony/scripts/application/playerProgress.js';
import { readCollectionFeedback, readConstruction } from '../../assets/Colony/scripts/presentation/constructionPresentation.js';

function setup(cleared = 0) {
  const values = new Map<string, string>();
  let fail = false;
  const save = { read: (key: string) => values.get(key) ?? null, write(key: string, value: string) {
    if (fail && key === PROGRESS_SAVE_KEY) throw new Error('disk full');
    values.set(key, value);
  } };
  const clock = { now: () => PROGRESS_CALENDAR_START };
  const progress = new PlayerProgress(save, clock, leaderboardTestConfig, socialTestConfig);
  for (let level = 1; level <= cleared; level++) {
    const round = progress.startRound(level);
    progress.settleRound(round.id, 'SUCCESS', 100);
  }
  return { progress, fail() { fail = true; }, restart() { return new PlayerProgress(save, clock, leaderboardTestConfig, socialTestConfig); } };
}

test('collection defaults to first unfinished theme and next missing item without mutating progress', () => {
  const snapshot = setup(13).progress.snapshot(); const original = structuredClone(snapshot);
  const model = readConstruction(snapshot);
  assert.equal(model.themeIndex, 1); assert.equal(model.stallCollected, true);
  assert.equal(model.items[model.selected]!.kind, 'produce');
  assert.equal(model.primary.action, 'level:14'); assert.deepEqual(snapshot, original);
});

test('first theme preserves mango tutorial, then collects the stall and displays saved fruit', () => {
  const env = setup();
  assert.equal(readConstruction(env.progress.snapshot()).primary.action, 'level:1');
  assert.equal(readConstruction(env.progress.snapshot()).stallCollected, false);
  const round = env.progress.startRound(1); env.progress.settleRound(round.id, 'SUCCESS', 10);
  const first = readConstruction(env.restart().snapshot());
  assert.equal(first.stallCollected, false);
  assert.equal(first.items.find(item => item.id === 'mango')!.count, 1);
  assert.equal(first.primary.action, 'level:2');
  assert.equal(first.items[first.selected]!.kind, 'stall');
  assert.match(first.detail, /芒果已收集并保留，收集摊位后会自动摆上/);
  const stallRound = env.progress.startRound(2); env.progress.settleRound(stallRound.id, 'SUCCESS', 10);
  const stall = readConstruction(env.restart().snapshot());
  assert.equal(stall.stallCollected, true);
  assert.equal(stall.items.find(item => item.id === 'mango')!.count, 1);
  assert.equal(stall.primary.action, 'level:3');
  assert.doesNotMatch(stall.detail, /收集摊位后/);
  const lantern = readConstruction(setup(5).progress.snapshot());
  assert.equal(lantern.items[lantern.selected]!.kind, 'decoration'); assert.equal(lantern.primary.action, 'level:6');
  const sign = readConstruction(setup(10).progress.snapshot()); assert.equal(sign.primary.action, 'level:11');
  assert.equal(readConstruction(setup(11).progress.snapshot()).primary.action, 'level:12');
});

test('choosing an already collected or future item still directs to the next reachable missing level', () => {
  const snapshot = setup(2).progress.snapshot();
  assert.equal(readConstruction(snapshot, 0, 0).primary.action, 'level:3');
  assert.equal(readConstruction(snapshot, 0, 7).primary.action, 'level:3');
  assert.equal(readConstruction(snapshot, 2).unlocked, false);
  assert.equal(readConstruction(snapshot, 2).primary.action, 'level:3');
});

test('completed theme shows permanent collection and next theme navigation', () => {
  const model = readConstruction(setup(12).progress.snapshot(), 0);
  assert.equal(model.completed, true); assert.equal(model.items.length, 8);
  assert.ok(model.items.every(item => item.count === item.target));
  assert.equal(model.primary.action, 'theme:1');
  assert.equal(model.previous.enabled, false); assert.equal(model.next.enabled, true);
  const end = readConstruction(setup(60).progress.snapshot());
  assert.equal(end.themeIndex, 4); assert.equal(end.next.enabled, false); assert.equal(end.primary.enabled, false);
  assert.equal(end.items.filter(item => item.kind === 'produce').every(item => item.target === 2), true);
});

test('legacy construction stage and decorations do not grant unrelated collection items', () => {
  const snapshot = setup().progress.snapshot(); snapshot.stalls.fill(3); snapshot.districts = [0, 1, 2]; snapshot.stars = 60;
  snapshot.decorations = ['stall-0-lantern']; snapshot.equippedDecorations.fill('lantern');
  const model = readConstruction(snapshot); assert.ok(model.items.every(item => item.count === 0));
  assert.equal(model.primary.action, 'level:1'); assert.equal(model.stallCollected, false);
});

test('first-theme first-clear feedback projects actual item quantities without changing the save', () => {
  for (const level of [2, 6, 7, 12]) {
    const snapshot = setup(level).progress.snapshot(), original = structuredClone(snapshot);
    const feedback = readCollectionFeedback(snapshot, level, true, false)!;
    assert.equal(feedback.collected, level);
    assert.equal(feedback.count, level === 7 ? 2 : 1);
    assert.equal(feedback.target, level === 7 ? 2 : 1);
    const model = readConstruction(snapshot, 0);
    const selected = model.items.findIndex(item => item.id === feedback.itemId);
    assert.equal(readConstruction(snapshot, 0, selected).items[selected]!.selected, true);
    assert.deepEqual(snapshot, original);
  }
});

test('tutorial, replay, daily challenge and other themes keep the original result projection', () => {
  const snapshot = setup(13).progress.snapshot();
  assert.equal(readCollectionFeedback(snapshot, 1, true, false), undefined);
  assert.equal(readCollectionFeedback(snapshot, 7, false, false), undefined);
  assert.equal(readCollectionFeedback(snapshot, 7, true, true), undefined);
  assert.equal(readCollectionFeedback(snapshot, 13, true, false), undefined);
});

test('duplicate settlement and failed save never create another collection receipt', () => {
  const env = setup(1), round = env.progress.startRound(2);
  const first = env.progress.settleRound(round.id, 'SUCCESS', 566);
  assert.equal(readCollectionFeedback(env.progress.snapshot(), 2, first.firstClear, false)!.count, 1);
  const duplicate = env.progress.settleRound(round.id, 'SUCCESS', 566);
  assert.equal(readCollectionFeedback(env.progress.snapshot(), 2, duplicate.firstClear, false), undefined);
  const failure = setup(1), failedRound = failure.progress.startRound(2);
  failure.fail();
  assert.throws(() => failure.progress.settleRound(failedRound.id, 'SUCCESS', 566), /disk full/);
  assert.equal(readConstruction(failure.progress.snapshot(), 0).stallCollected, false);
});

test('failed first-clear persistence leaves collection display unchanged', () => {
  const env = setup(5); const round = env.progress.startRound(6); const before = readConstruction(env.progress.snapshot());
  env.fail(); assert.throws(() => env.progress.settleRound(round.id, 'SUCCESS', 10), /disk full/);
  assert.deepEqual(readConstruction(env.progress.snapshot()), before);
});
