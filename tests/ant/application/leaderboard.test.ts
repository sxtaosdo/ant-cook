import assert from 'node:assert/strict';
import test from 'node:test';
import { PlayerProgress, PROGRESS_SAVE_KEY, PROGRESS_BACKUP_KEY, PROGRESS_CALENDAR_START } from '../../assets/Colony/scripts/application/playerProgress';
import { readLeaderboard, readLeaderboardConfig, isLeaderboardState, advanceLeaderboard } from '../../assets/Colony/scripts/application/leaderboard/leaderboard';
import { leaderboardTestConfig as config, socialTestConfig } from '../support/leaderboardTestConfig';

const DAY = 86400000;
function setup() {
  const values = new Map<string, string>(); let now = PROGRESS_CALENDAR_START + 12 * 3600000; let fail = false;
  const save = { read: (key: string) => values.get(key) ?? null, write(key: string, value: string) {
    if (fail && key === PROGRESS_SAVE_KEY) throw new Error('disk full'); values.set(key, value);
  } };
  const clock = { now: () => now };
  let progress = new PlayerProgress(save, clock, config, socialTestConfig);
  return { values, get progress() { return progress; }, move(days: number) { now += days * DAY; }, fail(value: boolean) { fail = value; },
    restart() { progress = new PlayerProgress(save, clock, config, socialTestConfig); return progress; } };
}
function clear(progress: PlayerProgress, level: number) {
  const round = progress.startRound(level); progress.settleRound(round.id, 'SUCCESS', 100); return round.id;
}

test('leaderboard has fifty stable unique identities plus the real player and reads without persistence', () => {
  const env = setup(); const state = env.progress.snapshot(); const saved = env.values.get(PROGRESS_SAVE_KEY);
  const rows = env.progress.readLeaderboard();
  assert.equal(rows.length, 51); assert.equal(rows.filter(row => row.isSelf).length, 1);
  assert.equal(new Set(rows.map(row => row.name)).size, 51); assert.equal(new Set(rows.map(row => row.id)).size, 51);
  assert.equal(rows.find(row => row.isSelf)!.cleared, 0);
  for (let index = 0; index < 20; index++) assert.deepEqual(env.progress.readLeaderboard(), rows);
  assert.equal(env.values.get(PROGRESS_SAVE_KEY), saved); assert.deepEqual(env.progress.snapshot(), state);
  assert.deepEqual(env.restart().snapshot().leaderboard, state.leaderboard);
  assert.ok(isLeaderboardState(state.leaderboard, config, state.maxTime));
});

test('a valid zero clock produces a restartable save', () => {
  const values = new Map<string,string>();
  const save = { read:(key:string)=>values.get(key)??null, write(key:string,value:string) { values.set(key,value); } };
  const first = new PlayerProgress(save, {now:()=>0}, config, socialTestConfig);
  assert.equal(isLeaderboardState(first.snapshot().leaderboard, config, 0), true);
  assert.deepEqual(new PlayerProgress(save, {now:()=>0}, config, socialTestConfig).snapshot().leaderboard, first.snapshot().leaderboard);
});

test('ties use arrival time then stable identity, with exact rank changes', () => {
  const state = setup().progress.snapshot().leaderboard;
  state.opponents.forEach(bot => { bot.cleared = 0; });
  const [early, late] = state.opponents;
  early!.cleared = late!.cleared = 12;
  early!.reachedAt = state.playerReachedAt - 1; late!.reachedAt = state.playerReachedAt + 1;
  state.previousRanks.self = 7;
  const rows = readLeaderboard(state, 12, config);
  assert.equal(rows[0]!.id, early!.id); assert.equal(rows[1]!.id, 'self'); assert.equal(rows[2]!.id, late!.id);
  assert.equal(rows[1]!.change, 5);
  early!.reachedAt = late!.reachedAt;
  const tied = readLeaderboard(state, 0, config).filter(row => row.cleared === 12);
  assert.deepEqual(tied.map(row => row.id), [early!.id, late!.id].sort((a,b)=>a.localeCompare(b)));
});

test('only a new main first clear updates the player arrival and ranking, not bots, rewards or inventory', () => {
  const env = setup(); const opponents = env.progress.snapshot().leaderboard.opponents;
  env.move(0.01); const id = clear(env.progress, 1);
  assert.equal(env.progress.readLeaderboard().find(row => row.isSelf)!.cleared, 1);
  assert.deepEqual(env.progress.snapshot().leaderboard.opponents, opponents);
  const first = env.progress.snapshot();
  assert.equal(env.progress.settleRound(id, 'SUCCESS', 100).duplicate, true);
  clear(env.progress, 1); assert.deepEqual(env.progress.snapshot().leaderboard, first.leaderboard);
  assert.equal(env.progress.snapshot().coins, first.coins); assert.deepEqual(env.progress.snapshot().clearedLevels, [1]);
  for (let level = 2; level <= 10; level++) clear(env.progress, level);
  const beforeDaily = env.progress.snapshot().leaderboard;
  const daily = env.progress.startRound(env.progress.dailyChallengeIndex() + 1, 'daily');
  env.progress.settleRound(daily.id, 'SUCCESS', 100);
  assert.deepEqual(env.progress.snapshot().leaderboard, beforeDaily);
  assert.equal(env.progress.readLeaderboard().find(row => row.isSelf)!.cleared, 10);
});

