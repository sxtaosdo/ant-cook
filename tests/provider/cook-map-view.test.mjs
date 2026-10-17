import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the real View and Presentation; only Cocos rendering, asset IO and MK are doubles.
class UiTransform {
  contentSize = { width: 750, height: 1334 };
  setContentSize(width, height) { this.contentSize = { width, height }; }
  getBoundingBoxToWorld() { return { contains: point => point.target === this.node }; }
}
class Sprite { color = null; spriteFrame = null; }
Sprite.Type = { SIMPLE: 0 }; Sprite.SizeMode = { CUSTOM: 0 };
class Label { string = ''; }
Label.Overflow = { SHRINK: 2 };
class UiOpacity { opacity = 255; }
class UiNode {
  constructor(name = '') { this.name = name; this.children = []; this.components = new Map(); this.active = true; this.isValid = true; this.position = { x: 0, y: 0, z: 0 }; this.layer = 1; }
  get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
  addChild(node) { node.parent = this; this.children.push(node); }
  addComponent(Type) { const component = new Type(); component.node = this; this.components.set(Type, component); return component; }
  getComponent(Type) { return this.components.get(Type) ?? null; }
  setPosition(x, y, z = 0) { this.position = typeof x === 'object' ? { ...x } : { x, y, z }; }
  setSiblingIndex() {}
  destroy() { this.isValid = false; if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
}
const decorators = { ccclass: () => Class => Class, property: () => () => {} };
const frame = { originalSize: { width: 1000, height: 1800 }, isValid: true };
const cc = { _decorator: decorators, Node: UiNode, Label, Sprite, SpriteFrame: class {}, UITransform: UiTransform, UIOpacity: UiOpacity,
  Color: class { constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } }, Vec3: class { constructor(x, y, z) { Object.assign(this, { x, y, z }); } },
  HorizontalTextAlignment: { LEFT: 0, CENTER: 1, RIGHT: 2 }, VerticalTextAlignment: { CENTER: 1 },
  input: { on() {}, off() {} }, Input: { EventType: { TOUCH_END: 'touch-end' } }, isValid: value => Boolean(value) && value.isValid !== false };
cc.Color.WHITE = new cc.Color(255, 255, 255, 255);
const mk = { ViewBase: class {}, asset: { async get() { return frame; } }, Release: { release() {}, followRelease() {} } };
function load(name, mocks = {}) {
  const exports = {};
  const path = new URL('../../assets/bundles/game/presentation/' + name + '.ts', import.meta.url);
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, useDefineForClassFields: false } }).outputText;
  vm.runInNewContext(code, { exports, require: id => {
    if (id === 'cc') return cc;
    if (id === 'mk') return { default: mk };
    if (mocks[id]) return mocks[id];
    throw Error('Unresolved presentation import: ' + id);
  }, console, AggregateError });
  return exports;
}

const { MapFlowScreenGroup } = load('MapFlowScreenGroup');
const { P10CookPresentation } = load('P10CookPresentation', {
  './MapFlowScreenGroup': { MapFlowScreenGroup },
  './SettingsFlowScreenGroup': { SettingsFlowScreenGroup: class {} },
  './KitchenFlowScreenGroup': { KitchenFlowScreenGroup: class {} },
  './ProgressionScreenGroup': { ProgressionScreenGroup: class {} },
  '../ui/ViewportLayout': {}, '../ui/ScreenArtManifest': {
    artPathFor: () => 'map', SCREEN_ART_MANIFEST: { map: { overlayAlpha: 42 }, level: { overlayAlpha: 48 }, story: { overlayAlpha: 54 } },
  },
});
const viewport = { width: 750, height: 1334, topY: 667, bottomY: -667 };
function model() {
  const restaurants = Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, name: `Restaurant ${i}`, levelIds: Array(40).fill('level') }));
  return { screen: 'map', catalog: { restaurants }, progress: { coins: 42, totalStars: 3,
    settings: { reducedMotion: false }, restaurants: Object.fromEntries(restaurants.map((r, i) => [r.id, { unlocked: i === 0, highestUnlockedLevel: 1 }])) } };
}
function fixture({ fixed = true } = {}) {
  const view = new MapFlowScreenGroup(); view.node = new UiNode('MapFlowGroup'); view.node.addComponent(UiTransform);
  const add = (name, parent) => { const node = new UiNode(name); parent.addChild(node); node.addComponent(UiTransform); return node; };
  if (fixed) {
    view.mapRoot = add('MapRoot', view.node);
    for (const key of ['headerRoot', 'navigationRoot', 'transition', 'upgradeButton', 'decorButton', 'storyButton', 'settingsButton']) view[key] = add(key, view.mapRoot);
    view.background = add('BackgroundArt', view.mapRoot).addComponent(Sprite); view.background.spriteFrame = frame;
    view.currencyLabel = add('currency', view.mapRoot).addComponent(Label);
    for (let i = 0; i < 6; i++) {
      const card = add(`Restaurant${i}`, view.mapRoot); view.restaurantCards.push(card);
      for (const key of ['restaurantIcons', 'restaurantNames', 'restaurantCities', 'restaurantProgress']) view[key].push(add(key + i, card).addComponent(Label));
      view.restaurantLocks.push(add('lock', card));
      view.restaurantEdges.push(add('edge', card).addComponent(Sprite));
      for (let side = 0; side < 4; side++) view.restaurantBorders.push(add('border' + side, card).addComponent(Sprite));
    }
  }
  const intents = [], navigationCalls = []; let enabled = true;
  const navigation = { canReceiveInput: () => enabled };
  for (const name of ['Upgrade', 'Decor', 'Story', 'Settings']) navigation['show' + name] = () => navigationCalls.push(name);
  const presentation = new P10CookPresentation(new UiNode('module'), { publish: intent => intents.push(intent) }, navigation);
  Object.assign(presentation, { pageView: view, active: true, viewport, panelFrame: frame, readModel: model() });
  const tap = node => presentation.handlePointer({ getUILocation: () => ({ target: node }) });
  return { view, presentation, tap, intents, navigationCalls, setEnabled(v) { enabled = v; } };
}

