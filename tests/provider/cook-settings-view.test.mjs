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
const { SettingsFlowScreenGroup } = load('SettingsFlowScreenGroup');
const { P10CookPresentation } = load('P10CookPresentation', {
  './SettingsFlowScreenGroup': { SettingsFlowScreenGroup },
  './MapFlowScreenGroup': { MapFlowScreenGroup: class {} }, './KitchenFlowScreenGroup': { KitchenFlowScreenGroup: class {} }, './ProgressionScreenGroup': { ProgressionScreenGroup: class {} },
  '../ui/ViewportLayout': {}, '../ui/ScreenArtManifest': { artPathFor: () => 'recovery', SCREEN_ART_MANIFEST: { recovery: { overlayAlpha: 72 } } },
});
const viewport = { width: 750, height: 1334, topY: 643, bottomY: -643 };
function model(settings = {}) { return { screen: 'settings', progress: { coins: 42, totalStars: 3, reputation: 7, hasCheckpoint: false, settings: { effectsVolume: 1, musicVolume: 1, colorBlindMode: false, reducedMotion: false, ...settings } } }; }
function fixture() {
  const view = new SettingsFlowScreenGroup(); view.node = new UiNode('SettingsFlowGroup');
  view.node.addComponent(UiTransform);
  view.settingsRoot = new UiNode('settingsRoot'); view.node.addChild(view.settingsRoot); view.settingsRoot.addComponent(UiTransform);
  for (const field of ['headerRoot', 'transition', 'effectsButton', 'musicButton', 'colorBlindButton', 'reducedMotionButton', 'backButton', 'recoveryButton', 'productButton']) {
    view[field] = new UiNode(field); view.settingsRoot.addChild(view[field]); view[field].addComponent(UiTransform);
    if (field.endsWith('Button')) view[field].addComponent(Sprite);
  }
  for (const field of ['currencyLabel', 'effectsStatus', 'musicStatus', 'colorBlindStatus', 'reducedMotionStatus']) view[field] = { string: '', isValid: true };
  const background = new UiNode('background'); view.settingsRoot.addChild(background); background.addComponent(UiTransform);
  view.background = background.addComponent(Sprite); view.background.spriteFrame = frame;
  view.recoveryRoot = new UiNode('recoveryRoot'); view.node.addChild(view.recoveryRoot); view.recoveryRoot.addComponent(UiTransform);
  for (const field of ['recoveryHeader', 'recoveryTransition', 'resumeButton', 'resetButton', 'recoveryBack']) {
    view[field] = new UiNode(field); view.recoveryRoot.addChild(view[field]); view[field].addComponent(UiTransform);
  }
  for (const field of ['recoveryCurrency', 'checkpointSummary', 'checkpointStatus', 'resumeLabel']) view[field] = { string: '', isValid: true };
  const recoveryArt = new UiNode('recoveryArt'); view.recoveryRoot.addChild(recoveryArt); recoveryArt.addComponent(UiTransform);
  view.recoveryBackground = recoveryArt.addComponent(Sprite); view.recoveryBackground.spriteFrame = frame;
  const intents = [], navigationCalls = []; let navigationEnabled = true;
  const presentation = new P10CookPresentation(new UiNode('module'), { publish: intent => intents.push(intent) }, {
    canReceiveInput: () => navigationEnabled, showMap: () => navigationCalls.push('map'), showRecovery: () => navigationCalls.push('recovery'), showProductNavigation: () => navigationCalls.push('product'),
  });
  Object.assign(presentation, { pageView: view, active: true, viewport, panelFrame: frame, readModel: model() });
  const tap = node => presentation.handlePointer({ getUILocation: () => ({ target: node }) });
  return { view, presentation, intents, navigationCalls, tap, setNavigationEnabled(value) { navigationEnabled = value; } };
}

