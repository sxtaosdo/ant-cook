import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { KitchenRulesReader } from '../../assets/bundles/game/core/kitchenRules';
import { KitchenRun } from '../../assets/bundles/game/core/KitchenRun';
import { P10GameCore } from '../../assets/bundles/game/core/P10GameCore';
import { createDefaultSave } from '../../assets/bundles/game/core/SaveCodec';
import { LEVELS } from '../../assets/bundles/game/core/content';

const actual = () => JSON.parse(readFileSync(new URL('../../assets/bundles/game/resources/config/kitchen-rules.json', import.meta.url), 'utf8'));
function fixture() {
  // Capability fixture only: none of these topping prices is original-game tuning or production configuration.
  const raw = actual(); raw.source = 'synthetic-optional-topping-upgrade-not-original-parameters';
  raw.recipes = [raw.recipes[0]];
  raw.recipes[0].toppings[1].upgrade = { upgradeId: 'ingredient-fritter', coinsByLevel: [2, 4, 6], upgradePrices: [20, 30] };
  raw.recipes[0].orderToppingSets = [[], ['fritter'], ['sausage'], ['fritter', 'sausage']];
  raw.customers = { ...raw.customers, count: 4, itemsPerCustomer: 1, patienceSeconds: 1000 };
  raw.combo = { windowSeconds: 4, bonusCoins: [0, 1] };
  raw.goal = { ...raw.goal, target: 'all' };
  return raw;
}
function core(raw = fixture(), coins = 100) {
  const save = createDefaultSave(); save.coins = coins;
  const value = P10GameCore.load(JSON.stringify(save)); value.configureKitchenRules(KitchenRulesReader.parse(raw)); return value;
}
function deliver(run: KitchenRun) {
  const customer = run.snapshot.production!.customers.find(row => row.state === 'Active')!;
  const item = customer.items.find(row => row.state === 'Pending')!;
  run.startCooking(item.dishId); run.tick(3);
  const slot = run.snapshot.production!.slots.find(row => row.canServe && row.dishId === item.dishId)!;
  for (const id of item.toppingIds) run.addTopping(slot.id, id);
  run.serveReady(slot.id, customer.id);
}

test('optional topping tables are validated and IDs cannot collide with any upgrade owner', () => {
  const raw = fixture(), parsed = KitchenRulesReader.parse(raw);
  assert.deepEqual(parsed.recipes[0]!.toppings![1]!.upgrade, { upgradeId: 'ingredient-fritter', coinsByLevel: [2, 4, 6], upgradePrices: [20, 30] });
  raw.recipes[0].toppings[1].upgrade.coinsByLevel[0] = 999;
  assert.equal(parsed.recipes[0]!.toppings![1]!.upgrade!.coinsByLevel[0], 2, 'parser owns a copy of price data');
  const mutations = [
    (r: any) => { r.recipes[0].toppings[1].upgrade.coinsByLevel = []; },
    (r: any) => { r.recipes[0].toppings[1].upgrade.coinsByLevel = [2, -1, 6]; },
    (r: any) => { r.recipes[0].toppings[1].upgrade.coinsByLevel = [2, 3.5, 6]; },
    (r: any) => { r.recipes[0].toppings[1].upgrade.upgradePrices = [20]; },
    (r: any) => { delete r.recipes[0].toppings[1].upgrade.upgradeId; },
    (r: any) => { r.recipes[0].toppings[1].upgrade.upgradeId = 'grill'; },
    (r: any) => { r.recipes[0].toppings[1].upgrade.upgradeId = 'ingredient-jianbing'; },
    (r: any) => { r.recipes[0].toppings[0].upgrade = structuredClone(r.recipes[0].toppings[1].upgrade); },
  ];
  for (const mutate of mutations) { const bad = fixture(); mutate(bad); assert.throws(() => KitchenRulesReader.parse(bad)); }
});

