export interface LeaderboardConfig {
  opponentCount: number; maxLevel: number; initialExponent: number;
  turnoverDays: number; turnoverRatio: [number, number]; catchUpDays: number;
  highProgressThreshold: number; highProgressMultiplier: number;
  growth: { chance: number; minimum: number; maximum: number }[];
  avatarColors: string[]; nicknameStarts: string[]; nicknameEnds: string[];
}
export interface LeaderboardOpponent {
  id: string; name: string; avatar: number; pace: number; cleared: number; reachedAt: number;
}
export interface LeaderboardState {
  seed: number; nextId: number; opponents: LeaderboardOpponent[]; playerReachedAt: number;
  lastGrowthDay: string; lastTurnoverDay: string; updatedAt: number;
  previousRanks: Record<string, number>; newIds: string[];
}
export interface LeaderboardEntry {
  id: string; name: string; avatarColor: string; cleared: number; reachedAt: number;
  rank: number; change: number; isNew: boolean; isSelf: boolean;
}
const DAY = 86400000;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const time = (value: unknown): value is number => integer(value) && value <= Date.UTC(9999, 11, 31, 15, 59, 59, 999);
const dayOf = (value: number): string => new Date(value + 8 * 3600000).toISOString().slice(0, 10);
const dayStart = (day: string): number => Date.parse(`${day}T00:00:00+08:00`);
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(dayStart(value)) && dayOf(dayStart(value)) === value;
const probability = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const names = (config: LeaderboardConfig): string[] => config.nicknameStarts.flatMap(start => config.nicknameEnds.map(end => start + end));

/** Runtime and tests consume the same Bundle configuration. */
export function readLeaderboardConfig(value: unknown): LeaderboardConfig {
  if (!record(value) || value.opponentCount !== 50 || value.maxLevel !== 60
    || typeof value.initialExponent !== 'number' || !Number.isFinite(value.initialExponent) || value.initialExponent < 1
    || !integer(value.turnoverDays) || value.turnoverDays < 1 || !integer(value.catchUpDays) || value.catchUpDays < 1 || value.catchUpDays > 7
    || !integer(value.highProgressThreshold) || value.highProgressThreshold > 60 || !probability(value.highProgressMultiplier)
    || !Array.isArray(value.turnoverRatio) || value.turnoverRatio.length !== 2 || !value.turnoverRatio.every(probability)
    || value.turnoverRatio[0] > value.turnoverRatio[1] || Math.ceil(50 * value.turnoverRatio[0]) < 1 || Math.floor(50 * value.turnoverRatio[1]) > Math.ceil(50 / 3)
    || Math.ceil(50 * value.turnoverRatio[0]) > Math.floor(50 * value.turnoverRatio[1])
    || !Array.isArray(value.growth) || value.growth.length !== 3 || !value.growth.every(p => record(p) && probability(p.chance) && integer(p.minimum) && p.minimum >= 1 && integer(p.maximum) && p.maximum >= p.minimum && p.maximum <= 60)
    || !Array.isArray(value.avatarColors) || value.avatarColors.length < 3 || !value.avatarColors.every(v => typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v))
    || ![value.nicknameStarts, value.nicknameEnds].every(v => Array.isArray(v) && v.length > 0 && v.every(part => typeof part === 'string' && part.length > 0 && part.length <= 8))) {
    throw new Error('排行榜配置无效');
  }
  const config = value as unknown as LeaderboardConfig;
  const pool = names(config);
  if (new Set(pool).size !== pool.length || pool.length < config.opponentCount * 2 || pool.some(name => name.length > 12)) throw new Error('排行榜昵称配置无效');
  return config;
}

export function isLeaderboardState(value: unknown, config: LeaderboardConfig, maxTime: number): value is LeaderboardState {
  if (!record(value) || !integer(value.seed) || value.seed > 0xffffffff || !integer(value.nextId) || value.nextId < config.opponentCount
    || !time(value.playerReachedAt) || value.playerReachedAt > maxTime || !time(value.updatedAt) || value.updatedAt > maxTime
    || !date(value.lastGrowthDay) || !date(value.lastTurnoverDay) || value.lastTurnoverDay > value.lastGrowthDay || value.lastGrowthDay > dayOf(maxTime)
    || !Array.isArray(value.opponents) || value.opponents.length !== config.opponentCount
    || !value.opponents.every(bot => record(bot) && typeof bot.id === 'string' && /^bot-\d+$/.test(bot.id) && integer(Number(bot.id.slice(4))) && Number(bot.id.slice(4)) < (value.nextId as number)
      && typeof bot.name === 'string' && bot.name.length > 0 && bot.name.length <= 12 && integer(bot.avatar) && bot.avatar < config.avatarColors.length
      && integer(bot.pace) && bot.pace < config.growth.length && integer(bot.cleared) && bot.cleared <= config.maxLevel && time(bot.reachedAt) && bot.reachedAt <= maxTime)
    || !record(value.previousRanks) || Object.keys(value.previousRanks).length > config.opponentCount + 1
    || !Object.entries(value.previousRanks).every(([id, rank]) => /^(self|bot-\d+)$/.test(id) && integer(rank) && rank >= 1 && rank <= config.opponentCount + 1)
    || !Array.isArray(value.newIds) || !value.newIds.every(id => typeof id === 'string' && (value.opponents as LeaderboardOpponent[]).some(bot => bot.id === id))) return false;
  const bots = value.opponents as LeaderboardOpponent[];
  return new Set(bots.map(bot => bot.id)).size === bots.length && new Set(bots.map(bot => bot.name)).size === bots.length && new Set(value.newIds).size === value.newIds.length;
}

