import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { KitchenRulesReader } from '../../assets/bundles/game/core/kitchenRules';
import { P10GameCore } from '../../assets/bundles/game/core/P10GameCore';
import { createDefaultSave } from '../../assets/bundles/game/core/SaveCodec';
import { P10CookApplication } from '../../assets/bundles/game/application/P10CookApplication';
import { MemoryStorageAdapter } from '../../assets/bundles/game/infrastructure/save/MemoryStorageAdapter';
import { FrameworkSaveCoordinatorAdapter } from '../../assets/bundles/game/infrastructure/save/SaveCoordinatorAdapter';

const actual = () => JSON.parse(readFileSync(new URL('../../assets/bundles/game/resources/config/kitchen-rules.json', import.meta.url), 'utf8'));
function fixture() {
  const raw = actual(); raw.source = 'synthetic-level-overrides-not-original-game-parameters';
  raw.levelOverrides = [
    { levelId: 'r01-l01', customers: { count: 2, itemsPerCustomer: 1 }, goal: { metric: 'dishes', target: 1 } },
    { levelId: 'r01-l02', customers: { count: 3, activeCapacity: 1 }, goal: { metric: 'customers', target: 'all' } },
  ];
  return raw;
}
function seed() {
  const save = createDefaultSave(); save.coins = 100;
  for (const id of ['r01-l02', 'r01-l03', 'r02-l01']) save.levels[id]!.unlocked = true;
  save.restaurants.r02!.unlocked = true;
  return save;
}
function core() { return P10GameCore.load(JSON.stringify(seed())); }
const scope = { frameworkVersion: '2.0.7', sectionId: 'cook.level.rules.test', primaryKey: 'cook.level.rules.test.progress' };
function application(storage = new MemoryStorageAdapter(), initialize = true) {
  if (initialize) {
    let current = core(); const save = new FrameworkSaveCoordinatorAdapter(storage, scope);
    assert.equal(save.attachCoreState(() => current, restored => { current = restored; }).ok, true);
    assert.equal(save.save().ok, true);
  }
  let sequence = 0;
  const app = new P10CookApplication({ storage, saveScope: scope, clock: () => 100, idGenerator: key => `${key}-${sequence++}` });
  assert.equal(app.start().ok, true);
  return { app, storage };
}

test('level rules: parser owns merged goal/customer data and accepts absent or empty override lists', () => {
  const raw = fixture(), parsed = KitchenRulesReader.parse(raw);
  assert.equal(parsed.levelOverrides![0]!.customers!.count, 2);
  assert.equal(parsed.levelOverrides![0]!.customers!.patienceSeconds, raw.customers.patienceSeconds);
  assert.equal(parsed.levelOverrides![0]!.goal!.mode, raw.goal.mode);
  raw.levelOverrides[0].goal.target = 999;
  raw.goal.starRatios[0] = 0.5;
  assert.equal(parsed.levelOverrides![0]!.goal!.target, 1);
  assert.equal(parsed.levelOverrides![0]!.goal!.starRatios[0], 1);
  assert.equal(KitchenRulesReader.parse(actual()).levelOverrides, undefined);
  const empty = actual(); empty.levelOverrides = [];
  assert.deepEqual(KitchenRulesReader.parse(empty).levelOverrides, []);
});

test('level rules: malformed/duplicate/unsupported overrides fail validation using existing numeric contracts', () => {
  const mutations: Array<(raw: ReturnType<typeof fixture>) => void> = [
    raw => { raw.levelOverrides = {}; }, raw => { raw.levelOverrides = [null]; },
    raw => { raw.levelOverrides[0].levelId = ''; }, raw => { raw.levelOverrides.push(raw.levelOverrides[0]); },
    raw => { raw.levelOverrides[0].customers.count = 0; }, raw => { raw.levelOverrides[0].customers.count = 2.5; },
    raw => { raw.levelOverrides[0].goal.target = -1; }, raw => { raw.levelOverrides[0].goal.metric = 'score'; },
    raw => { raw.levelOverrides[0].goal.starRatios = [1, 0.5, 2]; },
    raw => { raw.levelOverrides[0].customers = null; }, raw => { raw.levelOverrides[0].goal = {}; },
    raw => { raw.levelOverrides[0].goal.stationId = 'grill'; },
    raw => { raw.levelOverrides[0].recipes = []; }, raw => { raw.levelOverrides[0] = { levelId: 'r01-l01' }; },
  ];
  for (const mutate of mutations) { const raw = fixture(); mutate(raw); assert.throws(() => KitchenRulesReader.parse(raw)); }
});

