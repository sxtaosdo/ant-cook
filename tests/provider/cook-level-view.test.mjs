import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Run the actual View/Presentation; Cocos rendering and MK asset IO are doubles.
class Transform {
  contentSize = { width: 750, height: 1334 };
  setContentSize(width, height) { this.contentSize = { width, height }; }
  getBoundingBoxToWorld() { return { contains: point => point.target === this.node }; }
}
class Sprite { color = null; spriteFrame = null; }
Sprite.Type = { SIMPLE: 0 }; Sprite.SizeMode = { CUSTOM: 0 };
class Label { string = ''; }
Label.Overflow = { SHRINK: 2 };
class Opacity { opacity = 255; }
class Node {
  constructor(name = '') { this.name = name; this.children = []; this.components = new Map(); this.active = true; this.isValid = true; this.layer = 33554432; }
  get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
  addChild(node) { node.parent = this; this.children.push(node); }
  addComponent(Type) { const component = new Type(); component.node = this; this.components.set(Type, component); return component; }
  getComponent(Type) { return this.components.get(Type) ?? null; }
  setPosition(x, y, z = 0) { this.position = typeof x === 'object' ? { ...x } : { x, y, z }; }
  setSiblingIndex() {}
  destroy() { this.isValid = false; for (const child of [...this.children]) child.destroy(); if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
}
const frame = { originalSize: { width: 1000, height: 1800 }, isValid: true };
const cc = { _decorator: { ccclass: () => Class => Class, property: () => () => {} }, Node, Label, Sprite,
  SpriteFrame: class {}, UITransform: Transform, UIOpacity: Opacity,
  Color: class { constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } },
  Vec3: class { constructor(x, y, z) { Object.assign(this, { x, y, z }); } },
  HorizontalTextAlignment: { LEFT: 0, CENTER: 1, RIGHT: 2 }, VerticalTextAlignment: { CENTER: 1 },
  input: { on() {}, off() {} }, Input: { EventType: { TOUCH_END: 'touch-end' } },
  isValid: value => Boolean(value) && value.isValid !== false && value.node?.isValid !== false };
cc.Color.WHITE = new cc.Color(255, 255, 255, 255);
const mk = { ViewBase: class {}, asset: { async get() { return frame; } }, Release: { release() {}, followRelease() {} } };
function load(name, mocks = {}) {
  const exports = {};
  const path = new URL('../../assets/bundles/game/presentation/' + name + '.ts', import.meta.url);
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, experimentalDecorators: true, useDefineForClassFields: false } }).outputText;
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
  './MapFlowScreenGroup': { MapFlowScreenGroup }, './SettingsFlowScreenGroup': { SettingsFlowScreenGroup: class {} },
  './KitchenFlowScreenGroup': { KitchenFlowScreenGroup: class {} }, './ProgressionScreenGroup': { ProgressionScreenGroup: class {} },
  '../ui/ViewportLayout': {}, '../ui/ScreenArtManifest': {
    artPathFor: screen => screen, SCREEN_ART_MANIFEST: { map: { overlayAlpha: 42 }, level: { overlayAlpha: 48 }, story: { overlayAlpha: 54 } },
  },
});
const viewport = { width: 750, height: 1334, topY: 643, bottomY: -643 };
function model() {
  const restaurants = Array.from({ length: 6 }, (_, r) => ({ id: `r${r}`, name: `Restaurant ${r}`,
    levelIds: Array.from({ length: 40 }, (_, i) => `r${r}-level${i}`) }));
  return { screen: 'level', catalog: { restaurants }, selection: { restaurantIndex: 1, levelPage: 0 },
    progress: { coins: 42, totalStars: 6, settings: { reducedMotion: false },
      restaurants: Object.fromEntries(restaurants.map(r => [r.id, { unlocked: true, highestUnlockedLevel: 4 }])),
      levels: Object.fromEntries(restaurants.flatMap(r => r.levelIds.map((id, i) => [id, { unlocked: i < 4, bestStars: i % 4 }]))) } };
}
function fixture({ fixed = true } = {}) {
  const view = new MapFlowScreenGroup(); view.node = new Node('MapFlowGroup'); view.node.addComponent(Transform);
  const add = (name, parent) => { const node = new Node(name); parent.addChild(node); node.addComponent(Transform); return node; };
  view.mapRoot = add('MapRoot', view.node);
  for (const key of ['headerRoot', 'navigationRoot', 'transition', 'upgradeButton', 'decorButton', 'storyButton', 'settingsButton']) view[key] = add(key, view.mapRoot);
  view.background = add('MapArt', view.mapRoot).addComponent(Sprite); view.background.spriteFrame = frame;
  view.currencyLabel = add('MapCurrency', view.mapRoot).addComponent(Label);
  for (let i = 0; i < 6; i++) {
    const card = add(`Restaurant${i}`, view.mapRoot); view.restaurantCards.push(card);
    for (const key of ['restaurantIcons', 'restaurantNames', 'restaurantCities', 'restaurantProgress']) view[key].push(add(key + i, card).addComponent(Label));
    view.restaurantLocks.push(add('Lock', card)); view.restaurantEdges.push(add('Edge', card).addComponent(Sprite));
    for (let side = 0; side < 4; side++) view.restaurantBorders.push(add('Border' + side, card).addComponent(Sprite));
  }
  if (fixed) {
    view.levelRoot = add('LevelRoot', view.node);
    for (const key of ['levelHeaderRoot', 'levelTransition', 'levelBackButton']) view[key] = add(key, view.levelRoot);
    view.levelBackground = add('LevelArt', view.levelRoot).addComponent(Sprite); view.levelBackground.spriteFrame = frame;
    for (const key of ['levelCurrencyLabel', 'levelRestaurantTitle', 'levelRestaurantSubtitle', 'levelRestaurantIcon', 'levelPageLabel']) view[key] = add(key, view.levelRoot).addComponent(Label);
    for (const key of ['levelPreviousButton', 'levelNextButton']) view[key] = add(key, view.levelRoot).addComponent(Sprite);
    for (let i = 0; i < 6; i++) {
      const button = add(`Level${i}`, view.levelRoot); view.levelButtons.push(button);
      view.levelPanels.push(button.addComponent(Sprite)); view.levelLabels.push(add('Label', button).addComponent(Label));
    }
  }
  const intents = [], navigationCalls = []; let enabled = true;
  const navigation = { canReceiveInput: () => enabled, showMap: () => navigationCalls.push('Map') };
  for (const name of ['Upgrade', 'Decor', 'Story', 'Settings']) navigation['show' + name] = () => navigationCalls.push(name);
  const presentation = new P10CookPresentation(new Node('Module'), { publish: intent => intents.push(intent) }, navigation);
  Object.assign(presentation, { pageView: view, active: true, viewport, panelFrame: frame, readModel: model() });
  return { view, presentation, intents, navigationCalls, setEnabled(v) { enabled = v; },
    tap(node) { presentation.handlePointer({ getUILocation: () => ({ target: node }) }); } };
}
const labels = f => Array.from(f.view.levelLabels, label => label.string);
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