test('saved Creator settings Prefab has valid typed bindings inside one direct fixed root', () => {
  const records = JSON.parse(readFileSync(new URL('../../assets/bundles/game/prefabs/SettingsFlowGroup.prefab', import.meta.url), 'utf8'));
  const controller = records.find(record => Object.hasOwn(record, 'settingsRoot') && Object.hasOwn(record, 'effectsStatus'));
  assert.ok(controller, 'Creator must save the component and all Inspector fields');
  const deref = reference => records[reference.__id__];
  const root = deref(controller.node), fixed = deref(controller.settingsRoot);
  assert.equal(deref(fixed._parent), root);
  const descendants = new Set();
  const visit = node => { descendants.add(node); for (const child of node._children) visit(deref(child)); };
  visit(fixed);
  for (const field of ['headerRoot', 'transition', 'effectsButton', 'musicButton', 'colorBlindButton', 'reducedMotionButton', 'backButton', 'recoveryButton', 'productButton']) assert.ok(descendants.has(deref(controller[field])), field);
  for (const field of ['background', 'currencyLabel', 'effectsStatus', 'musicStatus', 'colorBlindStatus', 'reducedMotionStatus']) assert.ok(descendants.has(deref(deref(controller[field]).node)), field);
  assert.equal(records.filter(record => record.__type__ === 'cc.Button').length, 0, 'No second input route');
  assert.equal(deref(controller.background)._spriteFrame.__uuid__, 'da85ef85-ab30-42da-a7f6-da0e1ccf214d@f9941');
  assert.ok(records.filter(record => record.__type__ === 'cc.Node').length >= 66);
});

test('settings projects all four values and safe bounds without owning business state', () => {
  const f = fixture(); const before = JSON.stringify(f.presentation.readModel);
  f.view.presentSettings(f.presentation.readModel, { ...viewport, height: 1800, topY: 820, bottomY: -840 });
  assert.equal(f.view.effectsStatus.string, '● 开启'); assert.equal(f.view.colorBlindStatus.string, '○ 已关闭');
  assert.equal(f.view.headerRoot.position.y, 772); assert.equal(f.view.backButton.position.y, -807);
  assert.equal(f.view.node.getComponent(UiTransform).contentSize.height, 1800);
  assert.equal(f.view.settingsRoot.getComponent(UiTransform).contentSize.height, 1800);
  assert.equal(f.view.background.node.getComponent(UiTransform).contentSize.height, 1800);
  assert.equal(JSON.stringify(f.presentation.readModel), before);
  f.view.presentSettings(model({ effectsVolume: 0, musicVolume: 0, colorBlindMode: true, reducedMotion: true }), viewport);
  assert.equal(f.view.effectsStatus.string, '○ 已关闭'); assert.equal(f.view.musicStatus.string, '○ 已关闭');
  assert.equal(f.view.colorBlindStatus.string, '● 已开启'); assert.equal(f.view.reducedMotionStatus.string, '● 已开启');
});

test('settings and recovery rerenders preserve the fixed subtree and replace all dynamic targets', async () => {
  const f = fixture(), fixed = f.view.settingsRoot;
  for (let iteration = 0; iteration < 4; iteration++) {
    f.presentation.showSettings(); assert.equal(f.presentation.tapTargets.length, 7);
    f.presentation.showRecovery(); await f.presentation.artTask;
    assert.equal(fixed.isValid, true); assert.equal(fixed.active, false);
    assert.equal(f.view.recoveryRoot.active, true); assert.equal(f.presentation.tapTargets.length, 3);
    const dynamic = new UiNode('legacyDynamic'); f.view.node.addChild(dynamic);
    f.presentation.showSettings();
    assert.equal(f.view.node.children.length, 2); assert.equal(f.view.node.children[0], fixed);
    assert.equal(fixed.active, true); assert.equal(f.presentation.tapTargets.length, 7);
    assert.equal(dynamic.isValid, false); assert.equal(f.view.recoveryRoot.active, false);
  }
});

test('rerendered settings routes one command per touch and observes both input gates', () => {
  const f = fixture(); f.presentation.showSettings(); f.presentation.showSettings();
  f.tap(f.view.effectsButton); f.tap(f.view.musicButton); f.tap(f.view.colorBlindButton); f.tap(f.view.reducedMotionButton);
  assert.deepEqual(JSON.parse(JSON.stringify(f.intents)), [
    { type: 'p10.toggle-setting', payload: { key: 'effectsVolume', value: 0 } }, { type: 'p10.toggle-setting', payload: { key: 'musicVolume', value: 0 } },
    { type: 'p10.toggle-setting', payload: { key: 'colorBlindMode', value: true } }, { type: 'p10.toggle-setting', payload: { key: 'reducedMotion', value: true } },
  ]);
  f.presentation.setInputEnabled(false); f.tap(f.view.effectsButton); f.tap(f.view.backButton);
  f.presentation.setInputEnabled(true); f.setNavigationEnabled(false); f.tap(f.view.musicButton); f.tap(f.view.productButton);
  assert.equal(f.intents.length, 4); assert.equal(f.navigationCalls.length, 0);
  f.setNavigationEnabled(true); f.tap(f.view.backButton); f.tap(f.view.recoveryButton); f.tap(f.view.productButton);
  assert.deepEqual(f.navigationCalls, ['map', 'recovery', 'product']);
});

