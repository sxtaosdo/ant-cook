import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { P10CookApplication } from '../../assets/bundles/game/application/P10CookApplication.ts';
import { P10GameCore } from '../../assets/bundles/game/core/P10GameCore.ts';
import { createDefaultSave } from '../../assets/bundles/game/core/SaveCodec.ts';
import { MemoryStorageAdapter } from '../../assets/bundles/game/infrastructure/save/MemoryStorageAdapter.ts';
import { FrameworkSaveCoordinatorAdapter } from '../../assets/bundles/game/infrastructure/save/SaveCoordinatorAdapter.ts';

// Exercise actual Application quote/purchase/save owners and the actual upgrade
// renderer/click closure. Only Cocos paint primitives are substituted; no Creator.
const scope = { frameworkVersion: '2.0.7', sectionId: 'cook.topping.consumer.test', primaryKey: 'cook.topping.consumer.test.progress' };
const toppingId = 'ingredient-fixture-fritter';
const presentationPath = new URL('../../assets/bundles/game/presentation/P10CookPresentation.ts', import.meta.url);
function presentationType() {
  class Color { constructor(...rgba) { this.rgba = rgba; } }
  const cc = { Color, HorizontalTextAlignment: { LEFT: 0 }, VerticalTextAlignment: {}, Node: class {},
    Sprite: class {}, Label: class {}, Input: { EventType: {} }, input: {}, isValid: () => true };
  const exports = {};
  const source = readFileSync(presentationPath, 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    if (name === 'cc') return cc;
    if (name === 'mk') return { default: {} };
    return {};
  } });
  return exports.P10CookPresentation;
}
const Presentation = presentationType();
function rules(configured = true) {
  const raw = JSON.parse(readFileSync(new URL('../../assets/bundles/game/resources/config/kitchen-rules.json', import.meta.url), 'utf8'));
  raw.source = 'synthetic-ui-consumer-tables-not-original-game-tuning';
  if (configured) raw.recipes[0].toppings[1].upgrade = { upgradeId: toppingId, coinsByLevel: [2, 4], upgradePrices: [20] };
  return raw;
}
function application(coins = 100, storage = new MemoryStorageAdapter()) {
  const seed = createDefaultSave(); seed.coins = coins;
  let saved = P10GameCore.load(JSON.stringify(seed));
  const save = new FrameworkSaveCoordinatorAdapter(storage, scope);
  assert.equal(save.attachCoreState(() => saved, restored => { saved = restored; }).ok, true);
  assert.equal(save.save().ok, true);
  return restore(storage);
}
function restore(storage) {
  let sequence = 0;
  const app = new P10CookApplication({ storage, saveScope: scope, clock: () => 100, idGenerator: seed => `${seed}-${sequence++}` });
  assert.equal(app.start().ok, true);
  return { app, storage };
}
function view(app) {
  const value = Object.create(Presentation.prototype);
  const rows = [], labels = [], buttons = [], results = [];
  Object.assign(value, { pageView: { node: {} }, viewport: { topY: 643, bottomY: -643 },
    readModel: { ...app.read(), screen: 'upgrade' }, clear() {}, frame() {},
    box(name) { rows.push(name); }, text(text) { labels.push(text); },
    button(label, parent, x, y, width, height, color, callback) { buttons.push({ label, callback }); },
    publish(intent) { const result = app.dispatch(intent); results.push(result); value.readModel = { ...app.read(), screen: 'upgrade' }; },
  });
  value.showUpgrade();
  return { value, rows, labels, buttons, results, toppingButton() {
    const quote = app.read().upgradeQuotes[toppingId];
    return buttons.find(button => quote.price !== null && button.label.startsWith(`${quote.price} `));
  } };
}

test('configured optional topping flows from rules through Application quotes into actual upgrade display and purchase/save', () => {
  const { app, storage } = application();
  try {
    assert.equal(app.configureKitchenRules(rules()).ok, true);
    const quote = app.read().upgradeQuotes[toppingId];
    assert.equal(quote.kind, 'ingredient'); assert.equal(quote.currentEffect.coins, 2); assert.equal(quote.nextEffect.coins, 4);
    const rendered = view(app);
    const receipts = [];
    const unsubscribe = app.subscribeToEvents(event => { if (event.type === 'p10.upgrade-applied') receipts.push(event.payload.receipt); });
    assert.ok(rendered.rows.includes(`Upgrade_${toppingId}`));
    assert.ok(rendered.labels.some(label => label.includes(quote.label) && label.includes('Lv.1')));
    assert.ok(rendered.labels.some(label => label.includes('2') && label.includes('4')));
    rendered.toppingButton().callback();
    assert.equal(rendered.results[0].ok, true); assert.equal(app.read().progress.coins, 80);
    assert.equal(app.read().upgradeQuotes[toppingId].currentLevel, 2);
    assert.equal(app.read().upgradeQuotes[toppingId].price, null);
    assert.equal(receipts.length, 1); assert.equal(receipts[0].stationId, toppingId);
    assert.equal(receipts[0].applied, true); assert.equal(receipts[0].coinsSpent, 20); assert.equal(receipts[0].newLevel, 2);
    unsubscribe();
    // Public durable state is verified by a fresh application, not a fabricated UI quote.
    const restored = restore(storage);
    try {
      assert.equal(restored.app.configureKitchenRules(rules()).ok, true);
      assert.equal(restored.app.read().progress.coins, 80);
      assert.equal(restored.app.read().upgradeQuotes[toppingId].currentLevel, 2);
      assert.equal(restored.app.buyUpgrade('r01', toppingId).ok, false);
      assert.equal(restored.app.read().progress.coins, 80);
    } finally { restored.app.shutdown(); }
  } finally { app.shutdown(); }
});

test('absent optional table produces no phantom topping row through the actual consumers', () => {
  const { app } = application();
  try {
    assert.equal(app.configureKitchenRules(rules(false)).ok, true);
    assert.equal(toppingId in app.read().upgradeQuotes, false);
    assert.equal(view(app).rows.includes(`Upgrade_${toppingId}`), false);
  } finally { app.shutdown(); }
});

test('actual upgrade click rechecks current affordability and page before publishing a purchase', () => {
  const { app } = application();
  try {
    assert.equal(app.configureKitchenRules(rules()).ok, true);
    const rendered = view(app), click = rendered.toppingButton().callback;
    rendered.value.readModel = { ...rendered.value.readModel, upgradeQuotes: {
      ...rendered.value.readModel.upgradeQuotes,
      [toppingId]: { ...rendered.value.readModel.upgradeQuotes[toppingId], affordable: false },
    } };
    click(); assert.equal(rendered.results.length, 0); assert.equal(app.read().progress.coins, 100);
    rendered.value.readModel = { ...app.read(), screen: 'map' };
    click(); assert.equal(rendered.results.length, 0); assert.equal(app.read().progress.coins, 100);
    rendered.value.readModel = { ...app.read(), screen: 'upgrade' };
    click(); assert.equal(rendered.results.length, 1); assert.equal(app.read().progress.coins, 80);
    const poor = application(19);
    try {
      assert.equal(poor.app.configureKitchenRules(rules()).ok, true);
      const denied = view(poor.app); denied.toppingButton().callback();
      assert.equal(denied.results.length, 0); assert.equal(poor.app.read().progress.coins, 19);
      assert.equal(poor.app.read().upgradeQuotes[toppingId].currentLevel, 1);
    } finally { poor.app.shutdown(); }
  } finally { app.shutdown(); }
});