test('growth runs once on the first startup of a Beijing day, never by reading across midnight', () => {
  const env = setup(); const before = env.progress.snapshot().leaderboard;
  env.move(1); env.progress.snapshot(); env.progress.readLeaderboard();
  assert.deepEqual(env.progress.snapshot().leaderboard, before);
  const after = env.restart().snapshot().leaderboard;
  assert.notDeepEqual(after.opponents, before.opponents); assert.equal(after.lastGrowthDay, '2026-09-22');
  assert.deepEqual(after.opponents.map(bot => [bot.id, bot.name, bot.avatar, bot.pace]), before.opponents.map(bot => [bot.id, bot.name, bot.avatar, bot.pace]));
  assert.ok(after.opponents.every((bot,index)=>bot.cleared >= before.opponents[index]!.cleared));
  assert.deepEqual(env.restart().snapshot().leaderboard, after);
  env.move(-2); assert.deepEqual(env.restart().snapshot().leaderboard, after);
});

test('turnover varies around fifteen percent and replaces only trailing opponents with complete new identities', () => {
  const env = setup(); const counts = new Set<number>();
  for (let iteration = 0; iteration < 12; iteration++) {
    const before = env.progress.snapshot().leaderboard;
    env.move(2); const after = env.restart().snapshot().leaderboard;
    const oldIds = new Set(before.opponents.map(bot=>bot.id));
    const newcomers = after.opponents.filter(bot=>!oldIds.has(bot.id));
    assert.ok(newcomers.length >= 6 && newcomers.length <= 9); counts.add(newcomers.length);
    assert.equal(after.opponents.length, 50); assert.equal(env.progress.readLeaderboard().length, 51);
    assert.deepEqual(new Set(after.newIds), new Set(newcomers.map(bot=>bot.id)));
    assert.ok(newcomers.every(bot=>!before.opponents.some(old=>old.name===bot.name)));
    for (const survivor of after.opponents.filter(bot=>oldIds.has(bot.id))) {
      const old = before.opponents.find(bot=>bot.id===survivor.id)!;
      assert.equal(survivor.name, old.name); assert.equal(survivor.avatar, old.avatar); assert.equal(survivor.pace, old.pace);
      assert.ok(survivor.cleared >= old.cleared && survivor.cleared <= 60);
    }
    assert.deepEqual(env.restart().snapshot().leaderboard, after);
  }
  assert.ok(counts.size > 1, 'replacement count must vary, not always eight');
  env.move(1); assert.deepEqual(env.restart().snapshot().leaderboard.newIds, []);
});

test('a long absence caps growth at three days and applies only one replacement batch', () => {
  const env = setup(); const before = env.progress.snapshot().leaderboard;
  env.move(30); const after = env.restart().snapshot().leaderboard;
  assert.ok(after.newIds.length >= 6 && after.newIds.length <= 9);
  for (const bot of after.opponents) {
    const old = before.opponents.find(entry=>entry.id===bot.id);
    if (old) assert.ok(bot.cleared - old.cleared <= 12);
  }
  assert.equal(after.lastGrowthDay, '2026-10-21');
});

test('old v1/v2 assets and receipts survive migration, preferring recorded main arrival time', () => {
  for (const version of [1, 2]) {
    const env = setup(); const id = clear(env.progress, 1);
    const legacy: any = env.progress.snapshot(); legacy.version = version; delete legacy.leaderboard;
    legacy.stars = 31; legacy.stalls[0] = 3; legacy.decorations = ['stall-0-lantern']; legacy.rewardLedger.push('legacy-receipt');
    if (version === 1) { delete legacy.diamonds; delete legacy.starterDiamondsClaimed; }
    env.values.set(PROGRESS_SAVE_KEY, JSON.stringify(legacy)); env.move(2);
    const migrated = env.restart().snapshot(); assert.equal(migrated.version, 6);
    assert.equal(migrated.leaderboard.playerReachedAt, legacy.rounds[id].completedAt);
    for (const key of ['coins', 'stars', 'stalls', 'decorations', 'rewardLedger', 'clearedLevels', 'rounds'] as const) assert.deepEqual(migrated[key], legacy[key]);
    assert.equal(migrated.leaderboard.newIds.length, 0);
  }
  const env = setup(); const legacy: any = env.progress.snapshot(); legacy.version = 2; delete legacy.leaderboard;
  env.values.set(PROGRESS_SAVE_KEY, JSON.stringify(legacy)); env.move(1);
  assert.equal(env.restart().snapshot().leaderboard.playerReachedAt, legacy.lastSeen);
});

