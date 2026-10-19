import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the real View/Presentation with Cocos drawing and MK asset IO doubled.
class Transform {
  contentSize = { width: 750, height: 1334 };
  setContentSize(width, height) { this.contentSize = { width, height }; }
  getBoundingBoxToWorld() { return { contains: point => point.target === this.node }; }
}
class Sprite { spriteFrame = null; }
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
const frame = { originalSize: { width: 720, height: 1280 }, isValid: true };
const assetReads = [];
const cc = { _decorator: { ccclass: () => Class => Class, property: () => () => {} }, Node, Label, Sprite,
  SpriteFrame: class {}, UITransform: Transform, UIOpacity: Opacity,
  Color: class { constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } },
  Vec3: class { constructor(x, y, z) { Object.assign(this, { x, y, z }); } },
  HorizontalTextAlignment: { LEFT: 0, CENTER: 1, RIGHT: 2 }, VerticalTextAlignment: { CENTER: 1 },
  input: { on() {}, off() {} }, Input: { EventType: { TOUCH_END: 'touch-end' } },
  isValid: value => Boolean(value) && value.isValid !== false && value.node?.isValid !== false };
cc.Color.WHITE = new cc.Color(255, 255, 255, 255);
const mk = { ViewBase: class {}, asset: { async get(path) { assetReads.push(path); return frame; } },
  Release: { release() {}, followRelease() {} } };
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
const { KitchenFlowScreenGroup } = load('KitchenFlowScreenGroup');
const { P10CookPresentation } = load('P10CookPresentation', {
  './KitchenFlowScreenGroup': { KitchenFlowScreenGroup }, './MapFlowScreenGroup': { MapFlowScreenGroup: class {} },
  './SettingsFlowScreenGroup': { SettingsFlowScreenGroup: class {} }, './ProgressionScreenGroup': { ProgressionScreenGroup: class {} },
  '../ui/ViewportLayout': {}, '../ui/ScreenArtManifest': {
    artPathFor: screen => screen, SCREEN_ART_MANIFEST: { kitchen: { overlayAlpha: 36 }, pause: { overlayAlpha: 112 }, result: { overlayAlpha: 40 } },
  },
});
const viewport = { width: 750, height: 1334, topY: 643, bottomY: -643 };
function model() {
  return { screen: 'pause', progress: { coins: 42, totalStars: 6, settings: { reducedMotion: false } },
    kitchen: { servedOrders: 2, remainingSeconds: 12.2, combo: 1,
      orders: [{ state: 'Pending', dishId: 'jianbing', patienceRemaining: 9, patienceMax: 10 }, {}, {}, {}] },
    level: { dishPool: ['jianbing', 'soy_milk', 'tea_egg'] },
    selection: { restaurantIndex: 0, levelIndex: 0 },
    catalog: { restaurants: [{ id: 'r0', name: '煎饼早餐', levelIds: ['level0', 'level1'] }] },
    lastSuccess: false, result: null };
}
function fixture({ fixed = true } = {}) {
  const view = new KitchenFlowScreenGroup(); view.node = new Node('KitchenFlowGroup'); view.node.addComponent(Transform);
  const add = name => { const node = new Node(name); view.pauseRoot.addChild(node); node.addComponent(Transform); return node; };
  if (fixed) {
    view.pauseRoot = new Node('PauseRoot'); view.node.addChild(view.pauseRoot); view.pauseRoot.addComponent(Transform);
    view.pauseHeaderRoot = add('Header'); view.pauseTransition = add('Transition');
    view.pauseBackground = add('Background').addComponent(Sprite); view.pauseBackground.spriteFrame = frame;
    view.pauseCurrencyLabel = add('Currency').addComponent(Label); view.pauseSummaryLabel = add('Summary').addComponent(Label);
    for (const [key, y] of [['pauseResumeButton', -10], ['pauseRestartButton', -125], ['pauseExitButton', -230]]) {
      view[key] = add(key); view[key].setPosition(0, y, 0);
    }
  }
  const intents = []; let enabled = true;
  const presentation = new P10CookPresentation(new Node('Module'), { publish: intent => intents.push(intent) },
    { canReceiveInput: () => enabled });
  Object.assign(presentation, { pageView: view, active: true, viewport, panelFrame: frame, readModel: model() });
  return { view, presentation, intents, setEnabled(v) { enabled = v; },
    tap(node) { presentation.handlePointer({ getUILocation: () => ({ target: node }) }); } };
}
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

