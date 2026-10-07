import { THEME_BASKETS, themeForLevel } from './operationalLevels';
import { advanceLeaderboard, readLeaderboard, recordLeaderboardFirstClear, type LeaderboardConfig, type LeaderboardEntry, type LeaderboardState } from './leaderboard/leaderboard';
import { fresh, ordersFor, parseSave } from './progressSave';
import { claimDailyTask, completeDailyTasks, freshDailyTasks, recordDailyTime, recordDailyTool, type DailyTasksState, type DailyTimeReceipt } from './dailyTasks';
import { AD_BOOST_MS, FREE_BOOST_MS, type SpeedBudget, type SpeedLease } from './speedBoost';
import { advanceSocial, claimPartnerHelp, followPartner, helpPartner, interactPartner, markSocialRead, readSocial, requestPartnerHelp, socialNeedsAdvance, type SocialConfig, type SocialReadModel, type SocialState } from './social/social';

/** Product progression is independent of Cocos and the current puzzle board. */
export interface ProgressSavePort { readonly testOnly?: true; read(key: string): string | null; write(key: string, value: string): void }
export interface ProgressClock { now(): number }
export type ProgressMode = 'main' | 'daily';
export type SupplyTool = 'trowel' | 'compass';
export interface ProgressRound {
  id: string; levelId: number; mode: ProgressMode; contentVersion: string;
  day: string; weekend: string; season: string; startedAt: number; completedAt?: number;
  settled: boolean; result?: 'SUCCESS' | 'FAIL'; firstClear: boolean;
  extraSupply: boolean; toolsUsed: string[];
}
export interface DailyOrder { kind: 'wins' | 'transport' | 'challenge' | 'build'; target: number; progress: number }
export interface ProgressReward { coins?: number; diamonds?: number; stamps?: number; vouchers?: number; supplyTokens?: number; decoration?: string }
export interface ProgressPeriod { points: number; claimed: number[] }
export interface PlayerProgressSnapshot {
  version: 6; coins: number; diamonds: number; starterDiamondsClaimed: boolean; stars: number; stamps: number; vouchers: number; supplyTokens: number;
  clearedLevels: number[]; stalls: number[]; districts: number[]; decorations: string[]; collections: string[];
  signInCount: number; signInDays: string[]; newcomer: number[]; achievements: string[];
  equippedDecorations: string[]; adDays: Record<string, { clears: number; supplies: number }>;
  createdAt: number; activeDays: string[]; sessionCount: number; firstBuildAt: number | null;
  streak: number; totals: { wins: number; validWins: number; failures: number; transported: number; challenges: number; builds: number; orders: number; events: number };
  daily: { day: string; orders: DailyOrder[]; rerolled: boolean; claimed: boolean; adClears: number; adSupplies: number; boostRemainingMs: number; boostAds: number; tasks: DailyTasksState };
  dailyCompleted: string[]; weekends: Record<string, ProgressPeriod>; seasons: Record<string, ProgressPeriod>;
  returnVisit: { id: string; baseline: number; claimed: number[] } | null;
  rounds: Record<string, ProgressRound>; rewardLedger: string[]; nextRound: number;
  lastSeen: number; maxTime: number; clockRolledBack: boolean; tutorialDays: Record<string, string>;
  pendingMessages: string[];
  leaderboard: LeaderboardState;
  social: SocialState;
}
export interface Settlement { duplicate: boolean; firstClear: boolean; coins: number; stars: number }
export interface ProgressAvailability { construction: boolean; daily: boolean; orders: boolean; challenge: boolean; collection: boolean; events: boolean }
export interface ThemeCollectionItem { id: string; name: string; kind: 'stall' | 'produce' | 'decoration'; count: number; target: number; iconPath: string; boardPath: string }
export interface ThemeBasketProgress { themeIndex: number; themeId: string; name: string; unlocked: boolean; cleared: number; items: ThemeCollectionItem[] }
export const PROGRESS_SAVE_KEY = 'colony.player.v1';
export const PROGRESS_BACKUP_KEY = `${PROGRESS_SAVE_KEY}.backup`;
export const PROGRESS_CONTENT_VERSION = 'night-market-1';
export const MAIN_LEVEL_COUNT = 60;
export const DAILY_CHALLENGE_COUNT = 30;
export const SEASON_XP_PER_TIER = 100;
export const STARTER_DIAMONDS = 30;
/** Permanent campaign milestones; daily tasks, replays and elapsed time do not advance them. */
export const STAGE_GOALS = [
  { id: '6', name: '搬运起步', target: 6, coins: 20 },
  { id: '18', name: '配送进阶', target: 18, coins: 30 },
  { id: '30', name: '路线熟练', target: 30, coins: 40 },
  { id: '42', name: '节奏掌握', target: 42, coins: 50 },
  { id: '54', name: '夜市远行', target: 54, coins: 60 },
  { id: '60', name: '本期完成', target: 60, coins: 80 },
] as const;
export interface StageGoalProgress { id: string; name: string; target: number; coins: number; progress: number; claimed: boolean }
export const EXTRA_SUPPLY_DIAMOND_PRICE = 10;
const DAY = 86400000;
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const validTime = (value: unknown): value is number => integer(value) && value <= Date.UTC(9999, 11, 31, 15, 59, 59, 999);
// Fixed local operating calendar: 2026-09-21 00:00 Beijing; each following season lasts 28 days.
export const PROGRESS_CALENDAR_START = Date.UTC(2026, 8, 20, 16);
export const WEEKEND_THRESHOLDS = [3, 8, 15];
export const COLLECTIONS = [
  { id: 'lantern', name: '灯笼印记', cost: 3 }, { id: 'snack', name: '补给印记', cost: 5 },
  { id: 'street', name: '街区印记', cost: 8 }, { id: 'night', name: '夜市印记', cost: 12 },
] as const;
export const ACHIEVEMENTS = [
  { id: 'clear-1', name: '首次配送', kind: 'wins', target: 1, coins: 20 },
  { id: 'clear-20', name: '街区配送员', kind: 'wins', target: 20, coins: 100 },
  { id: 'clear-60', name: '夜市配送员', kind: 'wins', target: 60, coins: 200 },
  { id: 'build-3', name: '收集起步', kind: 'wins', target: 3, coins: 60 },
  { id: 'build-12', name: '首摊集齐', kind: 'wins', target: 12, coins: 120 },
  { id: 'cargo-1000', name: '千次搬运', kind: 'transported', target: 1000, coins: 100 },
  { id: 'daily-7', name: '挑战常客', kind: 'challenges', target: 7, coins: 100 },
] as const;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const dayOf = (time: number): string => new Date(time + 8 * 3600000).toISOString().slice(0, 10);
const dayStart = (day: string): number => Date.parse(`${day}T00:00:00+08:00`);
const challengeIndex = (day: string): number => ((Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY) % DAILY_CHALLENGE_COUNT) + DAILY_CHALLENGE_COUNT) % DAILY_CHALLENGE_COUNT;
function periods(time: number): { day: string; weekend: string; season: string; weekendEnd: number; seasonEnd: number } {
  const day = dayOf(time);
  const mondayOffset = (new Date(time + 8 * 3600000).getUTCDay() + 6) % 7;
  const monday = dayStart(day) - mondayOffset * DAY;
  const weekend = mondayOffset >= 4 ? dayOf(monday + 4 * DAY) : '';
  const seasonIndex = Math.floor((time - PROGRESS_CALENDAR_START) / (28 * DAY));
  return { day, weekend, season: seasonIndex < 0 ? '' : dayOf(PROGRESS_CALENDAR_START + seasonIndex * 28 * DAY),
    weekendEnd: monday + 7 * DAY, seasonEnd: PROGRESS_CALENDAR_START + (seasonIndex + 1) * 28 * DAY };
}
/** Collection display is derived from first clears; no second inventory or save migration is needed. */
export function readThemeCollections(cleared: readonly number[]): ThemeBasketProgress[] {
  return THEME_BASKETS.map((theme, themeIndex) => {
    const counts = theme.items.map(() => 0);
    let completed = 0;
    for (const levelId of cleared) {
      const target = themeForLevel(levelId);
      if (target?.themeIndex !== themeIndex) continue;
      counts[target.itemIndex]++;
      completed++;
    }
    return { themeIndex, themeId: theme.id, name: theme.name, unlocked: cleared.length >= themeIndex * 12,
      cleared: completed, items: theme.items.map((item, itemIndex) => ({ ...item, count: counts[itemIndex]! })) };
  });
}

