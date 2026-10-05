import assert from 'node:assert/strict';
import test from 'node:test';
import { PlayerProgress } from '../../assets/Colony/scripts/application/playerProgress';
import { SocialPresentation } from '../../assets/Colony/scripts/presentation/social/socialPresentation';
import { leaderboardTestConfig, socialTestConfig } from '../support/leaderboardTestConfig';

function setup(count = 3) {
  const values = new Map<string,string>(); let now = Date.parse('2026-10-04T12:00:00+08:00'); let writes = 0;
  const progress = new PlayerProgress({ read: key => values.get(key) ?? null, write: (key,value) => { writes++; values.set(key,value); } }, { now: () => now }, leaderboardTestConfig, socialTestConfig);
  for (let level = 1; level <= count; level++) progress.settleRound(progress.startRound(level).id, 'SUCCESS', 100);
  return { progress, get writes() { return writes; }, hours(hours: number) { now += hours * 3600000; },
    page: new SocialPresentation(progress, socialTestConfig, leaderboardTestConfig) };
}

test('partner projection and all its reads are pure, including across midnight', () => {
  const env = setup(); const first = env.page.read(); const writes = env.writes;
  assert.equal(first.layout, 'social'); assert.equal(first.social!.cards.length, 50);
  env.hours(24); assert.deepEqual(env.page.read(), first); assert.equal(env.writes, writes);
});

test('visiting a partner projects their own collection prefix without changing the player collection', () => {
  const env = setup(); const before = env.progress.snapshot().clearedLevels;
  const partner = env.progress.readSocial().partners.find(bot => bot.cleared >= 12 && bot.cleared < 48)!;
  env.page.openPartner(partner.id); const page = env.page.read(); const profile = page.social!.profile!;
  assert.equal(profile.partner.id, partner.id); assert.equal(profile.partner.cleared, partner.cleared);
  assert.equal(profile.theme.themeIndex, Math.floor(partner.cleared / 12));
  assert.equal(profile.theme.cleared, partner.cleared % 12);
  env.page.act('theme:0'); const first = env.page.read().social!.profile!;
  assert.equal(first.theme.cleared, 12); assert.ok(first.theme.items.every(item => item.count === item.target));
  assert.deepEqual(env.progress.snapshot().clearedLevels, before);
  assert.throws(() => env.page.act('theme:5'), /尚未解锁/);
});

test('fixed messages, follow and request actions update button states and return feedback', () => {
  const env = setup(); const id = env.progress.readSocial().partners[0]!.id;
  env.page.act(`profile:${id}`); env.page.act('follow'); env.page.act('like'); env.page.act('messages');
  assert.equal(env.page.read().social!.cards.length, 6); env.page.act('message:1');
  const profile = env.page.read().social!.profile!;
  assert.equal(profile.partner.followed, true); assert.equal(profile.liked, true); assert.equal(profile.commented, true);
  env.page.act('request'); assert.equal(env.page.read().social!.profile!.canRequest, false);
  env.page.act('tab:help'); assert.equal(env.page.read().social!.cards[0]!.enabled, false);
  env.hours(31); env.progress.advanceSocial(); env.page.act('tab:help');
  assert.equal(env.page.read().social!.cards[0]!.action, 'claim'); assert.equal(env.page.read().social!.cards[0]!.enabled, true);
  env.page.act('claim'); assert.equal(env.progress.snapshot().supplyTokens, 1);
});

test('the help page uses actual daily requests and history read acknowledgement clears only the unread badge', () => {
  const env = setup(); const id = env.progress.readSocial().partners[0]!.id;
  env.page.act(`profile:${id}`); env.page.act('message:0'); env.hours(31); env.progress.advanceSocial();
  assert.ok(env.progress.readSocial().unread > 0);
  const history = env.progress.readSocial().history; env.page.act('tab:history');
  assert.equal(env.progress.readSocial().unread, 0); assert.deepEqual(env.progress.readSocial().history, history);
  env.page.act('tab:help'); const request = env.progress.readSocial().helpRequests[0]!;
  assert.equal(env.page.act(`help:${request.id}`), '援助已送出，获得10金币');
  assert.equal(env.page.read().social!.cards.find(card => card.action === `help:${request.id}`)!.enabled, false);
});

test('clock rollback permits profile, theme and history browsing while disabling all write actions', () => {
  const env = setup(); const id = env.progress.readSocial().partners[0]!.id;
  env.hours(-24); const writes = env.writes;
  env.page.openPartner(id); const profile = env.page.read().social!.profile!;
  assert.equal(profile.partner.id, id); assert.equal(profile.canInteract, false);
  assert.equal(profile.canRequest, false); assert.equal(profile.canFollow, false);
  env.page.act('theme:0'); env.page.act('back'); env.page.act('tab:history');
  assert.equal(env.writes, writes); assert.equal(env.page.read().social!.tab, 'history');
});
