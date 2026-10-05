import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { InstallationIdentity, INSTALLATION_ID_KEY, INSTALLATION_ID_BACKUP_KEY } from '../../assets/Colony/scripts/application/installationIdentity';
import { PlayerProgress, PROGRESS_SAVE_KEY } from '../../assets/Colony/scripts/application/playerProgress';
import { SpeedBoostSession, FREE_BOOST_MS } from '../../assets/Colony/scripts/application/speedBoost';
import { GmTestProfile } from '../../assets/Colony/scripts/testing/gmTestProfile';
import { readLevelDifficulty } from '../../assets/Colony/scripts/application/levelDifficulty';
import { ColonyFlowModel } from '../../assets/Colony/scripts/gameModel';
import { leaderboardTestConfig, socialTestConfig } from '../support/leaderboardTestConfig';

test('installation ID is durable and restores from backup without regeneration', () => {
  const values = new Map<string, string>(); let generations = 0;
  const port = { read: (key: string) => values.get(key) ?? null, write: (key: string, value: string) => { values.set(key, value); } };
  const random = () => { generations++; return new Uint8Array(16).fill(15); };
  const first = new InstallationIdentity(port, random).read();
  assert.match(first!, /^[a-f0-9-]{36}$/);
  assert.equal(new InstallationIdentity(port, random).read(), first);
  values.set(INSTALLATION_ID_KEY, 'damaged');
  assert.equal(new InstallationIdentity(port, random).read(), first);
  assert.equal(values.get(INSTALLATION_ID_KEY), first); assert.equal(generations, 1);
  values.clear(); new InstallationIdentity(port, random).read(); assert.equal(generations, 2);
});

test('failed identity persistence retries the same candidate and exposes no unsaved identity', () => {
  const values = new Map<string, string>(); let fail = true, generations = 0;
  const port = { read: (key: string) => values.get(key) ?? null, write: (key: string, value: string) => {
    if (fail && key === INSTALLATION_ID_KEY) throw new Error('full'); values.set(key, value);
  } };
  const identity = new InstallationIdentity(port, () => { generations++; return new Uint8Array(16).fill(10); });
  assert.equal(identity.read(), null); const candidate = values.get(INSTALLATION_ID_BACKUP_KEY);
  assert.equal(identity.read(), null); fail = false;
  assert.equal(identity.read(), candidate); assert.equal(generations, 1);
});

function profile() {
  const memory = new Map<string, string>(); let fail = false;
  const port = { read: (key: string) => memory.get(key) ?? null, write: (key: string, value: string) => {
    if (fail && key === PROGRESS_SAVE_KEY) throw new Error('full'); memory.set(key, value);
  } };
  const now = () => Date.parse('2026-10-04T12:00:00+08:00');
  return { memory, now, progress: new PlayerProgress(port, { now }, leaderboardTestConfig, socialTestConfig), fail: (value: boolean) => { fail = value; } };
}

test('free finish is threefold with a zero budget and never reserves or spends time', () => {
  let reserves = 0;
  const boost = new SpeedBoostSession({ readSpeedBoost: () => ({ day: 'today', remainingMs: 0 }), reserveSpeedBoost: () => {
    reserves++; return { day: 'today', ms: 0 };
  }, refundSpeedBoost: () => assert.fail('no lease') });
  boost.startFreeFinish(); boost.advance(60000, true); boost.cycle(true);
  assert.equal(boost.source, 'freeFinish'); assert.equal(boost.multiplier, 3); assert.equal(reserves, 0);
  boost.stop(); assert.equal(boost.multiplier, 1); assert.equal(boost.source, 'manual');
});

test('free finish immediately stops paid usage and retries failed refund exactly once', () => {
  const f = profile(), boost = new SpeedBoostSession(f.progress);
  boost.cycle(true); boost.advance(250, true); f.fail(true);
  assert.throws(() => boost.startFreeFinish(), /full/);
  assert.equal(boost.multiplier, 3); assert.equal(boost.source, 'freeFinish');
  assert.equal(boost.read().remainingMs, FREE_BOOST_MS - 250);
  assert.throws(() => boost.advance(1000, true), /full/); f.fail(false);
  boost.advance(60000, true); boost.advance(60000, true); boost.stop();
  assert.equal(f.progress.readSpeedBoost().remainingMs, FREE_BOOST_MS - 250);
});

