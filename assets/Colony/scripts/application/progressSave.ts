import { createLeaderboard, isLeaderboardState, type LeaderboardConfig } from './leaderboard/leaderboard';
import { createSocial, isSocialState, type SocialConfig } from './social/social';
import type { PlayerProgressSnapshot, DailyOrder } from './playerProgress';
import { AD_BOOST_MS, FREE_BOOST_MS } from './speedBoost';
import { freshDailyTasks, isDailyTasks } from './dailyTasks';
import { collectionObject } from './collectionObject';
import { isPartnerDialogue } from './partnerDialogue';
import { isGuideProgress } from './guideProgress';

const DAY = 86400000;
const dayOf = (at: number): string => new Date(at + 8 * 3600000).toISOString().slice(0, 10);
const dayStart = (day: string): number => Date.parse(`${day}T00:00:00+08:00`);

export function ordersFor(day: string, challenge: boolean): DailyOrder[] {
  const variation = Math.floor(dayStart(day) / DAY) % 3;
  return [{ kind: 'wins', target: 3, progress: 0 }, { kind: 'transport', target: 60 + variation * 20, progress: 0 },
    { kind: challenge ? 'challenge' : 'wins', target: challenge ? 1 : 2, progress: 0 }];
}
export function fresh(now: number, config: LeaderboardConfig): PlayerProgressSnapshot {
  return { version: 6, coins: 0, diamonds: 0, starterDiamondsClaimed: false, stars: 0, stamps: 0, vouchers: 0, supplyTokens: 0, clearedLevels: [], stalls: Array<number>(12).fill(0),
    districts: [], decorations: [], collections: [], signInCount: 0, signInDays: [], newcomer: [], achievements: [], streak: 0,
    equippedDecorations: Array<string>(12).fill('base'), adDays: {},
    createdAt: now, activeDays: [], sessionCount: 0, firstBuildAt: null,
    totals: { wins: 0, validWins: 0, failures: 0, transported: 0, challenges: 0, builds: 0, orders: 0, events: 0 },
    daily: { day: dayOf(now), orders: ordersFor(dayOf(now), false), rerolled: false, claimed: false, adClears: 0, adSupplies: 0, boostRemainingMs: FREE_BOOST_MS, boostAds: 0, tasks: freshDailyTasks() },
    dailyCompleted: [], weekends: {}, seasons: {}, returnVisit: null, rounds: {}, rewardLedger: [], nextRound: 1,
    lastSeen: now, maxTime: now, clockRolledBack: false, tutorialDays: {}, pendingMessages: [], trackedObjectId: null, partnerDialogue: null, guide: { status: 'pending', segment: 0 }, toolInventory: { trowel: 0, compass: 0 }, toolTransactions: {}, social: createSocial(now), leaderboard: createLeaderboard(config, now, now, 0, now) };
}
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const validTime = (value: unknown): value is number => integer(value) && value <= Date.UTC(9999, 11, 31, 15, 59, 59, 999);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const numbers = (value: unknown, max: number): value is number[] => Array.isArray(value) && value.every(item => integer(item) && item <= max);
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const dateKey = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(dayStart(value)) && dayOf(dayStart(value)) === value;
export function parseSave(raw: string | null, config: LeaderboardConfig, socialConfig: SocialConfig, now: number): PlayerProgressSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!record(parsed) || parsed.version !== 6) return null;
    const s = parsed as unknown as PlayerProgressSnapshot;
    if (s.trackedObjectId === undefined) s.trackedObjectId = null;
    if (s.partnerDialogue === undefined) s.partnerDialogue = null;
    if (s.guide === undefined) s.guide = { status: 'pending', segment: 0 };
    if (!isGuideProgress(s.guide)) return null;
    if (s.trackedObjectId !== null && (typeof s.trackedObjectId !== 'string' || !collectionObject(s.trackedObjectId))) return null;
    // Existing v6 archives predate permanent tools; absent fields mean zero stock.
    if (s.toolInventory === undefined) s.toolInventory = { trowel: 0, compass: 0 };
    if (s.toolTransactions === undefined) s.toolTransactions = {};
    if (!record(s.toolInventory) || !integer(s.toolInventory.trowel) || !integer(s.toolInventory.compass)) return null;
    if (!record(s.toolTransactions) || !Object.entries(s.toolTransactions).every(([key, r]) => record(r)
      && /^(buy:[a-z0-9-]{1,80}|use:round-[1-9]\d*)$/.test(key) && ['trowel', 'compass'].includes(String(r.tool))
      && r.quantity === 1 && integer(r.coins) && (key.startsWith('buy:') ? r.kind === 'buy' && r.roundId === null
        : r.kind === 'use' && r.coins === 0 && r.roundId === key.slice(4)))) return null;
    if (typeof s.starterDiamondsClaimed !== 'boolean' || !['coins', 'diamonds', 'stars', 'stamps', 'vouchers', 'supplyTokens', 'signInCount', 'streak', 'nextRound', 'lastSeen', 'maxTime'].every(key => integer((s as unknown as Record<string, unknown>)[key])) || s.nextRound < 1) return null;
    if (!numbers(s.clearedLevels, 60) || s.clearedLevels.some((n, index) => n !== index + 1) || !numbers(s.stalls, 3) || s.stalls.length !== 12 || !numbers(s.districts, 2) || !numbers(s.newcomer, 6)) return null;
    if (![s.decorations, s.collections, s.signInDays, s.achievements, s.dailyCompleted, s.rewardLedger, s.pendingMessages].every(strings)) return null;
    if (!record(s.totals) || !['wins', 'validWins', 'failures', 'transported', 'challenges', 'builds', 'orders', 'events'].every(key => integer(s.totals[key as keyof typeof s.totals]))) return null;
    if (![s.createdAt, s.lastSeen, s.maxTime].every(validTime) || (s.firstBuildAt !== null && !validTime(s.firstBuildAt)) || !strings(s.activeDays) || !s.activeDays.every(dateKey) || !integer(s.sessionCount)) return null;
    if (!s.daily || !dateKey(s.daily.day) || typeof s.daily.rerolled !== 'boolean' || typeof s.daily.claimed !== 'boolean' || !integer(s.daily.adClears) || !integer(s.daily.adSupplies) || s.daily.adClears > 5 || s.daily.adSupplies > 3 || !Array.isArray(s.daily.orders) || s.daily.orders.length !== 3) return null;
    if (!s.daily.orders.every(o => ['wins', 'transport', 'challenge', 'build'].includes(o.kind) && integer(o.target) && o.target > 0 && integer(o.progress))) return null;
    if (![s.weekends, s.seasons].every(table => record(table) && Object.entries(table).every(([key, p]) => dateKey(key) && record(p) && integer(p.points) && numbers(p.claimed, 30)))) return null;
    if (!record(s.rounds) || !Object.entries(s.rounds).every(([key, r]) => record(r) && key === r.id && /^round-[1-9]\d*$/.test(key) && Number(key.slice(6)) < s.nextRound && integer(r.levelId) && r.levelId >= 1 && r.levelId <= (r.mode === 'main' ? 60 : 30) && ['main', 'daily'].includes(r.mode) && typeof r.contentVersion === 'string' && r.contentVersion.length > 0 && dateKey(r.day) && (r.weekend === '' || dateKey(r.weekend)) && (r.season === '' || dateKey(r.season)) && integer(r.startedAt) && typeof r.settled === 'boolean' && (r.settled ? ['SUCCESS', 'FAIL'].includes(r.result ?? '') : r.result === undefined) && typeof r.firstClear === 'boolean' && typeof r.extraSupply === 'boolean' && strings(r.toolsUsed))) return null;
    if (!Object.values(s.rounds).every(r => validTime(r.startedAt) && (r.settled ? validTime(r.completedAt) : r.completedAt === undefined))) return null;
    if (!strings(s.equippedDecorations) || s.equippedDecorations.length !== 12 || !s.equippedDecorations.every(v => ['base', 'lantern', 'season'].includes(v)) || !record(s.adDays) || !Object.entries(s.adDays).every(([key, v]) => dateKey(key) && record(v) && integer(v.clears) && v.clears <= 5 && integer(v.supplies) && v.supplies <= 3)) return null;
    if (s.returnVisit !== null && (!s.returnVisit || typeof s.returnVisit.id !== 'string' || !integer(s.returnVisit.baseline) || !numbers(s.returnVisit.claimed, 2))) return null;
    if (typeof s.clockRolledBack !== 'boolean' || !record(s.tutorialDays) || !Object.values(s.tutorialDays).every(dateKey) || !s.dailyCompleted.every(dateKey) || !s.signInDays.every(dateKey)) return null;
    if (!isLeaderboardState(s.leaderboard, config, s.maxTime)) return null;
    if (s.partnerDialogue !== null && !isPartnerDialogue(s.partnerDialogue, s.leaderboard.nextId, config.avatarColors.length)) return null;
    if (!isSocialState(s.social, socialConfig, s.leaderboard, config.avatarColors.length, s.maxTime)) return null;
    if (!integer(s.daily.boostRemainingMs) || !integer(s.daily.boostAds) || !Number.isSafeInteger(FREE_BOOST_MS + AD_BOOST_MS * s.daily.boostAds) || s.daily.boostRemainingMs > FREE_BOOST_MS + AD_BOOST_MS * s.daily.boostAds) return null;
    if (!isDailyTasks(s.daily.tasks)) return null;
    s.version = 6;
    return s;
  } catch { return null; }
}
