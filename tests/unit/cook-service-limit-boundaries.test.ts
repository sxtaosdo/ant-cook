import assert from 'node:assert/strict';
import test from 'node:test';
import { KitchenRun } from '../../assets/bundles/game/core/KitchenRun';
import { KitchenRulesReader } from '../../assets/bundles/game/core/kitchenRules';
import { LEVELS } from '../../assets/bundles/game/core/content';

// Synthetic contract fixtures only: these values do not assert original-game tuning.
function rawRules() {
  return {
    schema: 'cook-kitchen-rules-v1', source: 'synthetic-service-limit-boundaries-not-original-tuning', restaurantId: 'r01',
    stations: [{ id: 'hot', label: 'Test station', upgradeId: 'grill', capacityByLevel: [1], timeMultipliers: [1], upgradePrices: [] }],
    recipes: [{ dishId: 'test-dish', label: 'Test dish', stationId: 'hot', cookSeconds: 1, burnAfterSeconds: null as number | null,
      coinsByLevel: [5], upgradeId: 'ingredient-test', upgradePrices: [] }],
    customers: { count: 3, activeCapacity: 2, itemsPerCustomer: 3, patienceSeconds: 20, partialServeRecoverySeconds: 3 },
    combo: { windowSeconds: 4, bonusCoins: [0] },
    limits: { maxBurnt: null as number | null, maxDiscarded: null as number | null, maxLost: null as number | null },
    goal: { mode: 'customers', metric: 'customers', target: 'all', starRatios: [1, 1, 1], keepEarningsOnFailure: false },
  };
}
const createRun = (raw = rawRules()) => new KitchenRun(LEVELS[0]!, 'service-boundary', { rules: KitchenRulesReader.parse(raw), upgrades: {} });
function cook(run: KitchenRun) {
  run.startCooking('test-dish'); run.tick(1);
  return run.snapshot.production!.slots.find(slot => slot.state === 'Ready')!.id;
}

test('partial delivery restores the actual recovery amount only to its customer and caps recovery at patienceMax', () => {
  const run = createRun(); run.tick(8);
  const slotId = cook(run), before = run.snapshot.production!;
  const customer = before.customers[0]!;
  assert.equal(customer.patienceRemaining, 11);
  run.serveReady(slotId, customer.id);
  const after = run.snapshot.production!;
  assert.equal(after.customers[0]!.patienceRemaining, 14);
  assert.equal(after.customers[0]!.state, 'Active');
  assert.deepEqual(after.customers[0]!.items.map(item => item.state), ['Served', 'Pending', 'Pending']);
  assert.equal(after.customers[1]!.patienceRemaining, 11);
  assert.equal(after.customers[2]!.state, 'Waiting');
  assert.equal(after.customers[2]!.patienceRemaining, 20);
  const cappedRaw = rawRules(); cappedRaw.customers.partialServeRecoverySeconds = 100;
  const capped = createRun(cappedRaw); capped.tick(8);
  capped.serveReady(cook(capped), capped.snapshot.production!.customers[0]!.id);
  assert.equal(capped.snapshot.production!.customers[0]!.patienceRemaining, 20);
});

test('a partly served customer expires once, preserves served items, and gives the next customer its full patience', () => {
  const raw = rawRules(); raw.customers.activeCapacity = 1; raw.customers.itemsPerCustomer = 2;
  raw.customers.patienceSeconds = 5; raw.customers.partialServeRecoverySeconds = 1;
  const run = createRun(raw); run.tick(2); const slot = cook(run);
  run.serveReady(slot, run.snapshot.production!.customers[0]!.id);
  assert.equal(run.snapshot.production!.customers[0]!.patienceRemaining, 3);
  run.tick(3);
  const after = run.snapshot.production!;
  assert.equal(run.snapshot.lostCustomers, 1);
  assert.equal(run.snapshot.servedOrders, 1);
  assert.equal(after.customers[0]!.state, 'Lost');
  assert.deepEqual(after.customers[0]!.items.map(item => item.state), ['Served', 'Expired']);
  assert.equal(after.customers[1]!.state, 'Active'); assert.equal(after.customers[1]!.patienceRemaining, 5);
  run.tick(1);
  assert.equal(run.snapshot.lostCustomers, 1); assert.equal(run.snapshot.servedOrders, 1);
});

for (const kind of ['burnt', 'discarded', 'lost'] as const) {
  test(`${kind} limit permits exactly one event and fails on the second without allowing later mutation`, () => {
    const raw = rawRules(); raw.customers.activeCapacity = 1; raw.customers.patienceSeconds = kind === 'lost' ? 3 : 100;
    if (kind === 'burnt') { raw.limits.maxBurnt = 1; raw.recipes[0]!.burnAfterSeconds = 2; }
    if (kind === 'discarded') raw.limits.maxDiscarded = 1;
    if (kind === 'lost') raw.limits.maxLost = 1;
    const run = createRun(raw);
    const trigger = () => {
      if (kind === 'lost') { run.tick(3); return; }
      if (kind === 'discarded') { run.discardFood(cook(run)); return; }
      run.startCooking('test-dish'); run.tick(3);
    };
    trigger(); assert.equal(run.snapshot.status, 'Running');
    assert.equal(kind === 'lost' ? run.snapshot.lostCustomers : kind === 'burnt' ? run.snapshot.production!.burntCount : run.snapshot.production!.discardedCount, 1);
    if (kind === 'burnt') run.discardFood(run.snapshot.production!.slots[0]!.id);
    trigger(); assert.equal(run.snapshot.status, 'Failed');
    assert.equal(run.snapshot.failureReason, { burnt: 'BURNT_LIMIT', discarded: 'DISCARD_LIMIT', lost: 'TOO_MANY_LOST' }[kind]);
    const terminal = JSON.stringify(run.snapshot);
    for (const command of [() => run.tick(1), () => run.startCooking('test-dish'), () => run.serveReady('hot-slot-1'), () => run.discardFood('hot-slot-1'), () => run.addTopping('hot-slot-1', 'unknown')]) {
      assert.throws(command, { name: 'Error', message: '\u672c\u5c40\u5df2\u7ed3\u675f' }); assert.equal(JSON.stringify(run.snapshot), terminal);
    }
  });
}

test('simultaneous burn and customer expiry obey the same current failure precedence for large and small frames', () => {
  const raw = rawRules(); raw.customers.activeCapacity = 1; raw.customers.patienceSeconds = 3;
  raw.recipes[0]!.burnAfterSeconds = 2; raw.limits.maxBurnt = 0; raw.limits.maxLost = 0;
  const large = createRun(raw), small = createRun(raw);
  large.startCooking('test-dish'); small.startCooking('test-dish');
  large.tick(10); for (let i = 0; i < 3; i++) small.tick(1);
  assert.deepEqual(large.snapshot, small.snapshot);
  assert.equal(large.snapshot.failureReason, 'BURNT_LIMIT');
  assert.equal(large.snapshot.production!.burntCount, 1); assert.equal(large.snapshot.lostCustomers, 1);
  assert.equal(large.snapshot.production!.elapsedSeconds, 3);
});