test('fixed Level projects the selected restaurant, 0–3 stars and locks without creating nodes or writing progress', () => {
  const f = fixture(), before = JSON.stringify(freeze(f.presentation.readModel));
  const children = f.view.levelRoot.children.slice();
  f.presentation.showLevel();
  assert.equal(f.view.levelRestaurantTitle.string, 'Restaurant 1');
  assert.equal(f.view.levelRestaurantSubtitle.string, '广州 · 今日营业'); assert.equal(f.view.levelRestaurantIcon.string, '茶');
  assert.equal(f.view.levelCurrencyLabel.string, '金币 42  ★ 6');
  assert.deepEqual(labels(f), ['1\n☆☆☆', '2\n★☆☆', '3\n★★☆', '4\n★★★', '锁定', '锁定']);
  assert.equal(f.view.levelPanels[0].color.r, 20); assert.equal(f.view.levelPanels[4].color.r, 42);
  assert.equal(f.view.levelPageLabel.string, '1/7'); assert.equal(f.view.levelPreviousButton.color.r, 5);
  assert.equal(f.view.levelNextButton.color.r, 20);
  assert.equal(f.view.levelHeaderRoot.position.y, 595); assert.equal(f.view.levelBackButton.position.y, -610);
  assert.equal(f.view.levelBackButton.position.x, -286);
  assert.equal(f.view.levelRoot.getComponent(Transform).contentSize.height, 1334);
  const size = f.view.levelBackground.node.getComponent(Transform).contentSize;
  assert.ok(size.width >= 750 && size.height >= 1334);
  assert.deepEqual(f.view.levelRoot.children, children); assert.equal(f.view.node.children.length, 2);
  assert.equal(JSON.stringify(f.presentation.readModel), before);
});

test('page changes use absolute indices, hide the final two slots and replace old callbacks', () => {
  const f = fixture(); for (const progress of Object.values(f.presentation.readModel.progress.levels)) progress.unlocked = true;
  f.presentation.readModel.selection.levelPage = 2; f.presentation.showLevel();
  for (const button of f.view.levelButtons) f.tap(button);
  assert.deepEqual(f.intents.map(intent => intent.payload.levelIndex), [12, 13, 14, 15, 16, 17]);
  f.intents.length = 0; f.presentation.readModel.selection.levelPage = 6;
  f.presentation.showLevel(); f.presentation.showLevel();
  assert.equal(f.view.levelPageLabel.string, '7/7');
  assert.deepEqual(Array.from(f.view.levelButtons, node => node.active), [true, true, true, true, false, false]);
  assert.deepEqual(labels(f).slice(4), ['', '']); assert.equal(f.presentation.tapTargets.length, 7);
  for (const button of f.view.levelButtons) f.tap(button);
  assert.deepEqual(f.intents.map(intent => intent.payload.levelIndex), [36, 37, 38, 39]);
  assert.equal(f.view.levelNextButton.color.r, 5);
  f.intents.length = 0; f.presentation.readModel.selection.levelPage = 0; f.presentation.showLevel();
  assert.equal(f.view.levelButtons.every(node => node.active), true); f.tap(f.view.levelButtons[5]);
  assert.equal(f.intents[0].payload.levelIndex, 5);
});

