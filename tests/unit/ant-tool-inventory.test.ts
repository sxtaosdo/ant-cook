import assert from 'node:assert/strict';
import test from 'node:test';
import { PlayerProgress, PROGRESS_SAVE_KEY, PROGRESS_BACKUP_KEY, PROGRESS_CALENDAR_START, type ProgressSavePort } from '../../assets/Colony/scripts/application/playerProgress';
import { ColonyFlowModel } from '../../assets/Colony/scripts/gameModel';
import { createOperationalCatalog } from '../../assets/Colony/scripts/application/operationalLevels';
import { leaderboardTestConfig, socialTestConfig } from '../ant/support/leaderboardTestConfig';
function setup() {
  const values = new Map<string, string>(); let fail = false;
  const save: ProgressSavePort = { testOnly: true, read: key => values.get(key) ?? null,
    write: (key, value) => { if (fail && key === PROGRESS_SAVE_KEY) throw Error('disk full'); values.set(key, value); } };
  const clock = { now: () => PROGRESS_CALENDAR_START };
  let p = new PlayerProgress(save, clock, leaderboardTestConfig, socialTestConfig);
  p.applyTestResources('coins');
  return { get p() { return p; }, values, fail: (value: boolean) => { fail = value; },
    restart: () => p = new PlayerProgress(save, clock, leaderboardTestConfig, socialTestConfig) };
}
test('40/60 coin products persist stock and idempotent receipts without changing diamonds', () => {
  const f = setup();
  assert.equal(f.p.buyStoredTool('trowel', 'purchase-a'), true);
  assert.equal(f.p.buyStoredTool('trowel', 'purchase-a'), false);
  assert.throws(() => f.p.buyStoredTool('compass', 'purchase-a'), /其他商品/);
  assert.equal(f.p.buyStoredTool('compass', 'purchase-b'), true);
  const s = f.restart().snapshot(); assert.equal(s.coins, 900); assert.equal(s.diamonds, 0);
  assert.deepEqual(s.toolInventory, { trowel: 1, compass: 1 }); assert.equal(Object.keys(s.toolTransactions).length, 2);
});
test('failed primary purchase leaves coins stock and receipt unchanged and same request can retry', () => {
  const f = setup(), before = f.p.snapshot(); f.fail(true);
  assert.throws(() => f.p.buyStoredTool('trowel', 'purchase-a'), /disk full/);
  assert.deepEqual(f.p.snapshot(), before); f.fail(false);
  assert.equal(f.p.buyStoredTool('trowel', 'purchase-a'), true); assert.equal(f.restart().snapshot().coins, 960);
});
test('stock use shares the persisted round cap with diamonds and is idempotent', () => {
  const f = setup(); f.p.buyStoredTool('trowel', 'purchase-a'); f.p.buyStoredTool('compass', 'purchase-b'); f.p.claimStarterDiamonds();
  const round = f.p.startRound(1, 'main');
  assert.equal(f.p.consumeStoredTool(round.id, 'trowel', true), true);
  assert.equal(f.p.consumeStoredTool(round.id, 'trowel', true), false);
  assert.throws(() => f.p.consumeStoredTool(round.id, 'compass', true), /已用完/);
  assert.throws(() => f.p.buyExtraSupply(round.id, 'compass', 'diamond'));
  const s = f.restart().snapshot(); assert.equal(s.diamonds, 30); assert.equal(s.rounds[round.id].extraSupply, true);
  assert.deepEqual(s.toolInventory, { trowel: 0, compass: 1 });
});
test('no target, failed save, settled round and empty stock never consume inventory', () => {
  const f = setup(); f.p.buyStoredTool('trowel', 'purchase-a'); const r = f.p.startRound(1, 'main'); const before = f.p.snapshot();
  assert.throws(() => f.p.consumeStoredTool(r.id, 'trowel', false)); assert.deepEqual(f.p.snapshot(), before);
  f.fail(true); assert.throws(() => f.p.consumeStoredTool(r.id, 'trowel', true)); assert.deepEqual(f.p.snapshot(), before);
  f.fail(false); assert.throws(() => f.p.consumeStoredTool(r.id, 'compass', true));
  f.p.settleRound(r.id, 'FAIL', 0); assert.throws(() => f.p.consumeStoredTool(r.id, 'trowel', true));
  assert.equal(f.p.snapshot().toolInventory.trowel, 1);
});
test('existing diamond supply blocks permanent supply in the same round', () => {
  const f = setup(); f.p.buyStoredTool('trowel', 'purchase-a'); f.p.claimStarterDiamonds(); const r = f.p.startRound(1, 'main');
  f.p.buyExtraSupply(r.id, 'trowel', 'diamond'); assert.throws(() => f.p.consumeStoredTool(r.id, 'trowel', true));
  assert.equal(f.p.snapshot().toolInventory.trowel, 1); assert.equal(f.p.snapshot().diamonds, 20);
});
test('game target gate keeps free use first, then one stored use, and never a seventh slot', () => {
  const f = setup(); f.p.buyStoredTool('trowel', 'purchase-a'); const round = f.p.startRound(1, 'main');
  const game = new ColonyFlowModel(createOperationalCatalog()); game.reset(1);
  assert.throws(() => f.p.consumeStoredTool(round.id, 'trowel', game.canUseExtraSupply('trowel')));
  game.useTrowel(); assert.equal(f.p.snapshot().toolInventory.trowel, 1);
  assert.equal(f.p.consumeStoredTool(round.id, 'trowel', game.canUseExtraSupply('trowel')), true); game.useExtraSupply('trowel');
  assert.equal(game.canUseExtraSupply('trowel'), false); game.useExtraSlot(); assert.equal(game.addExtraSlot(), false);
  assert.throws(() => f.p.buyStoredTool('slot' as 'trowel', 'purchase-slot')); assert.equal(game.snapshot().slots.length, 6);
});
test('old v6 saves default to zero stock and invalid inventory retains corrupt raw data', () => {
  const f = setup(); const s = f.p.snapshot() as unknown as Record<string, unknown>; delete s.toolInventory; delete s.toolTransactions;
  f.values.set(PROGRESS_SAVE_KEY, JSON.stringify(s)); assert.deepEqual(f.restart().snapshot().toolInventory, { trowel: 0, compass: 0 });
  const broken = { ...f.p.snapshot(), toolInventory: { trowel: -1, compass: 0 } }; const raw = JSON.stringify(broken);
  f.values.set(PROGRESS_SAVE_KEY, raw); f.values.set(PROGRESS_BACKUP_KEY, raw); assert.throws(() => f.restart(), /存档损坏/);
  assert.equal(f.values.get(PROGRESS_SAVE_KEY), raw);
});