export class PlayerProgress {
  private data: PlayerProgressSnapshot;
  private persisted: string;
  public readonly recoveredBackup: boolean;
  public constructor(private readonly save: ProgressSavePort, private readonly clock: ProgressClock, private readonly leaderboardConfig: LeaderboardConfig, private readonly socialConfig: SocialConfig) {
    const primary = save.read(PROGRESS_SAVE_KEY);
    const backup = save.read(PROGRESS_BACKUP_KEY);
    const now = this.now();
    const current = parseSave(primary, leaderboardConfig, socialConfig, now);
    const recovered = current ? null : parseSave(backup, leaderboardConfig, socialConfig, now);
    if (!current && !recovered && (primary !== null || backup !== null)) throw new Error('存档损坏，备份也无法恢复。已保留原始数据，请勿清除存储。');
    this.recoveredBackup = recovered !== null;
    this.data = current ?? recovered ?? fresh(now, leaderboardConfig);
    this.persisted = current ? primary! : recovered ? backup! : JSON.stringify(this.data);
    this.change(s => {
      const now = this.now();
      s.sessionCount++;
      if (!s.clockRolledBack) advanceLeaderboard(s.leaderboard, s.clearedLevels.length, Math.max(now, s.maxTime), this.leaderboardConfig, s.social.follows.map(bot => bot.name));
      if (now >= s.lastSeen + 7 * DAY && (!s.returnVisit || s.returnVisit.claimed.length === 3)) {
        s.returnVisit = { id: dayOf(now), baseline: s.totals.validWins, claimed: [] };
      }
      if (this.recoveredBackup) s.pendingMessages.push('已从备份恢复进度');
    });
  }
  private now(): number {
    const value = this.clock.now();
    if (!validTime(value)) throw new Error('无效时间');
    return value;
  }
  private change<T>(action: (s: PlayerProgressSnapshot) => T): T {
    const next = clone(this.data);
    const now = this.now();
    next.clockRolledBack = now + 60000 < next.maxTime;
    next.maxTime = Math.max(next.maxTime, now);
    const effective = Math.max(now, next.maxTime);
    const day = dayOf(effective);
    if (!next.activeDays.includes(day)) next.activeDays.push(day);
    if (day !== next.daily.day) next.daily = { day, orders: ordersFor(day, next.clearedLevels.length >= 10), rerolled: false, claimed: false, adClears: 0, adSupplies: 0, boostRemainingMs: FREE_BOOST_MS, boostAds: 0, tasks: freshDailyTasks() };
    this.collectExpired(next, effective);
    if (!next.clockRolledBack && next.clearedLevels.length >= this.socialConfig.unlockClears) advanceSocial(next.social, next.leaderboard, effective, this.socialConfig);
    const result = action(next);
    if (!next.clockRolledBack && next.clearedLevels.length >= this.socialConfig.unlockClears) advanceSocial(next.social, next.leaderboard, effective, this.socialConfig);
    next.lastSeen = Math.max(next.lastSeen, now);
    const encoded = JSON.stringify(next);
    // A failed primary write leaves the in-memory transaction uncommitted and the prior save recoverable.
    this.save.write(PROGRESS_BACKUP_KEY, this.persisted);
    this.save.write(PROGRESS_SAVE_KEY, encoded);
    this.data = next;
    this.persisted = encoded;
    return result;
  }
  public flushCurrent(): void { this.change(() => undefined); }
  public snapshot(): PlayerProgressSnapshot {
    const now = this.now();
    if (dayOf(Math.max(now, this.data.maxTime)) !== this.data.daily.day || (now + 60000 < this.data.maxTime) !== this.data.clockRolledBack) this.change(() => undefined);
    return clone(this.data);
  }
  /** Test memory ports alone can use GM grants; live storage never receives this capability. */
  public applyTestResources(kind: 'coins' | 'diamonds' | 'speed'): void {
    if (this.save.testOnly !== true) throw new Error('GM requires an isolated test profile');
    this.change(s => {
      if (kind === 'coins') s.coins += 1000;
      else if (kind === 'diamonds') s.diamonds += 100;
      else if (kind === 'speed') s.daily.boostRemainingMs = Math.max(s.daily.boostRemainingMs, FREE_BOOST_MS);
      else throw new Error('Invalid GM resource');
    });
  }
  public availability(): ProgressAvailability {
    const n = this.data.clearedLevels.length;
    return { construction: n >= 1, daily: n >= 3, orders: n >= 5, challenge: n >= 10, collection: n >= 15, events: n >= 20 };
  }
  public nextLevel(): number { return Math.min(MAIN_LEVEL_COUNT, this.data.clearedLevels.length + 1); }
  public readSpeedBoost(): SpeedBudget {
    const now = this.now();
    if (dayOf(Math.max(now, this.data.maxTime)) !== this.data.daily.day || (now + 60000 < this.data.maxTime) !== this.data.clockRolledBack) this.change(() => undefined);
    return { day: this.data.daily.day, remainingMs: this.data.daily.boostRemainingMs };
  }
  public reserveSpeedBoost(ms: number): SpeedLease {
    if (!integer(ms) || ms < 1 || ms > 1000) throw new Error('无效加速预留时长');
    return this.change(s => {
      const reserved = Math.min(ms, s.daily.boostRemainingMs);
      s.daily.boostRemainingMs -= reserved;
      return { day: s.daily.day, ms: reserved };
    });
  }
  public refundSpeedBoost(day: string, ms: number): void {
    if (!integer(ms) || ms > 1000) throw new Error('无效加速返还时长');
    if (!ms || this.readSpeedBoost().day !== day) return;
    this.change(s => { if (s.daily.day === day) s.daily.boostRemainingMs += ms; });
  }
  /** Only the completed rewarded-video callback may call this transaction. */
  public grantSpeedBoostReward(rewardId: string): boolean {
    return this.change(s => {
      if (!rewardId) throw new Error('广告领取无效');
      const id = `ad-speed:${rewardId}`;
      if (s.rewardLedger.includes(id)) return false;
      if (s.clockRolledBack || !Number.isSafeInteger(s.daily.boostRemainingMs + AD_BOOST_MS)) throw new Error('当前无法领取加速时间');
      s.daily.boostRemainingMs += AD_BOOST_MS;
      s.daily.boostAds++;
      s.rewardLedger.push(id);
      return true;
    });
  }
  public readLeaderboard(): LeaderboardEntry[] { return readLeaderboard(this.data.leaderboard, this.data.clearedLevels.length, this.leaderboardConfig); }
  public socialAvailable(): boolean { return this.data.clearedLevels.length >= this.socialConfig.unlockClears; }
  public socialCanInteract(): boolean { return this.socialAvailable() && this.now() + 60000 >= this.data.maxTime; }
  public readSocial(): SocialReadModel { return readSocial(this.data.social, this.data.leaderboard); }
  public advanceSocial(): boolean {
    const now = this.now();
    if (!this.socialAvailable() || now + 60000 < this.data.maxTime || !socialNeedsAdvance(this.data.social, now)) return false;
    this.change(() => undefined); return true;
  }
  private socialAllowed(s: PlayerProgressSnapshot): void {
    this.timeAllowed(s);
    if (s.clearedLevels.length < this.socialConfig.unlockClears) throw new Error('第3关后开放虚拟伙伴');
  }
  public followPartner(id: string, followed: boolean): void {
    this.change(s => { this.socialAllowed(s); followPartner(s.social, s.leaderboard, id, followed, this.socialConfig); });
  }
  public interactPartner(id: string, kind: 'visit' | 'like' | 'comment', messageIndex = 0): boolean {
    return this.change(s => { this.socialAllowed(s); return interactPartner(s.social, s.leaderboard, id, kind, this.now(), this.socialConfig, messageIndex); });
  }
  public helpPartner(requestId: number): boolean {
    return this.change(s => {
      this.socialAllowed(s); const id = helpPartner(s.social, requestId, this.now(), this.socialConfig);
      if (id === null) return false;
      this.reward(s, `social-help:${id}`, { coins: this.socialConfig.helpCoins }); return true;
    });
  }
  public requestPartnerHelp(id: string): void {
    this.change(s => { this.socialAllowed(s); requestPartnerHelp(s.social, s.leaderboard, id, this.now(), this.socialConfig); });
  }
  public claimPartnerHelp(): void {
    this.change(s => { this.socialAllowed(s); const id = claimPartnerHelp(s.social); this.reward(s, `social-aid:${id}`, { supplyTokens: 1 }); });
  }
  public markSocialRead(): void {
    if (this.socialCanInteract() && this.readSocial().unread) this.change(s => { this.socialAllowed(s); markSocialRead(s.social); });
  }
  /** Derived from permanent first clears, so legacy saves and replayed rounds share one source of truth. */
  public themeBasketProgress(): ThemeBasketProgress[] { return readThemeCollections(this.snapshot().clearedLevels); }
  public dailyChallengeIndex(): number { return challengeIndex(this.snapshot().daily.day); }
  public calendar(): { day: string; weekend: string; season: string; weekendEnd: number; seasonEnd: number } { return periods(Math.max(this.now(), this.data.maxTime)); }
  public startRound(levelId: number, mode: ProgressMode = 'main'): ProgressRound {
    return this.change(s => {
      if (!integer(levelId) || levelId < 1 || levelId > (mode === 'main' ? MAIN_LEVEL_COUNT : DAILY_CHALLENGE_COUNT)) throw new Error('关卡不存在');
      if (mode === 'main' && levelId > s.clearedLevels.length + 1 && this.save.testOnly !== true) throw new Error('请先完成前一关');
      if (mode === 'daily' && s.clearedLevels.length < 10) throw new Error('第10关后开放每日挑战');
      const p = periods(Math.max(this.now(), s.maxTime));
      if (mode === 'daily' && levelId !== challengeIndex(p.day) + 1) throw new Error('请使用今日挑战棋盘');
      const id = `round-${s.nextRound++}`;
      const round: ProgressRound = { id, levelId, mode, contentVersion: PROGRESS_CONTENT_VERSION, day: p.day,
        weekend: s.clearedLevels.length >= 20 && !s.clockRolledBack ? p.weekend : '', season: s.clearedLevels.length >= 20 && !s.clockRolledBack ? p.season : '',
        startedAt: this.now(), settled: false, firstClear: false, extraSupply: false, toolsUsed: [] };
      s.rounds[id] = round;
      return clone(round);
    });
  }
  public settleRound(roundId: string, result: 'SUCCESS' | 'FAIL', transported: number, toolsUsed: string[] = []): Settlement {
    return this.change(s => {
      const round = s.rounds[roundId];
      if (!round) throw new Error('对局不存在');
      if (round.settled) return { duplicate: true, firstClear: false, coins: 0, stars: 0 };
      if (round.contentVersion !== PROGRESS_CONTENT_VERSION) throw new Error('对局内容版本不匹配，已保留待结算记录');
      if (!integer(transported) || !['SUCCESS', 'FAIL'].includes(result)) throw new Error('无效结算');
      round.settled = true; round.result = result; round.toolsUsed = [...new Set([...round.toolsUsed, ...toolsUsed])]; round.completedAt = Math.max(this.now(), round.startedAt);
      s.totals.transported += transported;
      if (round.day === s.daily.day && !s.clockRolledBack) this.orderProgress(s, 'transport', transported);
      if (result === 'FAIL') { s.totals.failures++; if (round.mode === 'main') s.streak = 0; return { duplicate: false, firstClear: false, coins: 0, stars: 0 }; }
      s.totals.validWins++;
      if (!s.clockRolledBack) {
        s.daily.tasks.wins = Math.min(5, s.daily.tasks.wins + 1); completeDailyTasks(s, periods(s.maxTime).season);
      }
      // Replays can fulfill ordinary orders even when all main content is complete.
      if (round.day === s.daily.day && !s.clockRolledBack) this.orderProgress(s, 'wins', 1);
      const eligible = round.mode === 'main' ? !s.clearedLevels.includes(round.levelId) : !s.dailyCompleted.includes(round.day) && !s.clockRolledBack;
      if (!eligible) return { duplicate: false, firstClear: false, coins: 0, stars: 0 };
      round.firstClear = true;
      let coins = 40;
      const stars = 0;
      if (round.mode === 'main') {
        recordLeaderboardFirstClear(s.leaderboard, s.clearedLevels.length, Math.max(round.completedAt!, s.maxTime), this.leaderboardConfig);
        s.clearedLevels.push(round.levelId); s.clearedLevels.sort((a, b) => a - b); s.totals.wins++;
        completeDailyTasks(s, periods(s.maxTime).season);
        if (round.levelId >= 6) { s.streak++; coins += ({ 3: 20, 5: 40, 8: 80 } as Record<number, number>)[s.streak] ?? 0; }
        if (round.levelId % 20 === 0) s.stamps += 3;
      } else { s.dailyCompleted.push(round.day); s.totals.challenges++; }
      this.reward(s, `clear:${round.mode}:${round.mode === 'main' ? round.levelId : round.day}`, { coins }); s.stars += stars;
      if (round.day === s.daily.day && !s.clockRolledBack) {
        if (round.mode === 'daily') this.orderProgress(s, 'challenge', 1);
      }
      if (round.weekend) this.period(s.weekends, round.weekend).points += round.mode === 'daily' ? 5 : 1;
      if (round.season) this.period(s.seasons, round.season).points += round.mode === 'daily' ? 70 : 40;
      this.collectExpired(s, Math.max(this.now(), s.maxTime));
      return { duplicate: false, firstClear: true, coins, stars };
    });
  }
  private orderProgress(s: PlayerProgressSnapshot, kind: DailyOrder['kind'], amount: number): void {
    if (s.clearedLevels.length < 5) return;
    for (const o of s.daily.orders) if (o.kind === kind) o.progress = Math.min(o.target, o.progress + amount);
  }
  private reward(s: PlayerProgressSnapshot, id: string, reward: ProgressReward): boolean {
    if (s.rewardLedger.includes(id)) return false;
    s.rewardLedger.push(id); s.coins += reward.coins ?? 0; s.diamonds += reward.diamonds ?? 0; s.stamps += reward.stamps ?? 0; s.vouchers += reward.vouchers ?? 0; s.supplyTokens += reward.supplyTokens ?? 0;
    if (reward.decoration && !s.decorations.includes(reward.decoration)) s.decorations.push(reward.decoration);
    return true;
  }
  private timeAllowed(s: PlayerProgressSnapshot): void { if (s.clockRolledBack) throw new Error('检测到时间回退，请恢复正确时间后领取每日奖励'); }
  public build(_stallIndex: number): void { throw new Error('摊位与装饰改为关卡收集，不再消耗建设星'); }
  public finishDistrict(_district: number): void { throw new Error('主题集齐后自动完成，不再消耗建设星'); }
  public claimSignIn(): ProgressReward {
    return this.change(s => {
      this.timeAllowed(s);
      if (s.clearedLevels.length < 3) throw new Error('第3关后开放签到');
      if (s.signInDays.includes(s.daily.day)) throw new Error('今日已签到');
      const tier = s.signInCount % 7;
      const reward = { coins: [20, 30, 30, 40, 40, 50, 60][tier], vouchers: tier === 6 ? 1 : 0 };
      this.reward(s, `signin:${s.daily.day}`, reward); s.signInDays.push(s.daily.day); s.signInCount++;
      return reward;
    });
  }
  public recordDailyTool(roundId: string, tool: string, occurredAt = this.now()): void {
    this.change(s => {
      recordDailyTool(s, roundId, tool, occurredAt);
      const round = s.rounds[roundId]!;
      if (occurredAt >= round.startedAt && !round.toolsUsed.includes(tool)) round.toolsUsed.push(tool);
      completeDailyTasks(s, periods(s.maxTime).season);
    });
  }
  public recordDailyTime(receipt: DailyTimeReceipt): void { this.change(s => { recordDailyTime(s, receipt); completeDailyTasks(s, periods(s.maxTime).season); }); }
  public claimDailyTask(id: string): void { this.change(s => claimDailyTask(s, id, periods(s.maxTime).season)); }
  public readStageGoals(): StageGoalProgress[] {
    return STAGE_GOALS.map(goal => ({ ...goal, progress: Math.min(this.data.clearedLevels.length, goal.target),
      claimed: this.data.rewardLedger.includes(`stage-goal:${goal.id}`) }));
  }
  public claimStageGoal(id: string): void {
    this.change(s => {
      const goal = STAGE_GOALS.find(item => item.id === id);
      if (!goal || s.clearedLevels.length < goal.target || s.rewardLedger.includes(`stage-goal:${id}`)) throw new Error('阶段目标未完成或奖励已领取');
      if (!Number.isSafeInteger(s.coins + goal.coins)) throw new Error('金币数量超出范围');
      this.reward(s, `stage-goal:${id}`, { coins: goal.coins });
    });
  }
  public newcomerProgress(index: number): { name: string; progress: number; target: number } {
    const s = this.data;
    const entries = [
      { name: '完成3次主线配送', progress: s.totals.wins, target: 3 },
      { name: '收集3件摊位物品', progress: s.clearedLevels.length, target: 3 },
      { name: '完成1组每日订单', progress: s.totals.orders, target: 1 },
      { name: '兑换1件收藏', progress: s.collections.length, target: 1 },
      { name: '完成1次每日挑战', progress: s.totals.challenges, target: 1 },
      { name: '领取1次活动奖励', progress: s.totals.events, target: 1 },
      { name: '集齐首个主题摊位', progress: s.clearedLevels.length >= 12 ? 1 : 0, target: 1 },
    ];
    if (!integer(index) || !entries[index]) throw new Error('目标不存在');
    return entries[index];
  }
  public claimNewcomer(index: number): void {
    const goal = this.newcomerProgress(index);
    this.change(s => {
      if (s.clearedLevels.length < 3 || s.newcomer.includes(index) || goal.progress < goal.target) throw new Error('目标尚未完成或已领取');
      this.reward(s, `newcomer:${index}`, { coins: 50, stamps: index === 2 ? 3 : 0 }); s.newcomer.push(index);
    });
  }
  public claimAchievement(id: string): void {
    this.change(s => {
      const goal = ACHIEVEMENTS.find(item => item.id === id);
      if (!goal || s.totals[goal.kind] < goal.target || s.achievements.includes(id)) throw new Error('成就尚未完成或已领取');
      this.reward(s, `achievement:${id}`, { coins: goal.coins }); s.achievements.push(id);
    });
  }
  public redeemCollection(id: string): void {
    this.change(s => {
      const item = COLLECTIONS.find(item => item.id === id);
      if (s.clearedLevels.length < 15 || !item || s.collections.includes(id) || s.stamps < item.cost) throw new Error('无法兑换此收藏');
      s.stamps -= item.cost; s.collections.push(id);
    });
  }
  public redeemDecoration(_stallIndex: number): void { throw new Error('装饰改为关卡收集，不再兑换'); }
  public equipDecoration(_stallIndex: number, _variant: 'base' | 'lantern' | 'season'): void { throw new Error('收集物自动展示，无需更换装饰'); }
  private period(table: Record<string, ProgressPeriod>, key: string): ProgressPeriod { return table[key] ?? (table[key] = { points: 0, claimed: [] }); }
  private weekendReward(tier: number): ProgressReward { return [{ coins: 60 }, { coins: 100, stamps: 1 }, { stamps: 2, vouchers: 1 }][tier]; }
  private seasonReward(tier: number): ProgressReward { return tier === 30 ? { decoration: 'season-lantern', stamps: 3 } : tier % 5 === 0 ? { stamps: 1 } : { coins: 30 }; }
  public claimWeekend(tier: number): void {
    this.change(s => {
      this.timeAllowed(s); const key = periods(Math.max(this.now(), s.maxTime)).weekend;
      if (!key || !integer(tier) || tier > 2 || !s.weekends[key] || s.weekends[key].points < WEEKEND_THRESHOLDS[tier] || s.weekends[key].claimed.includes(tier)) throw new Error('活动奖励尚不可领取');
      this.reward(s, `weekend:${key}:${tier}`, this.weekendReward(tier)); s.weekends[key].claimed.push(tier); s.totals.events++;
    });
  }
  public claimSeason(tier: number): void {
    this.change(s => {
      this.timeAllowed(s); const key = periods(Math.max(this.now(), s.maxTime)).season;
      if (!key || !integer(tier) || tier < 1 || tier > 30 || !s.seasons[key] || s.seasons[key].points < tier * SEASON_XP_PER_TIER || s.seasons[key].claimed.includes(tier)) throw new Error('赛季奖励尚不可领取');
      this.reward(s, `season:${key}:${tier}`, this.seasonReward(tier)); s.seasons[key].claimed.push(tier); s.totals.events++;
    });
  }
  private collectExpired(s: PlayerProgressSnapshot, now: number): void {
    for (const [key, p] of Object.entries(s.weekends)) if (now >= dayStart(key) + 3 * DAY) {
      for (let tier = 0; tier < 3; tier++) if (p.points >= WEEKEND_THRESHOLDS[tier] && !p.claimed.includes(tier)) {
        this.reward(s, `weekend:${key}:${tier}`, this.weekendReward(tier)); p.claimed.push(tier); s.totals.events++; s.pendingMessages.push('已补发周末补给节奖励');
      }
    }
    for (const [key, p] of Object.entries(s.seasons)) if (now >= dayStart(key) + 28 * DAY) {
      for (let tier = 1; tier <= Math.min(30, Math.floor(p.points / SEASON_XP_PER_TIER)); tier++) if (!p.claimed.includes(tier)) {
        this.reward(s, `season:${key}:${tier}`, this.seasonReward(tier)); p.claimed.push(tier); s.totals.events++; s.pendingMessages.push('已补发夜市季奖励');
      }
    }
  }
  public claimReturn(index: number): void {
    this.change(s => {
      const visit = s.returnVisit;
      if (!visit || !integer(index) || index > 2 || visit.claimed.includes(index) || s.totals.validWins - visit.baseline < [1, 3, 5][index]) throw new Error('回归任务尚未完成或已领取');
      this.reward(s, `return:${visit.id}:${index}`, { coins: [40, 60, 80][index], supplyTokens: 1 }); visit.claimed.push(index);
    });
  }
  public buyExtraSupply(roundId: string, tool: SupplyTool, payment: 'token' | 'diamond'): void {
    this.change(s => {
      const round = this.supplyRound(s, roundId, tool);
      if (payment === 'token') {
        if (s.supplyTokens < 1) throw new Error('补给券不足');
        s.supplyTokens--;
      } else {
        if (s.diamonds < EXTRA_SUPPLY_DIAMOND_PRICE) throw new Error('钻石不足');
        s.diamonds -= EXTRA_SUPPLY_DIAMOND_PRICE;
      }
      round.extraSupply = true;
    });
  }
  public claimStarterDiamonds(): void {
    this.change(s => {
      if (s.starterDiamondsClaimed || s.rewardLedger.includes('starter-diamonds')) throw new Error('新老玩家钻石礼包已领取');
      this.reward(s, 'starter-diamonds', { diamonds: STARTER_DIAMONDS });
      s.starterDiamondsClaimed = true;
    });
  }
  private supplyRound(s: PlayerProgressSnapshot, roundId: string, tool: SupplyTool): ProgressRound {
    const round = s.rounds[roundId];
    if (!round || round.settled || round.extraSupply || !['trowel', 'compass'].includes(tool)) throw new Error('本局无法领取额外补给');
    return round;
  }
  public adQuota(roundId: string): { day: string; clears: number; supplies: number } | null {
    const s = this.snapshot(); const round = s.rounds[roundId];
    return round ? { day: round.day, ...(s.adDays[round.day] ?? { clears: 0, supplies: 0 }) } : null;
  }
  public isAdEligible(roundId: string, placement: 'clear' | 'supply'): boolean {
    const s = this.snapshot(); const round = s.rounds[roundId];
    if (!round || s.clockRolledBack || round.contentVersion !== PROGRESS_CONTENT_VERSION) return false;
    const quota = s.adDays[round.day] ?? { clears: 0, supplies: 0 };
    return placement === 'clear'
      ? round.settled && round.firstClear && round.result === 'SUCCESS' && quota.clears < 5 && !s.rewardLedger.includes(`ad-clear:${roundId}`)
      : !round.settled && !round.extraSupply && quota.supplies < 3;
  }
  /** Invoke only after the platform confirms the complete rewarded video. */
  public grantAdReward(rewardId: string, roundId: string, placement: 'clear' | 'supply', tool?: SupplyTool): boolean {
    return this.change(s => {
      const id = `ad:${rewardId}`;
      if (s.rewardLedger.includes(id)) return false;
      const round = s.rounds[roundId];
      if (!round || !rewardId) throw new Error('广告领取无效');
      const quota = s.adDays[round.day] ?? (s.adDays[round.day] = { clears: 0, supplies: 0 });
      if (placement === 'clear') {
        if (!round.settled || !round.firstClear || round.result !== 'SUCCESS' || quota.clears >= 5 || s.rewardLedger.includes(`ad-clear:${roundId}`)) throw new Error('无法领取通关广告奖励');
        this.reward(s, id, { coins: 40 }); s.rewardLedger.push(`ad-clear:${roundId}`); quota.clears++;
      } else {
        if (quota.supplies >= 3 || !tool) throw new Error('今日补给次数已用完');
        this.supplyRound(s, roundId, tool).extraSupply = true; quota.supplies++; this.reward(s, id, {});
      }
      if (round.day === s.daily.day) { s.daily.adClears = quota.clears; s.daily.adSupplies = quota.supplies; }
      return true;
    });
  }
  /** Returns one eligible tutorial at most per Beijing day; UI can present it without popup chains. */
  public takeTutorial(): string | null {
    return this.change(s => {
      const day = s.daily.day;
      if (Object.values(s.tutorialDays).includes(day)) return null;
      const choices: [string, number][] = [['construction', 1], ['daily', 3], ['orders', 5], ['challenge', 10], ['collection', 15], ['events', 20]];
      const choice = choices.find(([key, level]) => s.clearedLevels.length >= level && !s.tutorialDays[key]);
      if (!choice) return null;
      s.tutorialDays[choice[0]] = day; return choice[0];
    });
  }
  public acknowledgeMessages(): void { this.change(s => { s.pendingMessages = []; }); }
}