test('failed saves roll back main ranking and daily simulation, with deterministic recovery and no reroll', () => {
  const env = setup(); const round = env.progress.startRound(1); const before = env.progress.snapshot();
  env.fail(true); assert.throws(()=>env.progress.settleRound(round.id, 'SUCCESS', 100), /disk full/);
  assert.deepEqual(env.progress.snapshot(), before);
  env.fail(false); env.progress.settleRound(round.id, 'SUCCESS', 100);
  env.move(2); const saved = env.values.get(PROGRESS_SAVE_KEY)!;
  env.fail(true); assert.throws(()=>env.restart(), /disk full/);
  assert.equal(env.values.get(PROGRESS_SAVE_KEY), saved);
  env.fail(false); const expected = env.restart().snapshot().leaderboard;
  env.values.set(PROGRESS_SAVE_KEY, saved); env.move(0.1);
  assert.deepEqual(env.restart().snapshot().leaderboard, expected);
  env.values.set(PROGRESS_BACKUP_KEY, env.values.get(PROGRESS_SAVE_KEY)!);
  env.values.set(PROGRESS_SAVE_KEY, 'broken');
  assert.equal(env.restart().recoveredBackup, true); assert.deepEqual(env.progress.snapshot().leaderboard, expected);
  assert.deepEqual(env.restart().snapshot().leaderboard, expected);
});

test('invalid config or corrupt v3 identity data is rejected rather than replacing a valid player save', () => {
  assert.throws(()=>readLeaderboardConfig({...config, turnoverRatio:[0.2, 0.1]}), /配置/);
  assert.throws(()=>readLeaderboardConfig({...config, turnoverRatio:[0.121, 0.122]}), /配置/);
  assert.throws(()=>readLeaderboardConfig({...config, growth:[{chance:NaN}]}), /配置/);
  assert.throws(()=>readLeaderboardConfig({...config, nicknameStarts:['同名'], nicknameEnds:['同名']}), /昵称/);
  const env = setup(); const corrupt = env.progress.snapshot(); corrupt.leaderboard.opponents[1]!.id = corrupt.leaderboard.opponents[0]!.id;
  const raw = JSON.stringify(corrupt); env.values.set(PROGRESS_SAVE_KEY, raw); env.values.set(PROGRESS_BACKUP_KEY, raw);
  assert.throws(()=>env.restart(), /存档损坏/); assert.equal(env.values.get(PROGRESS_SAVE_KEY), raw);
});

test('legacy migration preserves a valid backup when the primary write fails', () => {
  const env = setup(); clear(env.progress, 1);
  const legacy: any = env.progress.snapshot(); legacy.version = 2; delete legacy.leaderboard;
  const raw = JSON.stringify(legacy); env.values.set(PROGRESS_SAVE_KEY, raw); env.move(2);
  env.fail(true); assert.throws(()=>env.restart(), /disk full/);
  assert.equal(env.values.get(PROGRESS_BACKUP_KEY), raw);
  env.values.set(PROGRESS_SAVE_KEY, 'broken'); env.fail(false);
  const recovered = env.restart(); assert.equal(recovered.recoveredBackup, true);
  assert.deepEqual(recovered.snapshot().clearedLevels, [1]);
  const ranking = recovered.snapshot().leaderboard;
  assert.deepEqual(env.restart().snapshot().leaderboard, ranking);
});

test('growth caps opponents at sixty and turnover keeps newcomers behind a completed board', () => {
  const env = setup(); const state = env.progress.snapshot().leaderboard;
  for (const bot of state.opponents) { bot.cleared = 59; bot.pace = 2; }
  const certain = {...config, highProgressMultiplier:1, growth:config.growth.map(pace=>({...pace,chance:1}))};
  const now = PROGRESS_CALENDAR_START + 2 * DAY + 12 * 3600000;
  advanceLeaderboard(state, 60, now, certain);
  const newcomers = state.opponents.filter(bot=>state.newIds.includes(bot.id));
  assert.ok(newcomers.length >= 6 && newcomers.length <= 9);
  assert.ok(newcomers.every(bot=>bot.cleared === 59));
  assert.ok(state.opponents.filter(bot=>!state.newIds.includes(bot.id)).every(bot=>bot.cleared === 60));
  const survivors = state.opponents.filter(bot=>bot.cleared === 60).map(bot=>({...bot}));
  advanceLeaderboard(state, 60, now + DAY, certain);
  for (const old of survivors) assert.deepEqual(state.opponents.find(bot=>bot.id===old.id), old);
});