test('level rules: Core validates catalog ownership atomically before accepting unknown/cross-restaurant targets', () => {
  const value = core(); value.configureKitchenRules(KitchenRulesReader.parse(fixture()));
  for (const id of ['r01-l99', 'r02-l01']) {
    const raw = fixture(); raw.levelOverrides[0].levelId = id;
    assert.throws(() => value.configureKitchenRules(KitchenRulesReader.parse(raw)));
    assert.equal(value.startLevel('r01-l01', id).snapshot.production!.goal.target, 1);
  }
});

test('level rules: Core selects exact level with default fallback, catalog-derived null count and no cross-restaurant leakage', () => {
  const value = core(), raw = fixture(); value.configureKitchenRules(KitchenRulesReader.parse(raw));
  const first = value.startLevel('r01-l01', 'one');
  assert.equal(first.snapshot.production!.customers.length, 2);
  assert.deepEqual(first.snapshot.production!.goal, { mode: 'customers', metric: 'dishes', target: 1, current: 0 });
  const second = value.startLevel('r01-l02', 'two').snapshot.production!;
  assert.equal(second.customers.length, 3); assert.equal(second.customers.filter(c => c.state === 'Active').length, 1);
  assert.equal(second.goal.metric, 'customers'); assert.equal(second.goal.target, 3);
  const fallback = value.startLevel('r01-l03', 'default').snapshot.production!;
  assert.equal(fallback.customers.length, 6); assert.equal(fallback.goal.metric, 'coins'); assert.equal(fallback.goal.target, 30);
  assert.equal(value.startLevel('r02-l01', 'other').snapshot.production, undefined);
  raw.levelOverrides[0].customers.count = null;
  value.configureKitchenRules(KitchenRulesReader.parse(raw));
  assert.equal(value.startLevel('r01-l01', 'null-count').snapshot.production!.customers.length, 4);
  assert.equal(first.snapshot.production!.customers.length, 2, 'new configuration must not retune an existing run');
  assert.equal(JSON.stringify(JSON.parse(value.serialize())).includes('levelOverrides'), false, 'configuration is not a save-format extension');
});

test('level rules: actual Application config/start path consumes different selected levels and restores checkpoints with old save shape', () => {
  const { app, storage } = application();
  try {
    assert.equal(app.configureKitchenRules(fixture()).ok, true);
    assert.equal(app.startLevelAt(0, 0, 'first').ok, true);
    assert.equal(app.read().kitchen!.production!.goal.target, 1);
    assert.equal(app.abandonRun().ok, true);
    assert.equal(app.startLevelAt(0, 1, 'second').ok, true);
    assert.equal(app.read().kitchen!.production!.customers.length, 3);
    assert.equal(app.read().kitchen!.production!.goal.metric, 'customers');
  } finally { app.shutdown(); }
  const restored = application(storage, false).app;
  try {
    assert.equal(restored.configureKitchenRules(fixture()).ok, true);
    assert.equal(restored.resumeSavedRun().ok, true);
    assert.equal(restored.read().kitchen!.levelId, 'r01-l02');
    assert.equal(restored.read().kitchen!.production!.goal.target, 3);
    assert.equal(restored.read().progress.coins, 100);
  } finally { restored.shutdown(); }
});

test('level rules: Application rejects invalid routing before state adoption and recovers with unchanged legacy rules', () => {
  const { app } = application();
  try {
    for (const levelId of ['r01-l99', 'r02-l01']) {
      const bad = fixture(); bad.levelOverrides[0].levelId = levelId;
      const result = app.configureKitchenRules(bad);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, 'BAD_CONFIG');
    }
    assert.equal(app.configureKitchenRules(actual()).ok, true);
    assert.equal(app.startLevelAt(0, 0, 'legacy').ok, true);
    assert.equal(app.read().kitchen!.production!.goal.target, 30);
    assert.equal(app.read().kitchen!.production!.customers.length, 6);
  } finally { app.shutdown(); }
});
