import assert from 'node:assert/strict';
import test from 'node:test';
import { StageTargetSelector } from '../../assets/Colony/scripts/application/stageTargetSelector';
import { PlayerProgress, PROGRESS_CALENDAR_START, STAGE_GOALS } from '../../assets/Colony/scripts/application/playerProgress';
import { leaderboardTestConfig, socialTestConfig } from '../ant/support/leaderboardTestConfig';

test('new save targets the first milestone and reuses the authoritative reward configuration', () => {
  const result = StageTargetSelector.select({ clearedLevels: [], rewardLedger: [] });
  assert.equal(result.status, 'in-progress');
  assert.equal(result.next?.target, 6);
  assert.equal(result.title, '首次通关第6关');
  assert.equal(result.rewardText, '阶段奖励20金币');
  assert.deepEqual(result.milestones.map(({ target, coins }) => ({ target, coins })), STAGE_GOALS.map(({ target, coins }) => ({ target, coins })));
});

test('unlocked levels, pending rounds and the count of other clears do not prove a milestone first clear', () => {
  const facts = { clearedLevels: [1, 2, 3, 4, 5, 7, 18], rewardLedger: [], unlockedLevel: 60, rounds: { pending: { levelId: 6 } } };
  const result = StageTargetSelector.select(facts);
  assert.equal(result.next?.target, 6);
  assert.equal(result.milestones[0]!.firstCleared, false);
  assert.equal(result.milestones[1]!.firstCleared, true);
});

test('first clear advances the target without claiming or inventing missing reward records', () => {
  const facts = Object.freeze({ clearedLevels: Object.freeze([1, 2, 3, 4, 5, 6]), rewardLedger: Object.freeze(['clear:main:6']) });
  const before = JSON.stringify(facts);
  const result = StageTargetSelector.select(facts);
  assert.equal(result.next?.target, 18);
  assert.deepEqual(result.unrecordedRewardTargets, [6]);
  assert.deepEqual(result.rewardsWithoutFirstClear, []);
  assert.equal(result.milestones[0]!.rewardRecorded, false);
  assert.equal(JSON.stringify(facts), before);
});

test('a reward record without its first clear is reported and preserved, not treated as completion', () => {
  const facts = Object.freeze({ clearedLevels: Object.freeze([]), rewardLedger: Object.freeze(['stage-goal:6', 'unrelated:record']) });
  const before = JSON.stringify(facts);
  const result = StageTargetSelector.select(facts);
  assert.equal(result.next?.target, 6);
  assert.deepEqual(result.rewardsWithoutFirstClear, [6]);
  assert.equal(result.rewardText, '阶段奖励20金币（已有领取记录）');
  assert.equal(JSON.stringify(facts), before);
});

test('all actual milestone clears complete the display independently of reward claim status', () => {
  const result = StageTargetSelector.select({ clearedLevels: STAGE_GOALS.map(goal => goal.target), rewardLedger: [] });
  assert.equal(result.status, 'complete');
  assert.equal(result.next, null);
  assert.equal(result.title, '全部阶段目标已通关');
  assert.deepEqual(result.unrecordedRewardTargets, [6, 18, 30, 42, 54, 60]);
  assert.equal(result.rewardText, '奖励领取记录以现有账本为准');
});

test('real saved progression stays stable across replay, next-day reload and repeated projection with zero writes', () => {
  const values = new Map<string, string>();
  let writes = 0;
  let now = PROGRESS_CALENDAR_START;
  const save = { read: (key: string) => values.get(key) ?? null, write: (key: string, value: string) => { writes++; values.set(key, value); } };
  const create = () => new PlayerProgress(save, { now: () => now }, leaderboardTestConfig, socialTestConfig);
  let progress = create();
  for (let level = 1; level <= 6; level++) {
    const round = progress.startRound(level);
    progress.settleRound(round.id, 'SUCCESS', 1);
  }
  progress.claimStageGoal('6');
  const replay = progress.startRound(6);
  progress.settleRound(replay.id, 'SUCCESS', 1);
  const expected = StageTargetSelector.select(progress.snapshot());
  now += 86400000;
  progress = create();
  const before = progress.snapshot();
  const storageBefore = [...values];
  const writesBefore = writes;
  assert.deepEqual(StageTargetSelector.select(before), expected);
  assert.deepEqual(StageTargetSelector.select(progress.snapshot()), expected);
  assert.equal(writes, writesBefore);
  assert.deepEqual([...values], storageBefore);
  assert.deepEqual(progress.snapshot(), before);
  assert.equal(expected.next?.target, 18);
  assert.equal(expected.milestones[0]!.rewardRecorded, true);
});
