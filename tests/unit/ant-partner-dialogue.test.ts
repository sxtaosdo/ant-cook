import assert from 'node:assert/strict';
import test from 'node:test';
import { PlayerProgress, PROGRESS_SAVE_KEY, PROGRESS_BACKUP_KEY, PROGRESS_CALENDAR_START, type ProgressSavePort } from '../../assets/Colony/scripts/application/playerProgress';
import { SocialPresentation } from '../../assets/Colony/scripts/presentation/social/socialPresentation';
import { readCollectionObject } from '../../assets/Colony/scripts/application/collectionObject';
import { leaderboardTestConfig, socialTestConfig } from '../ant/support/leaderboardTestConfig';
function setup(clears = 3) {
  const values = new Map<string, string>(); let fail = false, now = PROGRESS_CALENDAR_START;
  const save: ProgressSavePort = { read: key => values.get(key) ?? null, write: (key, value) => { if (fail && key === PROGRESS_SAVE_KEY) throw Error('disk full'); values.set(key, value); } };
  const clock = { now: () => now }; let p = new PlayerProgress(save, clock, leaderboardTestConfig, socialTestConfig);
  for (let level = 1; level <= clears; level++) p.settleRound(p.startRound(level).id, 'SUCCESS', 1);
  return { get p() { return p; }, values, fail: (value: boolean) => { fail = value; },
    restart: () => p = new PlayerProgress(save, clock, leaderboardTestConfig, socialTestConfig),
    nextDays: () => { now += leaderboardTestConfig.turnoverDays * 86400000; p = new PlayerProgress(save, clock, leaderboardTestConfig, socialTestConfig); } };
}
test('dialogue binds one selected existing system partner and keeps their saved identity across turnover', () => {
  const f = setup(), partners = f.p.readSocial().partners, chosen = partners.at(-1)!;
  assert.throws(() => f.p.beginPartnerDialogue('unknown')); f.p.beginPartnerDialogue(chosen.id);
  const original = f.restart().readPartnerDialogue()!; assert.deepEqual(original.partner, { id: chosen.id, name: chosen.name, avatar: chosen.avatar });
  f.p.beginPartnerDialogue(chosen.id); assert.throws(() => f.p.beginPartnerDialogue(partners[0]!.id), /绑定/);
  for (let attempt = 0; attempt < 30 && f.p.readSocial().partners.some(p => p.id === chosen.id); attempt++) f.nextDays();
  assert.ok(!f.p.readSocial().partners.some(p => p.id === chosen.id)); assert.deepEqual(f.p.readPartnerDialogue(), original);
  const page = new SocialPresentation(f.p, socialTestConfig, leaderboardTestConfig); page.act('dialogue-resume');
  assert.match(page.read().title, new RegExp(chosen.name)); assert.match(page.read().summary, /系统伙伴.*固定/);
});
test('fixed dialogue enforces order and atomically saves the shared target before advancing', () => {
  const f = setup(); f.p.trackObject('mango'); f.p.beginPartnerDialogue(f.p.readSocial().partners[0]!.id);
  assert.throws(() => f.p.advancePartnerDialogue('track'), /顺序/); f.p.advancePartnerDialogue('ask'); f.p.advancePartnerDialogue('source');
  f.p.trackObject('banana'); const before = f.p.snapshot(); f.fail(true);
  assert.throws(() => f.p.advancePartnerDialogue('track'), /disk full/); assert.deepEqual(f.p.snapshot(), before);
  f.fail(false); f.p.advancePartnerDialogue('track'); assert.equal(f.restart().snapshot().trackedObjectId, 'mango'); assert.equal(f.p.readPartnerDialogue()?.step, 3);
  assert.equal(f.p.advancePartnerDialogue('track'), false); assert.throws(() => f.p.advancePartnerDialogue('complete'), /尚未完成/);
});
test('completion reads the player collection, saves once and grants no extra coins or simulated message', () => {
  const f = setup(); f.p.trackObject('mango'); const actor = f.p.readSocial().partners.find(p => p.cleared >= 12)!; f.p.beginPartnerDialogue(actor.id);
  for (const action of ['ask', 'source', 'track'] as const) f.p.advancePartnerDialogue(action);
  assert.throws(() => f.p.advancePartnerDialogue('complete'), /尚未完成/);
  const end = readCollectionObject([], 'mango')!.sourceLevels.at(-1)!;
  for (let level = 4; level <= end; level++) f.p.settleRound(f.p.startRound(level).id, 'SUCCESS', 1);
  const before = f.p.snapshot(); f.fail(true); assert.throws(() => f.p.advancePartnerDialogue('complete'), /disk full/); assert.deepEqual(f.p.snapshot(), before);
  f.fail(false); assert.equal(f.p.advancePartnerDialogue('complete'), true); assert.equal(f.p.advancePartnerDialogue('complete'), false);
  const after = f.restart().snapshot(); assert.equal(after.coins, before.coins); assert.deepEqual(after.social.history, before.social.history); assert.equal(after.partnerDialogue?.step, 4);
});
test('existing six messages remain available and a separate fixed-flow card uses actual source and target', () => {
  const f = setup(), page = new SocialPresentation(f.p, socialTestConfig, leaderboardTestConfig), actor = f.p.readSocial().partners[0]!;
  f.p.trackObject('mango'); page.openPartner(actor.id); page.act('messages');
  const cards = page.read().social!.cards; assert.equal(cards.filter(card => card.action.startsWith('message:')).length, 6); assert.equal(cards[0]!.action, `dialogue-begin:${actor.id}`);
  page.act(cards[0]!.action); page.act('dialogue:ask'); assert.match(page.read().social!.cards[0]!.detail, /第 1、7 关/);
  page.act('dialogue:source'); page.act('dialogue:track'); assert.equal(f.p.snapshot().trackedObjectId, 'mango'); assert.equal(page.read().social!.cards[0]!.enabled, false);
  f.p.trackObject('banana'); assert.equal(page.read().social!.cards[0]!.action, 'dialogue-retrack'); page.act('dialogue-retrack'); assert.equal(f.p.snapshot().trackedObjectId, 'mango');
});
test('old saves default to no dialogue and corrupt actor or object references retain raw data', () => {
  const f = setup(), s = f.p.snapshot() as unknown as Record<string, unknown>; delete s.partnerDialogue;
  f.values.set(PROGRESS_SAVE_KEY, JSON.stringify(s)); assert.equal(f.restart().readPartnerDialogue(), null);
  const raw = JSON.stringify({ ...f.p.snapshot(), partnerDialogue: { partner: { id: 'bot-999999999', name: '小米', avatar: 0 }, objectId: 'mango', step: 2 } });
  f.values.set(PROGRESS_SAVE_KEY, raw); f.values.set(PROGRESS_BACKUP_KEY, raw); assert.throws(() => f.restart(), /存档损坏/); assert.equal(f.values.get(PROGRESS_SAVE_KEY), raw);
  const locked = setup(2); assert.throws(() => locked.p.beginPartnerDialogue(locked.p.readSocial().partners[0]!.id), /3关/);
});
test('the existing bot-0 identity survives beginning and advancing without backup recovery', () => {
  const f = setup(); assert.ok(f.p.readSocial().partners.some(p => p.id === 'bot-0'));
  f.p.beginPartnerDialogue('bot-0'); assert.equal(f.restart().readPartnerDialogue()?.partner.id, 'bot-0'); assert.equal(f.p.recoveredBackup, false);
  f.p.advancePartnerDialogue('ask'); f.p.advancePartnerDialogue('source');
  assert.equal(f.restart().readPartnerDialogue()?.step, 2); assert.equal(f.p.readPartnerDialogue()?.partner.id, 'bot-0'); assert.equal(f.p.recoveredBackup, false);
});