test('normal settings fade and reduced motion reuse the authored transition', () => {
  const f = fixture(); f.presentation.showSettings();
  assert.equal(f.view.transition.active, true);
  f.presentation.update(.2); assert.equal(f.view.transition.active, false);
  f.presentation.readModel = model({ reducedMotion: true }); f.presentation.showSettings();
  assert.equal(f.view.transition.active, false); assert.equal(f.view.transition.isValid, true);
});

test('missing or destroyed fixed bindings fail visibly instead of publishing stale input', () => {
  const f = fixture(); f.view.effectsButton.destroy();
  assert.throws(() => f.presentation.showSettings(), /Cook settings binding is missing: effectsButton/);
  assert.equal(f.presentation.tapTargets.length, 0); assert.equal(f.intents.length, 0);
});

test('saved recovery root and all eleven typed references remain separate from settings', () => {
  const records = JSON.parse(readFileSync(new URL('../../assets/bundles/game/prefabs/SettingsFlowGroup.prefab', import.meta.url), 'utf8'));
  const component = records.find(record => Object.hasOwn(record, 'checkpointSummary'));
  assert.ok(component, 'Creator must save recovery bindings');
  const deref = ref => records[ref.__id__], root = deref(component.recoveryRoot);
  assert.equal(deref(root._parent), deref(component.node)); assert.notEqual(root, deref(component.settingsRoot));
  const descendants = new Set(); const walk = node => { descendants.add(node); for (const child of node._children) walk(deref(child)); }; walk(root);
  for (const key of ['recoveryHeader', 'recoveryTransition', 'resumeButton', 'resetButton', 'recoveryBack']) assert.ok(descendants.has(deref(component[key])), key);
  for (const key of ['recoveryBackground', 'recoveryCurrency', 'checkpointSummary', 'checkpointStatus', 'resumeLabel']) assert.ok(descendants.has(deref(deref(component[key]).node)), key);
});

test('recovery projects checkpoint branches and viewport geometry without changing progress', () => {
  const f = fixture(), before = JSON.stringify(f.presentation.readModel);
  f.view.presentRecovery(f.presentation.readModel, { ...viewport, height: 1800, topY: 820, bottomY: -840 });
  assert.equal(f.view.resumeLabel.string, '返回地图'); assert.equal(f.view.checkpointStatus.string, '安全档有效，无未完成关卡');
  assert.equal(f.view.checkpointSummary.string, '金币 42 · 星章 3 · 声望 7');
  assert.equal(f.view.node.getComponent(UiTransform).contentSize.height, 1800);
  assert.equal(f.view.recoveryRoot.getComponent(UiTransform).contentSize.height, 1800);
  assert.equal(f.view.recoveryBack.position.y, -807); assert.equal(JSON.stringify(f.presentation.readModel), before);
  f.presentation.readModel.progress.hasCheckpoint = true; f.view.presentRecovery(f.presentation.readModel, viewport);
  assert.equal(f.view.resumeLabel.string, '恢复检查点'); assert.equal(f.view.checkpointStatus.string, '检查点有效，可恢复关卡');
});

test('recovery resume/reset routes once, respects input guards, and never mutates its projection', () => {
  const f = fixture(); f.presentation.showRecovery(); f.presentation.showRecovery(); f.tap(f.view.resumeButton);
  assert.deepEqual(f.navigationCalls, ['map']); assert.equal(f.intents.length, 0);
  f.presentation.readModel.progress.hasCheckpoint = true; f.presentation.showRecovery(); const before = JSON.stringify(f.presentation.readModel);
  f.tap(f.view.resumeButton); f.tap(f.view.resetButton);
  assert.deepEqual(JSON.parse(JSON.stringify(f.intents)), [{ type: 'p10.resume-checkpoint', payload: {} }, { type: 'p10.reset-save', payload: {} }]);
  assert.equal(JSON.stringify(f.presentation.readModel), before);
  f.presentation.setInputEnabled(false); f.tap(f.view.resetButton); f.tap(f.view.recoveryBack);
  f.presentation.setInputEnabled(true); f.setNavigationEnabled(false); f.tap(f.view.resumeButton);
  assert.equal(f.intents.length, 2); assert.deepEqual(f.navigationCalls, ['map']);
});
