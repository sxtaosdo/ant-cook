import type { PlayerProgressSnapshot } from './playerProgress';

export const DAILY_TASKS = [
  { id: 'win-1', name: '完成1关', kind: 'wins', target: 1, coins: 5 },
  { id: 'win-3', name: '完成3关', kind: 'wins', target: 3, coins: 10 },
  { id: 'win-5', name: '完成5关', kind: 'wins', target: 5, coins: 15 },
  { id: 'online-5', name: '在线5分钟', kind: 'onlineMs', target: 300000, coins: 5 },
  { id: 'online-15', name: '在线15分钟', kind: 'onlineMs', target: 900000, coins: 5 },
  { id: 'tool-1', name: '使用1个道具', kind: 'tools', target: 1, coins: 5 },
  { id: 'boost-60', name: '手动加速60秒', kind: 'boostMs', target: 60000, coins: 5 },
  { id: 'boost-120', name: '手动加速120秒', kind: 'boostMs', target: 120000, coins: 10 },
] as const;
export interface DailyTasksState {
  wins: number; onlineMs: number; tools: number; boostMs: number;
  claimed: string[]; toolEvents: string[]; timeReceipt: number;
  seasonClaimed: boolean;
}
export interface DailyTimeReceipt { sequence: number; startAt: number; endAt: number; onlineMs: number; boostMs: number }
export function freshDailyTasks(): DailyTasksState {
  return { wins: 0, onlineMs: 0, tools: 0, boostMs: 0, claimed: [], toolEvents: [], timeReceipt: 0, seasonClaimed: false };
}
export function isDailyTasks(value: unknown): value is DailyTasksState {
  if (!value || typeof value !== 'object') return false;
  const s = value as DailyTasksState;
  const integer = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
  return integer(s.wins) && s.wins <= 5 && integer(s.onlineMs) && s.onlineMs <= 900000
    && integer(s.tools) && s.tools <= 1 && integer(s.boostMs) && s.boostMs <= 120000
    && integer(s.timeReceipt) && typeof s.seasonClaimed === 'boolean'
    && Array.isArray(s.claimed) && new Set(s.claimed).size === s.claimed.length && s.claimed.every(id => DAILY_TASKS.some(t => t.id === id))
    && Array.isArray(s.toolEvents) && new Set(s.toolEvents).size === s.toolEvents.length
    && s.toolEvents.every(id => /^round-[1-9]\d*:(slot|trowel|compass)$/.test(id));
}
export function recordDailyTool(s: PlayerProgressSnapshot, roundId: string, tool: string, occurredAt: number): void {
  const round = s.rounds[roundId], state = s.daily.tasks;
  if (!round || !['slot', 'trowel', 'compass'].includes(tool) || !Number.isSafeInteger(occurredAt) || occurredAt < 0) throw new Error('无效道具记录');
  const id = `${roundId}:${tool}`;
  const day = new Date(occurredAt + 8 * 3600000).toISOString().slice(0, 10);
  if (s.clockRolledBack || occurredAt < round.startedAt || day !== s.daily.day || state.tools === 1 || state.toolEvents.includes(id)) return;
  state.toolEvents.push(id); state.tools = 1;
}
export function recordDailyTime(s: PlayerProgressSnapshot, receipt: DailyTimeReceipt): void {
  const { sequence, startAt, endAt, onlineMs, boostMs } = receipt, state = s.daily.tasks;
  if (![sequence, startAt, endAt, onlineMs, boostMs].every(n => Number.isSafeInteger(n) && n >= 0)
    || sequence < 1 || endAt < startAt || onlineMs > endAt - startAt || boostMs > onlineMs) throw new Error('无效任务计时');
  if (sequence <= state.timeReceipt) return;
  state.timeReceipt = sequence;
  if (s.clockRolledBack || endAt <= startAt) return;
  const dayStart = Date.parse(`${s.daily.day}T00:00:00+08:00`);
  const overlap = Math.max(0, Math.min(endAt, dayStart + 86400000) - Math.max(startAt, dayStart));
  const fraction = overlap / (endAt - startAt);
  state.onlineMs = Math.min(900000, state.onlineMs + Math.floor(onlineMs * fraction));
  state.boostMs = Math.min(120000, state.boostMs + Math.floor(boostMs * fraction));
}
function seasonReward(s: PlayerProgressSnapshot, season: string): void {
  const state = s.daily.tasks;
  if (!s.daily.claimed) { s.totals.orders++; s.daily.claimed = true; }
  if (state.seasonClaimed || s.clearedLevels.length < 20 || !season) return;
  state.seasonClaimed = true; (s.seasons[season] ??= { points: 0, claimed: [] }).points += 120;
}
export function claimDailyTask(s: PlayerProgressSnapshot, id: string, season: string): void {
  const state = s.daily.tasks;
  if (s.clockRolledBack || s.clearedLevels.length < 5) throw new Error('当前无法领取每日任务');
  const task = DAILY_TASKS.find(t => t.id === id);
  if (!task || state.claimed.includes(id) || state[task.kind] < task.target) throw new Error('任务未完成或奖励已领取');
  const rewardId = `daily-task:${s.daily.day}:${id}`;
  if (s.rewardLedger.includes(rewardId)) throw new Error('任务奖励已领取');
  state.claimed.push(id); s.rewardLedger.push(rewardId); s.coins += task.coins;
  if (DAILY_TASKS.every(t => state[t.kind] >= t.target)) seasonReward(s, season);
}
export function completeDailyTasks(s: PlayerProgressSnapshot, season: string): void {
  if (!s.clockRolledBack && DAILY_TASKS.every(t => s.daily.tasks[t.kind] >= t.target)) seasonReward(s, season);
}