test('fixed Map projects six cards and current lock/colors without mutating progress or creating nodes', () => {
  const f = fixture(), before = JSON.stringify(f.presentation.readModel), children = f.view.mapRoot.children.slice();
  f.presentation.showMap();
  assert.equal(f.view.currencyLabel.string, '金币 42  ★ 3');
  assert.deepEqual(Array.from(f.view.restaurantNames, label => label.string), Array.from({ length: 6 }, (_, i) => `Restaurant ${i}`));
  assert.deepEqual(Array.from(f.view.restaurantLocks, node => node.active), [false, true, true, true, true, true]);
  assert.equal(f.view.restaurantIcons[1].string, '锁');
  assert.equal(f.view.restaurantEdges[0].color.r, 235); assert.equal(f.view.restaurantEdges[1].color.r, 45);
  assert.equal(f.view.restaurantBorders[4].color.r, 150); assert.equal(f.view.restaurantBorders[4].color.a, 205);
  assert.equal(f.view.headerRoot.position.y, 619); assert.equal(f.view.navigationRoot.position.y, -629);
  assert.equal(f.view.mapRoot.getComponent(UiTransform).contentSize.height, 1334);
  assert.ok(f.view.background.node.getComponent(UiTransform).contentSize.width >= 750);
  assert.ok(f.view.background.node.getComponent(UiTransform).contentSize.height >= 1334);
  assert.deepEqual(f.view.mapRoot.children, children); assert.equal(JSON.stringify(f.presentation.readModel), before);
});

test('Map survives shared level/story clearing and rerenders replace rather than accumulate tap targets', () => {
  const f = fixture(), root = f.view.mapRoot, cards = f.view.restaurantCards.slice();
  for (let i = 0; i < 4; i++) {
    f.presentation.showMap(); assert.equal(f.presentation.tapTargets.length, 5);
    for (const screen of ['level', 'story']) {
      f.presentation.clear(screen); assert.equal(root.active, false); assert.equal(root.isValid, true);
      assert.equal(f.presentation.tapTargets.length, 0);
    }
    f.presentation.showMap(); assert.equal(root.active, true); assert.equal(f.view.node.children.length, 1);
    assert.deepEqual(f.view.restaurantCards, cards); assert.equal(f.presentation.tapTargets.length, 5);
  }
  f.presentation.readModel.progress.restaurants.r1.unlocked = true;
  f.presentation.showMap(); assert.equal(f.presentation.tapTargets.length, 6); assert.equal(f.view.restaurantLocks[1].active, false);
});

test('six-card selection and four existing navigation actions respect both input gates', () => {
  const f = fixture(); f.presentation.showMap(); f.presentation.showMap();
  f.tap(f.view.restaurantCards[1]); assert.equal(f.intents.length, 0);
  f.tap(f.view.restaurantCards[0]); assert.equal(f.intents.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.intents[0])), { type: 'p10.select-restaurant', payload: { restaurantIndex: 0 } });
  for (const progress of Object.values(f.presentation.readModel.progress.restaurants)) progress.unlocked = true;
  f.presentation.showMap(); f.intents.length = 0;
  for (const card of f.view.restaurantCards) f.tap(card);
  assert.deepEqual(f.intents.map(intent => intent.payload.restaurantIndex), [0, 1, 2, 3, 4, 5]);
  for (const node of [f.view.upgradeButton, f.view.decorButton, f.view.storyButton, f.view.settingsButton]) f.tap(node);
  assert.deepEqual(f.navigationCalls, ['Upgrade', 'Decor', 'Story', 'Settings']);
  f.presentation.setInputEnabled(false); f.tap(f.view.restaurantCards[0]); f.tap(f.view.settingsButton);
  f.presentation.setInputEnabled(true); f.setEnabled(false); f.tap(f.view.restaurantCards[0]); f.tap(f.view.settingsButton);
  assert.equal(f.intents.length, 6); assert.equal(f.navigationCalls.length, 4);
});

test('partial or destroyed authored Map fails with no stale input; the root cannot belong to another owner', () => {
  for (const corrupt of [f => f.view.restaurantCards[2].destroy(), f => f.view.restaurantBorders.pop(),
    f => { f.view.background.spriteFrame = null; }, f => { f.view.mapRoot.parent = new UiNode('foreign'); }]) {
    const f = fixture(); f.presentation.showMap(); corrupt(f);
    assert.throws(() => f.presentation.showMap(), /Cook map|Cook mapRoot/);
    assert.equal(f.presentation.tapTargets.length, 0); assert.equal(f.intents.length, 0);
  }
});

test('unbound existing Map Prefab keeps its legacy render until Creator saves the authored root', async () => {
  const f = fixture({ fixed: false }); assert.equal(f.view.hasFixedMap, false);
  f.presentation.showMap(); await f.presentation.artTask;
  assert.equal(f.presentation.tapTargets.length, 5); assert.ok(f.view.node.children.length > 0);
  assert.equal(f.view.node.children.some(node => node.name === 'Restaurant0'), true);
});