function random(state: LeaderboardState): number {
  state.seed = (state.seed + 0x6d2b79f5) >>> 0;
  let value = Math.imul(state.seed ^ (state.seed >>> 15), state.seed | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}
function pick(state: LeaderboardState, minimum: number, maximum: number): number { return minimum + Math.floor(random(state) * (maximum - minimum + 1)); }
function compare(a: { cleared: number; reachedAt: number; id: string }, b: { cleared: number; reachedAt: number; id: string }): number {
  return b.cleared - a.cleared || a.reachedAt - b.reachedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
export function readLeaderboard(state: LeaderboardState, playerCleared: number, config: LeaderboardConfig): LeaderboardEntry[] {
  return [...state.opponents.map(bot => ({ ...bot, isSelf: false })), { id: 'self', name: '我', avatar: 0, pace: 0, cleared: playerCleared, reachedAt: state.playerReachedAt, isSelf: true }]
    .sort(compare).map((entry, index) => ({ id: entry.id, name: entry.name, avatarColor: config.avatarColors[entry.avatar]!, cleared: entry.cleared, reachedAt: entry.reachedAt,
      rank: index + 1, change: state.previousRanks[entry.id] ? state.previousRanks[entry.id]! - index - 1 : 0, isNew: state.newIds.includes(entry.id), isSelf: entry.isSelf }));
}
function captureRanks(state: LeaderboardState, cleared: number, config: LeaderboardConfig): void {
  state.previousRanks = Object.fromEntries(readLeaderboard(state, cleared, config).map(entry => [entry.id, entry.rank]));
}
function opponent(state: LeaderboardState, pool: string[], cleared: number, reachedAt: number, config: LeaderboardConfig): LeaderboardOpponent {
  return { id: `bot-${state.nextId++}`, name: pool.splice(pick(state, 0, pool.length - 1), 1)[0]!, avatar: pick(state, 0, config.avatarColors.length - 1), pace: pick(state, 0, config.growth.length - 1), cleared, reachedAt };
}
export function createLeaderboard(config: LeaderboardConfig, now: number, createdAt: number, playerCleared: number, playerReachedAt: number): LeaderboardState {
  const day = dayOf(now);
  const state: LeaderboardState = { seed: createdAt >>> 0, nextId: 0, opponents: [], playerReachedAt, lastGrowthDay: day, lastTurnoverDay: day, updatedAt: Math.max(0, dayStart(day)), previousRanks: {}, newIds: [] };
  const pool = names(config);
  for (let index = 0; index < config.opponentCount; index++) {
    const cleared = Math.floor(config.maxLevel * random(state) ** config.initialExponent);
    state.opponents.push(opponent(state, pool, cleared, Math.max(0, dayStart(day) - pick(state, 1, 2 * DAY)), config));
  }
  captureRanks(state, playerCleared, config);
  return state;
}

/** Called only by the startup save transaction, never by opening the popup. */
export function advanceLeaderboard(state: LeaderboardState, playerCleared: number, now: number, config: LeaderboardConfig, reservedNames: readonly string[] = []): void {
  const day = dayOf(now);
  if (day <= state.lastGrowthDay) return;
  captureRanks(state, playerCleared, config);
  state.newIds = [];
  const days = Math.min(config.catchUpDays, Math.round((dayStart(day) - dayStart(state.lastGrowthDay)) / DAY));
  for (let offset = days - 1; offset >= 0; offset--) {
    const start = dayStart(day) - offset * DAY;
    for (const bot of state.opponents) {
      const growth = config.growth[bot.pace]!;
      const chance = growth.chance * (bot.cleared >= config.highProgressThreshold ? config.highProgressMultiplier : 1);
      if (bot.cleared === config.maxLevel || random(state) >= chance) continue;
      bot.cleared = Math.min(config.maxLevel, bot.cleared + pick(state, growth.minimum, growth.maximum));
      // Fixed Beijing day boundaries keep delayed save retries identical, including tie order.
      bot.reachedAt = Math.max(bot.reachedAt, start);
    }
  }
  if (dayStart(day) - dayStart(state.lastTurnoverDay) >= config.turnoverDays * DAY) {
    const tail = [...state.opponents].sort(compare).slice(-Math.ceil(config.opponentCount / 3));
    const minimum = Math.min(...tail.map(bot => bot.cleared), config.maxLevel - 1);
    const maximum = Math.min(Math.max(...tail.map(bot => bot.cleared)), config.maxLevel - 1);
    const pool = names(config).filter(name => !reservedNames.includes(name) && !state.opponents.some(bot => bot.name === name));
    const count = pick(state, Math.ceil(config.opponentCount * config.turnoverRatio[0]), Math.floor(config.opponentCount * config.turnoverRatio[1]));
    const removed = new Set<string>();
    for (let index = 0; index < count; index++) removed.add(tail.splice(pick(state, 0, tail.length - 1), 1)[0]!.id);
    state.opponents = state.opponents.filter(bot => !removed.has(bot.id));
    for (let index = 0; index < count; index++) {
      const bot = opponent(state, pool, pick(state, minimum, maximum), dayStart(day), config);
      state.opponents.push(bot); state.newIds.push(bot.id);
    }
    state.lastTurnoverDay = day;
  }
  state.lastGrowthDay = day; state.updatedAt = dayStart(day);
}

/** The player's score is still owned by clearedLevels; only rank history and arrival time are saved here. */
export function recordLeaderboardFirstClear(state: LeaderboardState, previousCleared: number, reachedAt: number, config: LeaderboardConfig): void {
  captureRanks(state, previousCleared, config);
  state.playerReachedAt = reachedAt; state.updatedAt = reachedAt;
}