test('topping upgrades reuse ingredient quotes, do not spend twice, stop at max and survive save reload', () => {
  const value = core();
  assert.equal(value.listUpgradeIds('r01').filter(id => id === 'ingredient-fritter').length, 1);
  assert.deepEqual(value.getUpgradeQuote('r01', 'ingredient-fritter').currentEffect, { coins: 2 });
  assert.deepEqual(value.getUpgradeQuote('r01', 'ingredient-fritter').nextEffect, { coins: 4 });
  const first = value.purchaseUpgrade('r01', 'ingredient-fritter', 'topping-first');
  assert.equal(first.applied, true); assert.equal(first.coinsSpent, 20); assert.equal(value.progress.coins, 80);
  assert.deepEqual(value.purchaseUpgrade('r01', 'ingredient-fritter', 'topping-first'), first);
  assert.equal(value.progress.coins, 80);
  const restored = P10GameCore.load(value.serialize()); restored.configureKitchenRules(KitchenRulesReader.parse(fixture()));
  assert.equal(restored.getUpgradeQuote('r01', 'ingredient-fritter').currentLevel, 2);
  assert.deepEqual(restored.getUpgradeQuote('r01', 'ingredient-fritter').currentEffect, { coins: 4 });
  assert.equal(restored.purchaseUpgrade('r01', 'ingredient-fritter', 'topping-second').coinsSpent, 30);
  const quote = restored.getUpgradeQuote('r01', 'ingredient-fritter');
  assert.equal(quote.nextLevel, null); assert.equal(quote.price, null); assert.equal(quote.nextEffect, null);
  const before = restored.progress.coins;
  assert.equal(restored.purchaseUpgrade('r01', 'ingredient-fritter', 'topping-max').applied, false);
  assert.equal(restored.progress.coins, before);
  const poor = core(fixture(), 19), denied = poor.purchaseUpgrade('r01', 'ingredient-fritter', 'poor');
  assert.equal(denied.applied, false); assert.equal(poor.progress.coins, 19); assert.equal(poor.getUpgradeQuote('r01', 'ingredient-fritter').currentLevel, 1);
});

test('only ordered and actually served toppings add their configured grade price; combo remains separate', () => {
  const value = core(); value.purchaseUpgrade('r01', 'ingredient-fritter', 'grade-two');
  const run = value.startLevel(LEVELS[0]!.id, 'topping-price-run');
  assert.deepEqual(run.snapshot.orders.map(row => row.baseScore), [5, 9, 5, 9]);
  assert.equal(run.snapshot.production!.goal.target, 24, 'all-coins initial-price demand includes configured topping base amounts');
  assert.equal('upgrade' in run.snapshot.production!.recipes[0]!.toppings[1]!, false, 'render projection must not leak nested mutable rule tables');
  for (let index = 0; index < 4; index++) deliver(run);
  assert.equal(run.snapshot.status, 'Completed');
  assert.equal(run.snapshot.production!.baseCoins, 28);
  assert.equal(run.snapshot.production!.comboCoins, 3);
  const settlement = value.settle(run, 'topping-settlement');
  assert.equal(settlement.coinsGranted, 31); assert.equal(value.progress.coins, 111);
  assert.deepEqual(value.settle(run, 'topping-settlement'), settlement); assert.equal(value.progress.coins, 111);
});

test('upgrade purchases affect the next run, never the already captured kitchen grade', () => {
  const value = core(), old = value.startLevel(LEVELS[0]!.id, 'topping-before');
  assert.equal(old.snapshot.orders[1]!.baseScore, 7);
  value.purchaseUpgrade('r01', 'ingredient-fritter', 'topping-between-runs');
  assert.equal(old.snapshot.orders[1]!.baseScore, 7);
  const next = value.startLevel(LEVELS[0]!.id, 'topping-after');
  assert.equal(next.snapshot.orders[1]!.baseScore, 9);
});

test('unconfigured production and old saves retain base prices and expose no phantom topping upgrade', () => {
  const raw = actual(), seed = createDefaultSave(); seed.upgrades['r01:ingredient-fritter'] = 99;
  const value = P10GameCore.load(JSON.stringify(seed)); value.configureKitchenRules(KitchenRulesReader.parse(raw));
  assert.equal(value.listUpgradeIds('r01').includes('ingredient-fritter'), false);
  assert.throws(() => value.getUpgradeQuote('r01', 'ingredient-fritter'), /Unknown upgrade/);
  assert.ok(value.startLevel(LEVELS[0]!.id, 'old-save-unconfigured').snapshot.orders.every(row => row.baseScore === (row.dishId === 'jianbing' ? 5 : 2)));
});