test('locked slots, first/last arrows, back and both input gates preserve existing routing', () => {
  const f = fixture(); f.presentation.showLevel();
  f.tap(f.view.levelButtons[4]); f.tap(f.view.levelPreviousButton.node); assert.equal(f.intents.length, 0);
  f.tap(f.view.levelButtons[2]); f.tap(f.view.levelNextButton.node); f.tap(f.view.levelBackButton);
  assert.deepEqual(JSON.parse(JSON.stringify(f.intents)), [
    { type: 'p10.start-level', payload: { levelIndex: 2 } }, { type: 'p10.set-level-page', payload: { page: 1 } },
  ]); assert.deepEqual(f.navigationCalls, ['Map']);
  f.intents.length = 0; f.presentation.readModel.selection.levelPage = 6; f.presentation.showLevel();
  f.tap(f.view.levelNextButton.node); assert.equal(f.intents.length, 0);
  f.tap(f.view.levelPreviousButton.node); assert.equal(f.intents[0].payload.page, 5);
  f.presentation.readModel.selection.levelPage = 0; f.presentation.showLevel();
  f.presentation.setInputEnabled(false);
  for (const node of [f.view.levelButtons[0], f.view.levelNextButton.node, f.view.levelBackButton]) f.tap(node);
  f.presentation.setInputEnabled(true); f.setEnabled(false);
  for (const node of [f.view.levelButtons[0], f.view.levelNextButton.node, f.view.levelBackButton]) f.tap(node);
  assert.equal(f.intents.length, 1); assert.equal(f.navigationCalls.length, 1);
});

test('Map, Level and legacy Story retain both authored roots and remove inactive page input', async () => {
  const f = fixture(), mapRoot = f.view.mapRoot, levelRoot = f.view.levelRoot;
  for (let repeat = 0; repeat < 3; repeat++) {
    f.presentation.showMap(); assert.equal(mapRoot.active, true); assert.equal(levelRoot.active, false);
    const count = f.intents.length; f.tap(f.view.levelButtons[0]); assert.equal(f.intents.length, count);
    f.presentation.showLevel(); assert.equal(mapRoot.active, false); assert.equal(levelRoot.active, true);
    f.tap(f.view.restaurantCards[0]); assert.equal(f.intents.length, count);
    f.presentation.clear('story'); await f.presentation.artTask;
    assert.equal(mapRoot.active, false); assert.equal(levelRoot.active, false);
    assert.equal(f.presentation.tapTargets.length, 0);
    f.presentation.showLevel(); assert.equal(f.view.node.children.length, 2);
    assert.equal(mapRoot.isValid, true); assert.equal(levelRoot.isValid, true);
  }
});

test('partial, destroyed, duplicate or foreign Level bindings fail without stale input or a dynamic fallback', () => {
  for (const corrupt of [f => f.view.levelButtons[2].destroy(), f => f.view.levelLabels.pop(),
    f => { f.view.levelBackground.spriteFrame = null; }, f => { f.view.levelButtons[1] = f.view.levelButtons[0]; },
    f => { f.view.levelRoot.parent = new Node('ForeignView'); }, f => { f.view.levelBackButton = f.view.settingsButton; },
    f => { f.view.levelLabels[1] = f.view.levelLabels[0]; }, f => { f.view.levelPanels[1] = f.view.levelPanels[0]; }]) {
    const f = fixture(); f.presentation.showLevel(); corrupt(f);
    assert.throws(() => f.presentation.showLevel(), /Cook level/);
    assert.equal(f.presentation.tapTargets.length, 0); assert.equal(f.intents.length, 0);
    assert.equal(f.view.node.children.some(node => node.name === 'BackgroundRoot'), false);
  }
});

test('the unbound Level keeps legacy rendering and protects the existing fixed Map', async () => {
  const f = fixture({ fixed: false }); assert.equal(f.view.hasFixedLevel, false);
  f.presentation.showLevel(); await f.presentation.artTask;
  assert.equal(f.view.mapRoot.isValid, true); assert.equal(f.view.mapRoot.active, false);
  assert.equal(f.presentation.tapTargets.length, 9);
  f.presentation.showMap(); assert.equal(f.view.node.children.length, 1); assert.equal(f.view.mapRoot.active, true);
});