test('fixed Pause projects the frozen snapshot without nodes, asset loads, layout drift or gameplay writes', () => {
  const f = fixture(), before = JSON.stringify(freeze(f.presentation.readModel));
  const children = f.view.pauseRoot.children.slice(), reads = assetReads.length;
  f.presentation.showPause();
  assert.equal(f.view.pauseSummaryLabel.string, '已完成 2/4 · 剩余 13秒');
  assert.equal(f.view.pauseCurrencyLabel.string, '金币 42  ★ 6');
  assert.equal(f.view.pauseHeaderRoot.position.y, 595);
  assert.equal(f.view.node.getComponent(Transform).contentSize.height, 1334);
  assert.equal(f.view.pauseRoot.getComponent(Transform).contentSize.width, 750);
  assert.deepEqual(f.view.pauseBackground.node.getComponent(Transform).contentSize, { width: 750.375, height: 1334 });
  assert.deepEqual(f.view.pauseRoot.children, children); assert.equal(f.view.node.children.length, 1);
  assert.deepEqual([f.view.pauseResumeButton.position.y, f.view.pauseRestartButton.position.y, f.view.pauseExitButton.position.y], [-10, -125, -230]);
  assert.equal(assetReads.length, reads); assert.equal(JSON.stringify(f.presentation.readModel), before);
  f.presentation.readModel = { ...model(), kitchen: null, progress: { ...model().progress, settings: { reducedMotion: true } } };
  f.presentation.showPause();
  assert.equal(f.view.pauseSummaryLabel.string, '已完成 0/0 · 剩余 0秒');
  assert.equal(f.view.pauseTransition.active, false);
});

test('Pause actions keep the three original intents, replace callbacks, and respect both input gates', () => {
  const f = fixture(), buttons = [f.view.pauseResumeButton, f.view.pauseRestartButton, f.view.pauseExitButton];
  f.presentation.showPause(); f.presentation.showPause();
  assert.equal(f.presentation.tapTargets.length, 3);
  buttons.forEach(node => f.tap(node));
  assert.deepEqual(JSON.parse(JSON.stringify(f.intents)), [
    { type: 'p10.resume', payload: {} }, { type: 'p10.restart', payload: { reason: 'pause-menu' } }, { type: 'p10.abandon', payload: {} },
  ]);
  f.presentation.setInputEnabled(false); buttons.forEach(node => f.tap(node));
  f.presentation.setInputEnabled(true); f.setEnabled(false); buttons.forEach(node => f.tap(node));
  f.setEnabled(true); f.presentation.active = false; buttons.forEach(node => f.tap(node));
  assert.equal(f.intents.length, 3);
  f.presentation.active = true; f.presentation.update(0.16); assert.equal(f.view.pauseTransition.active, false);
});

test('Kitchen, Pause and Result retain the authored root while discarding inactive page targets and HUD refs', async () => {
  const f = fixture(), root = f.view.pauseRoot;
  for (let repeat = 0; repeat < 3; repeat++) {
    f.presentation.showPause(); assert.equal(root.active, true); assert.equal(f.presentation.hudTime, null);
    f.presentation.showKitchen(); await f.presentation.artTask;
    assert.equal(root.active, false); assert.equal(root.isValid, true); assert.ok(f.presentation.hudTime);
    const kitchenTargets = f.presentation.tapTargets.map(target => target.node);
    const count = f.intents.length; f.tap(f.view.pauseResumeButton); assert.equal(f.intents.length, count);
    f.presentation.showPause();
    assert.equal(root.active, true); assert.equal(f.presentation.hudTime, null); assert.equal(f.view.node.children.length, 1);
    kitchenTargets.forEach(node => f.tap(node)); assert.equal(f.intents.length, count);
    f.presentation.showResult(); await f.presentation.artTask;
    assert.equal(root.active, false); assert.equal(root.isValid, true); f.tap(f.view.pauseExitButton);
    assert.equal(f.intents.length, count);
  }
  f.presentation.showPause(); assert.equal(f.view.node.children.length, 1); assert.equal(root.isValid, true);
});

test('partial, destroyed, duplicate or foreign Pause bindings fail without stale input or dynamic fallback', () => {
  for (const corrupt of [f => { f.view.pauseSummaryLabel = null; }, f => f.view.pauseResumeButton.destroy(),
    f => { f.view.pauseBackground.spriteFrame = null; }, f => { f.view.pauseRestartButton = f.view.pauseResumeButton; },
    f => { f.view.pauseSummaryLabel = f.view.pauseCurrencyLabel; }, f => { f.view.pauseRoot.parent = new Node('ForeignView'); },
    f => { f.view.pauseCurrencyLabel.node.parent = new Node('ForeignTree'); },
    f => { f.view.pauseExitButton.components.delete(Transform); }, f => f.view.pauseTransition.destroy()]) {
    const f = fixture(); f.presentation.showPause(); corrupt(f);
    assert.throws(() => f.presentation.showPause(), /Cook pause/);
    assert.equal(f.presentation.tapTargets.length, 0); assert.equal(f.intents.length, 0);
    assert.equal(f.view.node.children.some(node => node.name === 'BackgroundRoot'), false);
  }
});

test('an unbound KitchenFlowGroup keeps the legacy Pause page and original actions', async () => {
  const f = fixture({ fixed: false }); assert.equal(f.view.hasFixedPause, false);
  f.presentation.showPause(); await f.presentation.artTask;
  assert.equal(f.presentation.tapTargets.length, 3);
  f.presentation.tapTargets.slice().forEach(target => f.tap(target.node));
  assert.deepEqual(f.intents.map(intent => intent.type), ['p10.resume', 'p10.restart', 'p10.abandon']);
  f.presentation.showKitchen(); await f.presentation.artTask; assert.equal(f.view.node.active, true);
});
