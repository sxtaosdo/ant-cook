import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function fixture() {
  class Vec3 { constructor(x=0,y=0,z=0) { Object.assign(this,{x,y,z}); } clone() { return new Vec3(this.x,this.y,this.z); } }
  class Widget {} class UITransform {}
  let height = 1334, safeTop = height;
  const callbacks = new Map();
  const animations = [];
  const stack = []; class Business {} class Speed {} class Progress { countsAsBusinessPopup() { return !this.gm; } } class Toast {}
  const source = readFileSync(new URL('../../assets/Colony/scripts/views/currencyOverlayView.ts', import.meta.url), 'utf8');
  const exports = {}, decorator = () => () => {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, experimentalDecorators: true, useDefineForClassFields: false } }).outputText,
  { exports, require: name => name === 'cc' ? { _decorator: { ccclass: decorator, property: decorator }, Button: { EventType: { CLICK: 'click' } }, Vec3,
    Widget, UITransform, sys: { getSafeAreaRect: () => ({ y: 0, height: safeTop }) },
    view: { on(name, callback) { callbacks.set(name, callback); }, off(name) { callbacks.delete(name); } },
    Tween: { stopAllByTarget(target) { for (const animation of animations) if (animation.target === target) animation.stopped = true; } },
    tween: target => { const animation = { target }; return {
      to(duration, end, options) { Object.assign(animation, { duration, end, options }); return this; },
      call(done) { animation.done = done; return this; }, start() { animations.push(animation); },
    }; } }
    : name === 'mk' ? { default: { StaticViewBase: class {}, uiManage: { get: () => stack } } }
    : name.includes('progressView') ? { ColonyProgressView: Progress }
    : name.includes('speedView') ? { ColonySpeedView: Speed }
    : Object.fromEntries(['ColonyCommunityView','ColonySettingsView','ColonyConfirmView','ColonyShopView','ColonyToolView','ColonyResultSuccessView','ColonyResultFailView'].map(key => [key, Business])) });
  const owner = { isValid: true }, overlay = new exports.ColonyCurrencyOverlayView();
  const listeners = [], button = { node: { isValid: true, targetOff() {}, on(_event, action) { listeners.push(action); } } };
  const screenWidget = { updateAlignment() {} }, transform = { get height() { return height; }, anchorY: 0.5,
    convertToWorldSpaceAR: p => new Vec3(p.x, p.y + height / 2), convertToNodeSpaceAR: p => new Vec3(p.x, p.y - height / 2) };
  overlay.node = { getComponent: type => type === Widget ? screenWidget : transform };
  const barsWidget = { top: 0, enabled: true, isValid: true, updateAlignment() { overlay.bars.setPosition(0, height / 2 - this.top - 32.5, 0); } };
  const profileWidget = { top: 73, updateAlignment() { overlay.profileStrip.position = new Vec3(0, height / 2 - this.top - 14); } };
  overlay.bars = { isValid: true, active: true, scale: new Vec3(0.65, 0.65, 1), getComponent: type => type === Widget ? barsWidget : { height: 100 },
    position: new Vec3(0,548), setPosition(x,y,z) { this.position = typeof x === 'object' ? x.clone() : new Vec3(x,y,z); } };
  overlay.profileStrip = { active: true, getComponent: () => profileWidget };
  overlay.coins = { string: '' }; overlay.diamonds = { string: '' };
  overlay.diamondButton = button; overlay.plusButton = button;
  let wallet = { coins: 40, diamonds: 30 }, clicks = 0;
  const profileCoverage = [];
  overlay.bind(owner, () => wallet, () => clicks++, covered => profileCoverage.push(covered));
  const popup = (Type = Business, parent = owner) => Object.assign(new Type(), { node: { parent, activeInHierarchy: false } });
  return { stack, overlay, popup, Progress, Speed, Toast, owner, listeners, barsWidget, profileWidget, callbacks, animations, profileCoverage,
    finish(animation = animations.at(-1)) { if (!animation.stopped) { animation.target.setPosition(animation.end.position); animation.done(); } },
    resize(nextHeight, nextSafeTop = nextHeight) { height = nextHeight; safeTop = nextSafeTop; callbacks.get('canvas-resize').call(overlay); },
    setWallet: value => { wallet = value; }, clicks: () => clicks };
}

test('actual manager stack excludes Toast, GM and foreign owners, including a hidden underlying business popup', () => {
  const f = fixture(); f.overlay.lateUpdate(); assert.equal(f.overlay.bars.active, false);
  f.stack.push(f.popup(f.Toast)); f.overlay.lateUpdate(); assert.equal(f.overlay.bars.active, false);
  const gm = f.popup(f.Progress); gm.gm = true; f.stack.push(gm, f.popup(undefined, {}));
  f.overlay.lateUpdate(); assert.equal(f.overlay.bars.active, false);
  const bottom = f.popup(), top = f.popup(); f.stack.push(bottom, top); f.overlay.lateUpdate();
  assert.equal(f.overlay.bars.active, true); assert.equal(f.overlay.coins.string, '40');
  f.stack.pop(); f.overlay.lateUpdate(); assert.equal(f.overlay.bars.active, true);
  f.stack.pop(); f.overlay.lateUpdate(); assert.equal(f.overlay.bars.active, true);
  assert.equal(f.overlay.plusButton.interactable, false);
  assert.equal(f.animations.at(-1).options.easing, 'quadIn');
  f.finish(); assert.equal(f.overlay.bars.active, false);
});

