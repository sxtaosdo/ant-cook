import type { LeaderboardOpponent, LeaderboardState } from '../leaderboard/leaderboard';

export interface SocialConfig {
  /** Legacy field name; the value is the highest completed main-level threshold. */
  unlockClears: number; maxFollows: number; dailyHelpCount: number; helpCoins: number;
  responseHours: [number, number]; returnChance: number; naturalVisits: [number, number];
  historyLimit: number; messages: string[]; replies: string[]; thankYou: string;
}
export type SocialKind = 'visit' | 'like' | 'comment' | 'help' | 'request' | 'aid' | 'thanks';
export interface SocialEvent {
  id: number; actor: LeaderboardOpponent; kind: SocialKind; at: number; incoming: boolean; message: string;
}
export interface SocialPending {
  id: number; actor: LeaderboardOpponent; kind: 'return' | 'natural' | 'thanks';
  day: string; dueAt: number; like: boolean; reply: string;
}
export interface SocialHelp { id: number; actor: LeaderboardOpponent; done: boolean }
export interface SocialRequest { id: number; actor: LeaderboardOpponent; dueAt: number; ready: boolean }
export interface SocialState {
  seed: number; nextEvent: number; follows: LeaderboardOpponent[]; day: string;
  visited: string[]; liked: string[]; commented: string[]; helpRequests: SocialHelp[];
  requested: boolean; pending: SocialPending[]; request: SocialRequest | null;
  history: SocialEvent[]; readThrough: number;
}
export interface SocialPartner extends LeaderboardOpponent { followed: boolean; ranked: boolean }
export interface SocialReadModel {
  partners: SocialPartner[]; day: string; visited: string[]; liked: string[]; commented: string[];
  helpRequests: SocialHelp[]; helped: number; requested: boolean; request: SocialRequest | null;
  history: SocialEvent[]; unread: number;
}
const DAY = 86400000;
export const socialDay = (at: number): string => new Date(at + 8 * 3600000).toISOString().slice(0, 10);
const start = (day: string): number => Date.parse(`${day}T00:00:00+08:00`);
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 60;
const unique = (values: string[]): boolean => new Set(values).size === values.length;
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.every(v => typeof v === 'string' && /^bot-\d+$/.test(v)) && unique(value);
const validDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(start(value)) && socialDay(start(value)) === value;

export function readSocialConfig(value: unknown): SocialConfig {
  if (!record(value) || !integer(value.unlockClears) || value.unlockClears < 1 || value.unlockClears > 60 || value.maxFollows !== 5 || value.dailyHelpCount !== 3 || value.helpCoins !== 10
    || !Array.isArray(value.responseHours) || value.responseHours.length !== 2 || value.responseHours[0] !== 18 || value.responseHours[1] !== 30
    || value.returnChance !== 0.5 || !Array.isArray(value.naturalVisits) || value.naturalVisits.length !== 2 || value.naturalVisits[0] !== 2 || value.naturalVisits[1] !== 4
    || value.historyLimit !== 100 || !Array.isArray(value.messages) || value.messages.length !== 6 || !value.messages.every(text)
    || !Array.isArray(value.replies) || value.replies.length < 1 || !value.replies.every(text) || !text(value.thankYou)) throw new Error('虚拟伙伴配置无效');
  return value as unknown as SocialConfig;
}

export function createSocial(createdAt: number): SocialState {
  return { seed: (createdAt ^ 0xa13f798b) >>> 0, nextEvent: 1, follows: [], day: '', visited: [], liked: [], commented: [],
    helpRequests: [], requested: false, pending: [], request: null, history: [], readThrough: 0 };
}