test('navigation refund failures retain the lease for a later retry', () => {
  const f = profile(), boost = new SpeedBoostSession(f.progress);
  boost.cycle(true); boost.advance(250, true); f.fail(true);
  assert.throws(() => boost.stop(), /full/); assert.equal(boost.read().remainingMs, FREE_BOOST_MS - 250);
  f.fail(false); boost.stop(); boost.stop(); assert.equal(f.progress.readSpeedBoost().remainingMs, FREE_BOOST_MS - 250);
});

test('GM clone unlocks navigation without clearing levels or changing real save and rewards', () => {
  const f = profile(), original = f.memory.get(PROGRESS_SAVE_KEY);
  assert.throws(() => f.progress.startRound(7), /先完成/);
  assert.throws(() => f.progress.applyTestResources('coins'), /isolated/);
  const gm = new GmTestProfile(f.progress.snapshot(), leaderboardTestConfig, socialTestConfig, f.now);
  const before = gm.progress.snapshot(); gm.progress.startRound(7);
  assert.deepEqual(gm.progress.snapshot().clearedLevels, before.clearedLevels);
  assert.equal(gm.progress.snapshot().coins, before.coins);
  assert.deepEqual(gm.progress.snapshot().rewardLedger, before.rewardLedger);
  gm.progress.applyTestResources('coins'); gm.progress.applyTestResources('diamonds');
  gm.progress.reserveSpeedBoost(1000); gm.progress.applyTestResources('speed');
  assert.equal(gm.progress.snapshot().coins, before.coins + 1000);
  assert.equal(gm.progress.snapshot().diamonds, before.diamonds + 100);
  assert.equal(gm.progress.readSpeedBoost().remainingMs, FREE_BOOST_MS);
  const round = gm.progress.startRound(1); gm.progress.settleRound(round.id, 'SUCCESS', 10);
  assert.equal(f.memory.get(PROGRESS_SAVE_KEY), original);
  assert.throws(() => gm.progress.startRound(61), /不存在/);
});

test('GM topping up does not discard already granted boost time', () => {
  const f = profile(), gm = new GmTestProfile(f.progress.snapshot(), leaderboardTestConfig, socialTestConfig, f.now);
  gm.progress.grantSpeedBoostReward('test-only'); const before = gm.progress.readSpeedBoost().remainingMs;
  gm.progress.applyTestResources('speed'); assert.equal(gm.progress.readSpeedBoost().remainingMs, before);
});

test('queue exhaustion includes every hidden group and occurs after the last selection', () => {
  const model = new ColonyFlowModel({ levels: [{ level: 1, sourceId: 'test', shape: 'PROVISIONAL_ORANGE_POP', rows: 1, columns: 2,
    cells: [{ id: 'a', row: 0, column: 0, color: 'berry' }, { id: 'b', row: 0, column: 1, color: 'leaf' }],
    groups: [{ id: 'first', color: 'berry', count: 1, pile: 0, depth: 0 }, { id: 'hidden', color: 'leaf', count: 1, pile: 0, depth: 1 }] }] });
  assert.equal(model.selectableQueueExhausted, false);
  model.selectStack('first'); assert.equal(model.selectableQueueExhausted, false);
  model.selectStack('hidden'); assert.equal(model.selectableQueueExhausted, true);
  model.reset(1); assert.equal(model.selectableQueueExhausted, false);
});

test('runtime difficulty projects the existing authority without changing level patterns', () => {
  const config = JSON.parse(readFileSync(new URL('../../assets/Colony/config/level-difficulty.json', import.meta.url), 'utf8'));
  const kinds = readLevelDifficulty(config); assert.equal(kinds.size, 60); assert.equal(kinds.get(1), 'E'); assert.equal(kinds.get(7), 'H');
  assert.throws(() => readLevelDifficulty(config.slice(1)), /60/);
  config[6].kind = 'unknown'; assert.throws(() => readLevelDifficulty(config), /难度无效/);
});
