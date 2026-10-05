import assert from 'node:assert/strict';
import test from 'node:test';
import { PlayerProgress, PROGRESS_BACKUP_KEY, PROGRESS_SAVE_KEY } from '../../assets/Colony/scripts/application/playerProgress';
import { isSocialState, readSocialConfig } from '../../assets/Colony/scripts/application/social/social';
import { leaderboardTestConfig, socialTestConfig } from '../support/leaderboardTestConfig';

const HOUR = 3600000;
const START = Date.parse('2026-10-04T00:00:00+08:00');
function setup(count = 3) {
  const values = new Map<string, string>(); let now = START; let failed = false; let writes = 0;
  const save = { read: (key: string) => values.get(key) ?? null, write(key: string, value: string) {
    if (failed && key === PROGRESS_SAVE_KEY) throw new Error('disk full'); writes++; values.set(key, value);
  } };
  const clock = { now: () => now };
  let progress = new PlayerProgress(save, clock, leaderboardTestConfig, socialTestConfig);
  for (let level = 1; level <= count; level++) progress.settleRound(progress.startRound(level).id, 'SUCCESS', 100);
  return { values, get progress() { return progress; }, get now() { return now; }, get writes() { return writes; },
    setTime(at: number) { now = at; }, hours(hours: number) { now += hours * HOUR; }, fail(value: boolean) { failed = value; },
    restart() { progress = new PlayerProgress(save, clock, leaderboardTestConfig, socialTestConfig); return progress; } };
}

test('social configuration rejects invalid values before creating progress', () => {
  for (const patch of [{ helpCoins: -1 }, { maxFollows: 6 }, { responseHours: [30, 18] }, { messages: [] }, { returnChance: 2 }]) {
    assert.throws(() => readSocialConfig({ ...socialTestConfig, ...patch }), /配置无效/);
  }
});

test('virtual partners unlock at three first clears, preserving the existing main loop', () => {
  const env = setup(2); const bot = env.progress.readLeaderboard().find(p => !p.isSelf)!;
  assert.equal(env.progress.socialAvailable(), false);
  assert.throws(() => env.progress.interactPartner(bot.id, 'like'), /第3关/);
  const before = env.progress.snapshot(); env.progress.settleRound(env.progress.startRound(3).id, 'SUCCESS', 100);
  assert.equal(env.progress.socialAvailable(), true);
  assert.equal(env.progress.snapshot().coins - before.coins, 40);
  assert.deepEqual(env.progress.snapshot().clearedLevels, [1, 2, 3]);
  assert.equal(env.progress.readSocial().helpRequests.length, 3);
});

test('social and ranking share stable identities; reads cannot write or expose mutable state', () => {
  const env = setup(); const board = env.progress.readLeaderboard();
  const model = env.progress.readSocial(); assert.equal(model.partners.length, 50);
  for (const bot of model.partners) {
    const ranked = board.find(p => p.id === bot.id)!; assert.equal(bot.name, ranked.name); assert.equal(bot.cleared, ranked.cleared);
  }
  const writes = env.writes; const saved = [...env.values]; env.hours(49);
  const read = env.progress.readSocial(); read.partners[0]!.name = 'changed'; read.helpRequests.length = 0;
  assert.equal(env.writes, writes); assert.deepEqual([...env.values], saved);
  assert.notEqual(env.progress.readSocial().partners[0]!.name, 'changed');
  assert.equal(env.progress.readSocial().helpRequests.length, 3);
});