/** Validate references as well as counters, so a corrupt receipt cannot become a reward. */
export function isSocialState(value: unknown, config: SocialConfig, leaderboard: LeaderboardState, avatarCount: number, maxTime: number): value is SocialState {
  if (!record(value) || !integer(value.seed) || value.seed > 0xffffffff || !integer(value.nextEvent) || value.nextEvent < 1
    || !integer(value.readThrough) || value.readThrough >= value.nextEvent || !(value.day === '' || validDay(value.day) && value.day <= socialDay(maxTime))
    || !ids(value.visited) || !ids(value.liked) || !ids(value.commented) || typeof value.requested !== 'boolean'
    || !Array.isArray(value.follows) || value.follows.length > config.maxFollows || !Array.isArray(value.pending) || value.pending.length > 160
    || !Array.isArray(value.history) || value.history.length > config.historyLimit || !Array.isArray(value.helpRequests) || value.helpRequests.length > config.dailyHelpCount) return false;
  const actor = (v: unknown): v is LeaderboardOpponent => record(v) && typeof v.id === 'string' && /^bot-\d+$/.test(v.id)
    && Number(v.id.slice(4)) < leaderboard.nextId && text(v.name) && v.name.length <= 12 && integer(v.avatar) && v.avatar < avatarCount
    && integer(v.pace) && v.pace < 3 && integer(v.cleared) && v.cleared <= 60 && integer(v.reachedAt) && v.reachedAt <= maxTime;
  const id = (v: unknown): v is number => integer(v) && v > 0 && v < (value.nextEvent as number);
  if (!value.follows.every(actor) || !unique(value.follows.map(v => v.id))
    || !value.helpRequests.every(v => record(v) && id(v.id) && actor(v.actor) && typeof v.done === 'boolean')
    || !unique(value.helpRequests.map(v => v.actor.id))
    || !value.pending.every(v => record(v) && id(v.id) && actor(v.actor) && ['return', 'natural', 'thanks'].includes(v.kind as string)
      && validDay(v.day) && v.day <= socialDay(maxTime) && integer(v.dueAt) && v.dueAt <= maxTime + config.responseHours[1] * 3600000
      && typeof v.like === 'boolean' && typeof v.reply === 'string' && v.reply.length <= 60)
    || !value.history.every(v => record(v) && id(v.id) && actor(v.actor) && ['visit', 'like', 'comment', 'help', 'request', 'aid', 'thanks'].includes(v.kind as string)
      && integer(v.at) && v.at <= maxTime && typeof v.incoming === 'boolean' && typeof v.message === 'string' && v.message.length <= 60)
    || (value.request !== null && !(record(value.request) && id(value.request.id) && actor(value.request.actor) && integer(value.request.dueAt)
      && value.request.dueAt <= maxTime + config.responseHours[1] * 3600000 && typeof value.request.ready === 'boolean'
      && (!value.request.ready || value.request.dueAt <= maxTime)))) return false;
  const eventIds = [...value.pending, ...value.history, ...value.helpRequests].map(v => v.id);
  if (value.request) eventIds.push(value.request.id);
  return new Set(eventIds).size === eventIds.length;
}

function random(state: SocialState): number {
  state.seed = (state.seed + 0x6d2b79f5) >>> 0;
  let v = Math.imul(state.seed ^ (state.seed >>> 15), state.seed | 1);
  v ^= v + Math.imul(v ^ (v >>> 7), v | 61);
  return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
}
function pick(state: SocialState, min: number, max: number): number { return min + Math.floor(random(state) * (max - min + 1)); }
function due(state: SocialState, now: number, config: SocialConfig): number { return now + pick(state, config.responseHours[0] * 3600, config.responseHours[1] * 3600) * 1000; }
function append(state: SocialState, actor: LeaderboardOpponent, kind: SocialKind, at: number, incoming: boolean, message: string, config: SocialConfig): void {
  state.history.push({ id: state.nextEvent++, actor: copy(actor), kind, at, incoming, message });
  state.history = state.history.sort((a,b) => a.at - b.at || a.id - b.id).slice(-config.historyLimit);
}
export function readSocial(state: SocialState, leaderboard: LeaderboardState): SocialReadModel {
  const partners: SocialPartner[] = leaderboard.opponents.map(bot => ({ ...bot, followed: state.follows.some(f => f.id === bot.id), ranked: true }));
  for (const bot of state.follows) if (!partners.some(p => p.id === bot.id)) partners.push({ ...bot, followed: true, ranked: false });
  partners.sort((a, b) => Number(b.followed) - Number(a.followed) || b.cleared - a.cleared || a.reachedAt - b.reachedAt);
  return copy({ partners, day: state.day, visited: state.visited, liked: state.liked, commented: state.commented,
    helpRequests: state.helpRequests, helped: state.helpRequests.filter(r => r.done).length, requested: state.requested, request: state.request,
    history: [...state.history].sort((a,b) => b.at - a.at || b.id - a.id), unread: state.history.filter(e => e.incoming && e.id > state.readThrough).length });
}
function partner(state: SocialState, leaderboard: LeaderboardState, id: string): LeaderboardOpponent {
  const bot = leaderboard.opponents.find(p => p.id === id) ?? state.follows.find(p => p.id === id);
  if (!bot) throw new Error('这位伙伴已离榜，历史记录仍然保留');
  return bot;
}
export function syncSocialPartners(state: SocialState, leaderboard: LeaderboardState): void {
  state.follows = state.follows.map(bot => copy(leaderboard.opponents.find(p => p.id === bot.id) ?? bot));
}

