import { STAGE_GOALS } from './playerProgress';

export interface StageTargetFacts {
  readonly clearedLevels: readonly number[];
  readonly rewardLedger: readonly string[];
}

export interface StageTargetMilestone {
  readonly id: string;
  readonly name: string;
  readonly target: number;
  readonly coins: number;
  readonly firstCleared: boolean;
  readonly rewardRecorded: boolean;
}

export interface StageTargetProjection {
  readonly status: 'in-progress' | 'complete';
  readonly next: StageTargetMilestone | null;
  readonly title: string;
  readonly rewardText: string;
  readonly milestones: readonly StageTargetMilestone[];
  /** An unclaimed stage is normal: the existing reward transaction requires an explicit claim. */
  readonly unrecordedRewardTargets: readonly number[];
  /** Report inconsistent facts; never repair progress or reward records from the display layer. */
  readonly rewardsWithoutFirstClear: readonly number[];
}

/** Pure display projection; does not unlock levels, settle rounds, claim rewards or save state. */
export class StageTargetSelector {
  public static select(facts: StageTargetFacts): StageTargetProjection {
    const cleared = new Set(facts.clearedLevels);
    const ledger = new Set(facts.rewardLedger);
    const milestones = STAGE_GOALS.map(goal => ({
      ...goal,
      firstCleared: cleared.has(goal.target),
      rewardRecorded: ledger.has(`stage-goal:${goal.id}`),
    }));
    const next = milestones.find(goal => !goal.firstCleared) ?? null;
    return {
      status: next ? 'in-progress' : 'complete',
      next,
      title: next ? `首次通关第${next.target}关` : '全部阶段目标已通关',
      // Existing stage rewards are explicitly claimed; do not promise an automatic first-clear grant.
      rewardText: next ? `阶段奖励${next.coins}金币${next.rewardRecorded ? '（已有领取记录）' : ''}` : '奖励领取记录以现有账本为准',
      milestones,
      unrecordedRewardTargets: milestones.filter(goal => goal.firstCleared && !goal.rewardRecorded).map(goal => goal.target),
      rewardsWithoutFirstClear: milestones.filter(goal => !goal.firstCleared && goal.rewardRecorded).map(goal => goal.target),
    };
  }
}