test('visits, likes and fixed messages are daily idempotent and merge into one delayed return', () => {
  const env = setup(); const id = env.progress.readSocial().partners[0]!.id;
  const before = env.progress.snapshot();
  assert.equal(env.progress.interactPartner(id, 'visit'), true);
  assert.equal(env.progress.interactPartner(id, 'visit'), false);
  env.progress.interactPartner(id, 'like'); env.progress.interactPartner(id, 'comment', 2);
  assert.equal(env.progress.interactPartner(id, 'like'), false);
  assert.equal(env.progress.interactPartner(id, 'comment', 0), false);
  assert.throws(() => env.progress.interactPartner(id, 'comment', 6), /有效的留言/);
  const returns = env.progress.snapshot().social.pending.filter(e => e.kind === 'return' && e.actor.id === id);
  assert.equal(returns.length, 1); assert.ok(returns[0]!.dueAt >= START + 18 * HOUR && returns[0]!.dueAt <= START + 30 * HOUR);
  const dueAt = returns[0]!.dueAt;
  env.hours(5); env.restart(); assert.equal(env.progress.snapshot().social.pending.find(e => e.id === returns[0]!.id)!.dueAt, dueAt);
  assert.equal(env.progress.snapshot().coins, before.coins); assert.deepEqual(env.progress.snapshot().clearedLevels, before.clearedLevels);
  env.setTime(dueAt); env.progress.advanceSocial();
  assert.equal(env.progress.readSocial().history.filter(e => e.incoming && e.kind === 'comment' && e.actor.id === id).length, 1);
  const history = env.progress.readSocial().history; env.progress.advanceSocial(); env.restart();
  assert.deepEqual(env.progress.readSocial().history, history);
});

test('three distinct free help requests award exactly thirty coins, without consuming inventory', () => {
  const env = setup(); const before = env.progress.snapshot(); const requests = env.progress.readSocial().helpRequests;
  assert.equal(new Set(requests.map(r => r.actor.id)).size, 3);
  for (const request of requests) {
    assert.equal(env.progress.helpPartner(request.id), true); assert.equal(env.progress.helpPartner(request.id), false);
  }
  assert.equal(env.progress.snapshot().coins, before.coins + 30);
  assert.equal(env.progress.snapshot().supplyTokens, before.supplyTokens);
  assert.deepEqual(env.progress.snapshot().clearedLevels, before.clearedLevels);
  assert.equal(env.progress.readSocial().helped, 3);
  assert.throws(() => env.progress.helpPartner(99999), /过期/);
  env.hours(24); env.progress.advanceSocial(); assert.equal(env.progress.readSocial().helped, 0);
  assert.throws(() => env.progress.helpPartner(requests[0]!.id), /过期/);
});

test('a single outstanding daily request produces one existing supply token after 18–30 hours', () => {
  const env = setup(); const id = env.progress.readSocial().partners[0]!.id;
  env.progress.requestPartnerHelp(id);
  const request = env.progress.readSocial().request!;
  assert.ok(request.dueAt >= START + 18 * HOUR && request.dueAt <= START + 30 * HOUR);
  assert.throws(() => env.progress.requestPartnerHelp(id), /已有一份/);
  assert.throws(() => env.progress.claimPartnerHelp(), /尚未到达/);
  env.setTime(request.dueAt); env.restart(); assert.equal(env.progress.readSocial().request!.ready, true);
  const tokens = env.progress.snapshot().supplyTokens;
  env.progress.claimPartnerHelp(); assert.equal(env.progress.snapshot().supplyTokens, tokens + 1);
  assert.throws(() => env.progress.claimPartnerHelp(), /已领取/);
  const round = env.progress.startRound(4);
  env.progress.buyExtraSupply(round.id, 'trowel', 'token');
  assert.equal(env.progress.snapshot().supplyTokens, tokens);
  assert.throws(() => env.progress.buyExtraSupply(round.id, 'compass', 'token'), /无法领取/);
});

test('an unclaimed request survives multiple days; daily outgoing quota does not stack', () => {
  const env = setup(); const id = env.progress.readSocial().partners[0]!.id;
  env.progress.requestPartnerHelp(id); const request = env.progress.readSocial().request!;
  env.hours(30 * 24); env.restart(); assert.equal(env.progress.readSocial().request!.id, request.id);
  assert.equal(env.progress.readSocial().request!.ready, true);
  assert.throws(() => env.progress.requestPartnerHelp(id), /已有一份|已离榜/);
  assert.equal(env.progress.readSocial().helpRequests.length, 3);
  assert.equal(env.progress.readSocial().helped, 0);
  env.progress.claimPartnerHelp(); assert.equal(env.progress.snapshot().supplyTokens, 1);
});