/** Called by explicit startup/resume/timer commands, never by a read model. */
export function advanceSocial(state: SocialState, leaderboard: LeaderboardState, now: number, config: SocialConfig): void {
  syncSocialPartners(state, leaderboard);
  const day = socialDay(now);
  if (day > state.day) {
    state.day = day; state.visited = []; state.liked = []; state.commented = []; state.requested = false;
    const pool = readSocial(state, leaderboard).partners;
    const priority = pool.filter(p => p.followed); const others = pool.filter(p => !p.followed);
    const requests: SocialHelp[] = [];
    while (requests.length < config.dailyHelpCount) {
      const choices = priority.length ? priority : others;
      const bot = choices.splice(pick(state, 0, choices.length - 1), 1)[0]!;
      requests.push({ id: state.nextEvent++, actor: copy(bot), done: false });
    }
    state.helpRequests = requests;
    const natural = [...readSocial(state, leaderboard).partners];
    for (let n = pick(state, ...config.naturalVisits); n > 0; n--) {
      const bot = natural.splice(pick(state, 0, natural.length - 1), 1)[0]!;
      state.pending.push({ id: state.nextEvent++, actor: copy(bot), kind: 'natural', day, dueAt: Math.max(0, start(day)) + pick(state, 0, DAY - 1), like: random(state) < 0.5, reply: '' });
    }
  }
  for (const event of state.pending.filter(e => e.dueAt <= now)) {
    if (event.kind === 'thanks') append(state, event.actor, 'thanks', event.dueAt, true, event.reply, config);
    else {
      append(state, event.actor, 'visit', event.dueAt, true, '', config);
      if (event.like) append(state, event.actor, 'like', event.dueAt, true, '', config);
      if (event.reply) append(state, event.actor, 'comment', event.dueAt, true, event.reply, config);
    }
  }
  state.pending = state.pending.filter(e => e.dueAt > now);
  if (state.request && !state.request.ready && state.request.dueAt <= now) {
    state.request.ready = true;
    append(state, state.request.actor, 'aid', state.request.dueAt, true, '', config);
  }
}
export function socialNeedsAdvance(state: SocialState, now: number): boolean {
  return socialDay(now) > state.day || state.pending.some(e => e.dueAt <= now) || Boolean(state.request && !state.request.ready && state.request.dueAt <= now);
}
export function followPartner(state: SocialState, leaderboard: LeaderboardState, id: string, followed: boolean, config: SocialConfig): void {
  const bot = partner(state, leaderboard, id);
  const existing = state.follows.findIndex(p => p.id === id);
  if (followed && existing < 0) {
    if (state.follows.length >= config.maxFollows) throw new Error('最多关注5名常客，请先取消一个关注');
    state.follows.push(copy(bot));
  } else if (!followed && existing >= 0) state.follows.splice(existing, 1);
}
export function interactPartner(state: SocialState, leaderboard: LeaderboardState, id: string, kind: 'visit' | 'like' | 'comment', now: number, config: SocialConfig, messageIndex = 0): boolean {
  const bot = partner(state, leaderboard, id);
  if (kind === 'comment' && (!integer(messageIndex) || messageIndex >= config.messages.length)) throw new Error('请选择有效的留言');
  const done = kind === 'visit' ? state.visited : kind === 'like' ? state.liked : state.commented;
  if (done.includes(id)) return false;
  done.push(id);
  append(state, bot, kind, now, false, kind === 'comment' ? config.messages[messageIndex]! : '', config);
  let response = state.pending.find(p => p.kind === 'return' && p.day === state.day && p.actor.id === id);
  if (!response && (kind === 'comment' || random(state) < config.returnChance)) {
    // A return happens on the next Beijing day, still within 18–30h, allowing same-day actions to merge.
    response = { id: state.nextEvent++, actor: copy(bot), kind: 'return', day: state.day,
      dueAt: Math.max(due(state, now, config), start(state.day) + DAY), like: false, reply: '' };
    state.pending.push(response);
  }
  if (response) {
    if (kind === 'like') response.like = true;
    if (kind === 'comment') response.reply = config.replies[pick(state, 0, config.replies.length - 1)]!;
  }
  return true;
}
export function helpPartner(state: SocialState, requestId: number, now: number, config: SocialConfig): number | null {
  const request = state.helpRequests.find(r => r.id === requestId);
  if (!request) throw new Error('援助请求已过期，请查看今天的请求');
  if (request.done) return null;
  request.done = true;
  append(state, request.actor, 'help', now, false, '', config);
  state.pending.push({ id: state.nextEvent++, actor: copy(request.actor), kind: 'thanks', day: state.day, dueAt: due(state, now, config), like: false, reply: config.thankYou });
  return request.id;
}
export function requestPartnerHelp(state: SocialState, leaderboard: LeaderboardState, id: string, now: number, config: SocialConfig): void {
  const bot = partner(state, leaderboard, id);
  if (state.request) throw new Error('已有一份援助，请等待回应或先领取');
  if (state.requested) throw new Error('今天已经求助，明天再来');
  state.requested = true;
  state.request = { id: state.nextEvent++, actor: copy(bot), dueAt: due(state, now, config), ready: false };
  append(state, bot, 'request', now, false, '', config);
}
export function claimPartnerHelp(state: SocialState): number {
  if (!state.request?.ready) throw new Error('援助尚未到达或已领取');
  const id = state.request.id; state.request = null;
  return id;
}
export function markSocialRead(state: SocialState): void { state.readThrough = state.nextEvent - 1; }