test('dedicated speed popup retains the owner wallet while foreign speed and Toast alone stay hidden', () => {
  const f = fixture();
  f.stack.push(f.popup(f.Speed, {}), f.popup(f.Toast)); f.overlay.lateUpdate();
  assert.equal(f.overlay.bars.active, false);
  f.stack.push(f.popup(f.Speed)); f.overlay.lateUpdate(); f.finish();
  assert.equal(f.overlay.bars.active, true); assert.equal(f.overlay.coins.string, '40');
  f.stack.pop(); f.overlay.lateUpdate(); f.finish();
  assert.equal(f.overlay.bars.active, false); assert.equal(f.overlay.plusButton.interactable, false);
});

test('top placement follows the Canvas and safe-area inset instead of the old fixed y, including resize', () => {
  const f = fixture();
  assert.equal(f.overlay.bars.position.y, 634.5);
  assert.equal(f.barsWidget.top, 0);
  assert.equal(f.profileWidget.top, 73);
  assert.equal(f.overlay.profileStrip.active, false);
  f.stack.push(f.popup()); f.overlay.lateUpdate();
  f.resize(1334, 1290);
  assert.equal(f.barsWidget.enabled, true);
  assert.equal(f.barsWidget.top, 44);
  assert.equal(f.overlay.bars.position.y, 590.5);
  assert.equal(f.overlay.profileStrip.position.y, 536);
  assert.equal(f.overlay.bars.active, true);
  f.resize(1600);
  assert.equal(f.overlay.bars.position.y, 767.5);
  assert.equal(f.barsWidget.top, 0);
  f.overlay.onDestroy();
  assert.equal(f.callbacks.size, 0);
});

test('popup replacement holds only an existing real business stack, releases after success or failure, and reads the wallet authority', () => {
  const f = fixture(); const emptyRelease = f.overlay.holdDuringSwitch(); f.overlay.lateUpdate();
  assert.equal(f.overlay.bars.active, false); emptyRelease();
  f.stack.push(f.popup()); const release = f.overlay.holdDuringSwitch(); f.stack.length = 0;
  f.overlay.lateUpdate(); assert.equal(f.overlay.bars.active, true);
  f.setWallet({ coins: 81, diamonds: 20 }); f.overlay.lateUpdate(); assert.equal(f.overlay.coins.string, '81'); assert.equal(f.overlay.diamonds.string, '20');
  release(); release(); f.overlay.lateUpdate(); assert.equal(f.overlay.bars.active, true);
  f.finish(); assert.equal(f.overlay.bars.active, false);
  f.listeners.forEach(action => action()); assert.equal(f.clicks(), 2);
  f.overlay.onDestroy(); f.stack.push(f.popup()); f.overlay.lateUpdate(); assert.equal(f.overlay.bars.active, false);
});

test('quick close/reopen cancels retraction and ignores a stale hide callback', () => {
  const f = fixture(); f.stack.push(f.popup()); f.overlay.lateUpdate(); f.finish();
  const resting = f.overlay.bars.position.y;
  f.stack.length = 0; f.overlay.lateUpdate(); const retract = f.animations.at(-1);
  f.overlay.bars.setPosition(0, resting + 35, 0);
  f.stack.push(f.popup()); f.overlay.lateUpdate();
  assert.equal(retract.stopped, true);
  assert.equal(f.overlay.bars.position.y, resting + 35);
  retract.done(); assert.equal(f.overlay.bars.active, true);
  assert.equal(f.barsWidget.enabled, false);
  f.finish(); assert.equal(f.overlay.bars.position.y, resting); assert.equal(f.barsWidget.enabled, true);
  assert.equal(f.overlay.plusButton.interactable, true);
});

test('page profile stays covered through retraction and stale reopen completions, then restores after exit or destruction', () => {
  const f = fixture();
  assert.equal(f.profileCoverage.at(-1), false);
  f.stack.push(f.popup()); f.overlay.lateUpdate(); f.finish();
  assert.equal(f.profileCoverage.at(-1), true);
  f.stack.length = 0; f.overlay.lateUpdate();
  assert.equal(f.profileCoverage.at(-1), true);
  const retract = f.animations.at(-1);
  f.stack.push(f.popup()); f.overlay.lateUpdate(); retract.done();
  assert.equal(f.profileCoverage.at(-1), true);
  f.finish(); f.stack.length = 0; f.overlay.lateUpdate(); f.finish(); f.overlay.lateUpdate();
  assert.equal(f.profileCoverage.at(-1), false);
  f.stack.push(f.popup()); f.overlay.lateUpdate();
  f.overlay.onDestroy(); assert.equal(f.profileCoverage.at(-1), false);
});