test('five followed regulars remain accessible after turnover; new identities cannot reuse their names', () => {
  const env = setup(); const tail = env.progress.readSocial().partners.slice(-5);
  for (const bot of tail) env.progress.followPartner(bot.id, true);
  assert.throws(() => env.progress.followPartner(env.progress.readSocial().partners.find(p => !p.followed)!.id, true), /最多关注5/);
  let retired = env.progress.readSocial().partners.find(p => p.followed && !p.ranked);
  for (let n = 0; n < 20 && !retired; n++) {
    env.hours(48); env.restart(); retired = env.progress.readSocial().partners.find(p => p.followed && !p.ranked);
  }
  assert.ok(retired); assert.equal(env.progress.readLeaderboard().length, 51);
  assert.equal(env.progress.readSocial().partners.filter(p => p.followed).length, 5);
  assert.equal(env.progress.readSocial().partners.filter(p => p.name === retired.name).length, 1);
  env.progress.interactPartner(retired.id, 'comment', 0); env.progress.requestPartnerHelp(retired.id);
  env.progress.followPartner(retired.id, false);
  assert.throws(() => env.progress.interactPartner(retired.id, 'like'), /已离榜/);
  env.hours(31); env.restart(); env.progress.claimPartnerHelp(); assert.equal(env.progress.snapshot().supplyTokens, 1);
  assert.ok(env.progress.readSocial().history.some(e => e.actor.id === retired.id && e.actor.name === retired.name));
});

test('social activity never consumes the leaderboard seed or changes daily scores', () => {
  const first = setup(); const second = setup(); const id = first.progress.readSocial().partners[0]!.id;
  first.progress.interactPartner(id, 'visit'); first.progress.interactPartner(id, 'like'); first.progress.interactPartner(id, 'comment');
  first.progress.helpPartner(first.progress.readSocial().helpRequests[0]!.id); first.progress.requestPartnerHelp(id);
  assert.deepEqual(first.progress.snapshot().leaderboard, second.progress.snapshot().leaderboard);
  first.hours(48); second.hours(48);
  assert.deepEqual(first.restart().snapshot().leaderboard, second.restart().snapshot().leaderboard);
});

test('write failure rolls back coins, quotas and delayed aid; retries and backup recovery do not duplicate rewards', () => {
  const env = setup(); const help = env.progress.readSocial().helpRequests[0]!; const before = env.progress.snapshot();
  env.fail(true); assert.throws(() => env.progress.helpPartner(help.id), /disk full/);
  assert.deepEqual(env.progress.snapshot(), before);
  env.fail(false); env.progress.helpPartner(help.id); assert.equal(env.progress.snapshot().coins, before.coins + 10);
  env.progress.requestPartnerHelp(help.actor.id); const requested = env.progress.readSocial().request!;
  env.setTime(requested.dueAt); env.progress.advanceSocial(); const ready = env.progress.snapshot();
  env.fail(true); assert.throws(() => env.progress.claimPartnerHelp(), /disk full/); assert.deepEqual(env.progress.snapshot(), ready);
  env.fail(false); env.progress.claimPartnerHelp();
  const saved = env.values.get(PROGRESS_SAVE_KEY)!; env.values.set(PROGRESS_BACKUP_KEY, saved); env.values.set(PROGRESS_SAVE_KEY, 'broken');
  assert.equal(env.restart().recoveredBackup, true); assert.equal(env.progress.snapshot().supplyTokens, ready.supplyTokens + 1);
  assert.throws(() => env.progress.claimPartnerHelp(), /已领取/);
  assert.equal(env.progress.helpPartner(help.id), false);
});

