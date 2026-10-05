import { createChallengePool, createOperationalCatalog } from '../application/operationalLevels';
import { PlayerProgress, type ProgressSavePort } from '../application/playerProgress';
import type { LeaderboardConfig } from '../application/leaderboard/leaderboard';
import type { SocialConfig } from '../application/social/social';
import { DAILY_TASKS } from '../application/dailyTasks';

/** UI-only QA profile. Commands populate isolated memory; no real player save is read or written. */
export function createProgressPreviewFixture(clearedLevels: number, dayKey: string, config: LeaderboardConfig, social: SocialConfig): PlayerProgress {
  return createProgressPreviewSession(clearedLevels, dayKey, config, social).progress;
}

export function createProgressPreviewSession(clearedLevels: number, dayKey: string, config: LeaderboardConfig, social: SocialConfig) {
  if (!Number.isInteger(clearedLevels) || clearedLevels < 0 || clearedLevels > 60) throw new Error('Preview level count must be 0–60');
  const day = Date.parse(`${dayKey}T12:00:00+08:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey) || !Number.isFinite(day)
    || new Date(day).toISOString().slice(0, 10) !== dayKey) throw new Error('Invalid Preview day');
  const memory = new Map<string, string>();
  const save: ProgressSavePort = {
    testOnly: true,
    read: (key) => memory.get(key) ?? null,
    write: (key, value) => { memory.set(key, value); },
  };
  let time = day;
  const clock = { now: () => time };
  let progress = new PlayerProgress(save, clock, config, social);
  const main = createOperationalCatalog();
  for (const level of main.levels.slice(0, clearedLevels)) {
    const round = progress.startRound(level.level);
    progress.settleRound(round.id, 'SUCCESS', level.cells.length);
  }
  if (clearedLevels === 60) {
    const toolRound = progress.startRound(1); progress.recordDailyTool(toolRound.id, 'slot');
    time += 900000; progress.recordDailyTime({ sequence: 1, startAt: day, endAt: time, onlineMs: 900000, boostMs: 120000 });
    for (const task of DAILY_TASKS) progress.claimDailyTask(task.id);
    for (const goal of [0, 1, 2]) progress.claimNewcomer(goal);
    progress.redeemCollection('lantern');

    // A later Friday exercises return tasks and a new weekend without changing the platform clock.
    time += 7 * 86400000;
    progress = new PlayerProgress(save, clock, config, social);
    const challenge = createChallengePool().levels[progress.dailyChallengeIndex()]!;
    const daily = progress.startRound(challenge.level, 'daily');
    progress.settleRound(daily.id, 'SUCCESS', challenge.cells.length);
    for (const level of main.levels.slice(0, 3)) {
      const replay = progress.startRound(level.level);
      progress.settleRound(replay.id, 'SUCCESS', level.cells.length);
    }
  }
  return { get progress() { return progress; }, advanceHours(hours: number) {
    if (!Number.isFinite(hours) || Math.abs(hours) > 8760) throw new Error('Invalid Preview hour offset');
    time += hours * 3600000; progress.advanceSocial(); return progress;
  }, restart(days = 0) {
    if (!Number.isInteger(days) || Math.abs(days) > 365) throw new Error('Invalid Preview day offset');
    time += days * 86400000;
    progress = new PlayerProgress(save, clock, config, social);
    return progress;
  } };
}