test('actual Home and HUD profile visibility does not lose updates or touch destroyed label nodes', () => {
  const decorator = () => () => {};
  for (const [file, name] of [['homeView.ts', 'ColonyHomeView'], ['hudView.ts', 'ColonyHudView']]) {
    const source = readFileSync(new URL(`../../assets/Colony/scripts/views/${file}`, import.meta.url), 'utf8');
    const exports = {};
    runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, experimentalDecorators: true, useDefineForClassFields: false } }).outputText,
    { exports, require: path => path === 'cc' ? { _decorator: { ccclass: decorator, property: decorator },
      Label: class {}, Node: class {}, Button: class {}, Sprite: class {} }
      : path === 'mk' ? { default: { StaticViewBase: class {} } } : { ColonyGmButtonView: class {} } });
    const view = new exports[name]();
    view.nicknameLabel = { string: '', node: { active: true, isValid: true } };
    view.buildVersionLabel = { string: '', node: { active: true, isValid: true } };
    view.setProfileVisible(false); view.setProfile('新昵称', '0.3.0.84');
    assert.equal(view.nicknameLabel.node.active, false);
    assert.equal(view.buildVersionLabel.node.active, false);
    assert.equal(view.nicknameLabel.string, '新昵称');
    view.setProfileVisible(true);
    assert.equal(view.nicknameLabel.node.active, true);
    assert.equal(view.buildVersionLabel.string, 'v0.3.0.84');
    view.nicknameLabel.node = null; view.buildVersionLabel.node.isValid = false;
    assert.doesNotThrow(() => view.setProfileVisible(false));
    assert.equal(view.buildVersionLabel.node.active, true);
  }
});

test('resize settles a closing animation and destruction cancels outstanding completions', () => {
  const f = fixture(); f.stack.push(f.popup()); f.overlay.lateUpdate(); f.finish();
  f.stack.length = 0; f.overlay.lateUpdate(); const retract = f.animations.at(-1);
  f.resize(1334, 1290);
  assert.equal(retract.stopped, true); assert.equal(f.overlay.bars.active, false);
  assert.equal(f.overlay.profileStrip.active, false); assert.equal(f.barsWidget.enabled, true);
  retract.done(); assert.equal(f.overlay.bars.position.y, 590.5);
  f.stack.push(f.popup()); f.overlay.lateUpdate(); const entrance = f.animations.at(-1);
  f.overlay.onDestroy(); assert.equal(entrance.stopped, true); entrance.done();
  assert.equal(f.barsWidget.enabled, false); assert.equal(f.callbacks.size, 0);
});

test('actual mount attaches to the Canvas and clears instance offset before layout binding', async () => {
  const source = readFileSync(new URL('../../assets/Colony/scripts/presentation/currencyOverlay.ts', import.meta.url), 'utf8');
  const canvas = { isValid: true }, popupRoot = {}, session = { node: { parent: canvas }, popupRoot, profile: { snapshot: () => ({ nickname: '小蚂蚁' }) } };
  const node = { parent: null, position: { x: 50, y: 80, z: 0 }, setPosition(x, y, z) { this.position = { x, y, z }; }, getComponent: () => overlay, destroy() { this.destroyed = true; } };
  let bound = 0, coverProfiles;
  const overlay = { bind(owner, _wallet, _shop, cover) { coverProfiles = cover; assert.equal(owner, popupRoot); assert.equal(node.parent, canvas); assert.deepEqual(node.position, { x: 0, y: 0, z: 0 }); bound++; },
    setProfile(nickname) { assert.equal(nickname, '小蚂蚁'); } };
  const exports = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: name => name === 'cc' ? { Prefab: class {}, instantiate: () => node }
      : name === 'mk' ? { default: { asset: { get: async () => ({}) }, Release: { followRelease() {} } } }
      : name.includes('colonyUtil') ? { ColonyUtil: { applyUiLayer() {} } }
      : name.includes('buildInfo') ? { COLONY_BUILD_VERSION: '0.3.0.43' }
      : {} });
  await exports.mountCurrencyOverlay(session);
  assert.equal(session.currencyView, overlay); assert.equal(bound, 1);
  assert.equal(typeof coverProfiles, 'function');
  const visible = [];
  session.homeView = { setProfileVisible: value => visible.push(['home', value]) };
  session.hudView = { setProfileVisible: value => visible.push(['hud', value]) };
  coverProfiles(true); assert.deepEqual(visible, [['home', false], ['hud', false]]);
  session.homeView = { setProfileVisible: value => visible.push(['new-home', value]) };
  coverProfiles(false); assert.deepEqual(visible.at(-2), ['new-home', true]);
  session.destroyed = true; const calls = visible.length; coverProfiles(true); assert.equal(visible.length, calls);
  session.destroyed = false;
  await exports.mountCurrencyOverlay(session); assert.equal(bound, 1);
  session.currencyView = null; session.node.parent = null;
  await assert.rejects(exports.mountCurrencyOverlay(session), /Canvas/);
  assert.equal(node.destroyed, true); assert.equal(session.currencyView, null);
});