test('failed delayed processing retries the saved schedule without rerolling arrivals', () => {
  const env = setup(); const id = env.progress.readSocial().partners[0]!.id;
  env.progress.interactPartner(id, 'comment'); const saved = env.values.get(PROGRESS_SAVE_KEY)!;
  env.hours(31); env.fail(true); assert.throws(() => env.restart(), /disk full/); assert.equal(env.values.get(PROGRESS_SAVE_KEY), saved);
  env.fail(false); const expected = env.restart().snapshot().social;
  env.values.set(PROGRESS_SAVE_KEY, saved); assert.deepEqual(env.restart().snapshot().social, expected);
});

test('clock rollback blocks new interactions, coins and incoming grants until the clock recovers', () => {
  const env = setup(); const id = env.progress.readSocial().partners[0]!.id;
  env.progress.requestPartnerHelp(id); const request = env.progress.readSocial().request!;
  env.hours(-24); env.restart(); const before = env.progress.readSocial();
  assert.equal(env.progress.advanceSocial(), false);
  assert.throws(() => env.progress.interactPartner(id, 'like'), /时间/);
  assert.throws(() => env.progress.helpPartner(before.helpRequests[0]!.id), /时间/);
  assert.throws(() => env.progress.claimPartnerHelp(), /时间/);
  assert.deepEqual(env.progress.readSocial(), before);
  env.setTime(request.dueAt); env.progress.advanceSocial(); env.progress.claimPartnerHelp();
  assert.equal(env.progress.snapshot().supplyTokens, 1);
});

test('v3 migration preserves the original leaderboard and assets; v4 validation recovers the backup', () => {
  const env = setup(); const legacy = { ...env.progress.snapshot(), version: 3, social: undefined };
  env.values.set(PROGRESS_SAVE_KEY, JSON.stringify(legacy)); env.restart(); const current = env.progress.snapshot();
  assert.equal(current.version, 6);
  for (const key of ['leaderboard', 'clearedLevels', 'coins', 'supplyTokens', 'rounds', 'rewardLedger'] as const) assert.deepEqual(current[key], legacy[key]);
  assert.ok(isSocialState(current.social, socialTestConfig, current.leaderboard, leaderboardTestConfig.avatarColors.length, current.maxTime));
  env.values.set(PROGRESS_BACKUP_KEY, env.values.get(PROGRESS_SAVE_KEY)!);
  const corrupt = JSON.parse(env.values.get(PROGRESS_SAVE_KEY)!); corrupt.social.follows = Array(6).fill(current.leaderboard.opponents[0]);
  env.values.set(PROGRESS_SAVE_KEY, JSON.stringify(corrupt)); assert.equal(env.restart().recoveredBackup, true);
});

test('history is bounded without dropping pending assistance or unread identity snapshots', () => {
  const env = setup(); const bots = env.progress.readSocial().partners;
  env.progress.requestPartnerHelp(bots[0]!.id); const request = env.progress.readSocial().request!;
  for (const bot of bots) { env.progress.interactPartner(bot.id, 'visit'); env.progress.interactPartner(bot.id, 'like'); env.progress.interactPartner(bot.id, 'comment'); }
  assert.equal(env.progress.readSocial().history.length, 100);
  assert.equal(env.progress.readSocial().request!.id, request.id);
  env.hours(31); env.restart(); assert.equal(env.progress.readSocial().history.length, 100);
  const kept = env.progress.snapshot().social.history;
  assert.ok(kept.every((event, index) => index === 0 || kept[index - 1]!.at <= event.at), 'old arrivals must never evict newer delayed replies');
  assert.equal(env.progress.readSocial().request!.ready, true);
  env.progress.markSocialRead(); assert.equal(env.progress.readSocial().unread, 0);
  env.progress.claimPartnerHelp(); assert.equal(env.progress.snapshot().supplyTokens, 1);
});
