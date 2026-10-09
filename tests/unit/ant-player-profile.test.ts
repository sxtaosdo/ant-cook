import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PlayerProfile, PROFILE_SAVE_KEY } from '../../assets/Colony/scripts/application/playerProfile';
import type { LeaderboardEntry } from '../../assets/Colony/scripts/application/leaderboard/leaderboard';

const id = `local-${'a'.repeat(32)}`;
function fixture(legacy = false) {
  const stored = new Map<string, string>();
  let fail = false;
  const port = { read: (key: string) => stored.get(key) ?? null,
    write: (key: string, value: string) => { if (fail) throw new Error('disk failure'); stored.set(key, value); } };
  const make = (old = legacy) => new PlayerProfile(port, 6, () => id, () => 1000, old);
  return { stored, make, fail: (value: boolean) => { fail = value; } };
}
test('local profile preserves identity, creation date and edits across restart', () => {
  const f = fixture(); const profile = f.make();
  profile.save('  芒果摊主  ', 5);
  assert.deepEqual(f.make().snapshot(), { playerId: id, nickname: '芒果摊主', avatar: 5, registeredAt: 1000 });
});
test('legacy local player does not receive a fabricated registration time', () => {
  const f = fixture(true); const profile = f.make();
  assert.equal(profile.snapshot().registeredAt, null);
  profile.save('旧玩家', 1);
  assert.equal(f.make(false).snapshot().registeredAt, null);
});
test('failed profile save publishes no edit, retry retains ID and registration', () => {
  const f = fixture(); const profile = f.make(); const before = profile.snapshot();
  f.fail(true); assert.throws(() => profile.save('修改失败', 2), /disk failure/);
  assert.deepEqual(profile.snapshot(), before);
  f.fail(false); profile.save('修改成功', 2);
  assert.equal(f.make().snapshot().playerId, before.playerId);
  assert.equal(f.make().snapshot().registeredAt, before.registeredAt);
});
test('nickname and avatar validation rejects blank, unsafe and oversized edits without writing', () => {
  const f = fixture(); const profile = f.make(); const saved = f.stored.get(PROFILE_SAVE_KEY);
  for (const nickname of ['   ', '昵称\n换行', '<color>昵称', 'x'.repeat(13), '昵称\u200b']) assert.throws(() => profile.save(nickname, 0));
  for (const avatar of [-1, 6, 1.5, NaN]) assert.throws(() => profile.save('有效昵称', avatar));
  assert.equal(f.stored.get(PROFILE_SAVE_KEY), saved);
  profile.save('😀'.repeat(12), 0);
  assert.equal([...profile.snapshot().nickname].length, 12);
});
test('self projection uses stable identity and leaves a same-name partner unchanged', () => {
  const f = fixture(); const profile = f.make(); profile.save('同名', 2);
  const entry: LeaderboardEntry = { id: 'self', name: '同名', avatarColor: '#000000', cleared: 3, reachedAt: 1000, rank: 1, change: 0, isNew: false, isSelf: true };
  const bot = { ...entry, id: 'bot-1', isSelf: false };
  const projected = profile.leaderboard([entry, bot], ['#111111', '#222222', '#333333']);
  assert.equal(projected[0].id, id); assert.equal(projected[0].avatarColor, '#333333');
  assert.deepEqual(projected[1], bot); assert.equal(entry.id, 'self');
});

test('display ID is stable and bounded while collisions retain distinct full identities', () => {
  const other = `local-${'b'.repeat(19)}${'a'.repeat(13)}`;
  const short = PlayerProfile.displayId(id);
  assert.match(short, /^[0-9a-z]{10}$/);
  assert.equal(PlayerProfile.displayId(id), short);
  assert.equal(PlayerProfile.displayId(other), short);
  const f = fixture(); const first = f.make();
  const second = new PlayerProfile({ read: () => null, write: () => {} }, 6, () => other, () => 2000, false);
  const entry: LeaderboardEntry = { id: 'self', name: '我', avatarColor: '#000000', cleared: 3, reachedAt: 1000, rank: 1, change: 0, isNew: false, isSelf: true };
  assert.equal(first.leaderboard([entry], ['#ffffff'])[0].id, id);
  assert.equal(second.leaderboard([entry], ['#ffffff'])[0].id, other);
  assert.equal(JSON.parse(f.stored.get(PROFILE_SAVE_KEY)!).playerId, id);
  assert.equal(f.make().snapshot().playerId, id);
});
test('unreadable persisted profile reports failure instead of replacing identity', () => {
  const f = fixture(); f.stored.set(PROFILE_SAVE_KEY, JSON.stringify({ playerId: 'broken' }));
  assert.throws(() => f.make(), /无法读取/);
  assert.equal(JSON.parse(f.stored.get(PROFILE_SAVE_KEY)!).playerId, 'broken');
});
test('corrupt registration dates are rejected without replacing the stored profile', () => {
  const f = fixture();
  for (const registeredAt of [Number.MAX_SAFE_INTEGER, Date.UTC(10000, 0, 1), -1]) {
    const encoded = JSON.stringify({ playerId: id, nickname: '旧玩家', avatar: 0, registeredAt });
    f.stored.set(PROFILE_SAVE_KEY, encoded);
    assert.throws(() => f.make(), /无法读取/);
    assert.equal(f.stored.get(PROFILE_SAVE_KEY), encoded);
  }
});
