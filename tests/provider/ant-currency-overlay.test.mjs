import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function fixture() {
  class Vec3 { constructor(x=0,y=0,z=0) { Object.assign(this,{x,y,z}); } clone() { return new Vec3(this.x,this.y,this.z); } }
  const stack = []; class Business {} class Progress { countsAsBusinessPopup() { return !this.gm; } } class Toast {}
  const source = readFileSync(new URL('../../assets/Colony/scripts/views/currencyOverlayView.ts', import.meta.url), 'utf8');
  const exports = {}, decorator = () => () => {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, experimentalDecorators: true, useDefineForClassFields: false } }).outputText,
  { exports, require: name => name === 'cc' ? { _decorator: { ccclass: decorator, property: decorator }, Button: { EventType: { CLICK: 'click' } }, Vec3,
    Tween: { stopAllByTarget() {} }, tween: () => ({ to() { return this; }, start() {} }) }
    : name === 'mk' ? { default: { StaticViewBase: class {}, uiManage: { get: () => stack } } }
    : name.includes('progressView') ? { ColonyProgressView: Progress }
    : Object.fromEntries(['ColonyCommunityView','ColonySettingsView','ColonyConfirmView','ColonyShopView','ColonyToolView','ColonyResultSuccessView','ColonyResultFailView'].map(key => [key, Business])) });
  const owner = { isValid: true }, overlay = new exports.ColonyCurrencyOverlayView();
  const listeners = [], button = { node: { isValid: true, targetOff() {}, on(_event, action) { listeners.push(action); } } };
  overlay.bars = { active: true, position: new Vec3(0,548), setPosition(x,y,z) { this.position = typeof x === 'object' ? x.clone() : new Vec3(x,y,z); } }; overlay.coins = { string: '' }; overlay.diamonds = { string: '' };
  overlay.diamondButton = button; overlay.plusButton = button;
  let wallet = { coins: 40, diamonds: 30 }, clicks = 0;
  overlay.bind(owner, () => wallet, () => clicks++);
  const popup = (Type = Business, parent = owner) => Object.assign(new Type(), { node: { parent, activeInHierarchy: false } });
  return { stack, overlay, popup, Progress, Toast, owner, listeners, setWallet: value => { wallet = value; }, clicks: () => clicks };
}

test('actual manager stack excludes Toast, GM and foreign owners, including a hidden underlying business popup', () => {
  const f = fixture(); f.overlay.lateUpdate(); assert.equal(f.overlay.bars.active, false);
  f.stack.push(f.popup(f.Toast)); f.overlay.lateUpdate(); assert.equal(f.overlay.bars.active, false);
  const gm = f.popup(f.Progress); gm.gm = true; f.stack.push(gm, f.popup(undefined, {}));
  f.overlay.lateUpdate(); assert.equal(f.overlay.bars.active, false);
  const bottom = f.popup(), top = f.popup(); f.stack.push(bottom, top); f.overlay.lateUpdate();
  assert.equal(f.overlay.bars.active, true); assert.equal(f.overlay.coins.string, '40');
  f.stack.pop(); f.overlay.lateUpdate(); assert.equal(f.overlay.bars.active, true);
  f.stack.pop(); f.overlay.lateUpdate(); assert.equal(f.overlay.bars.active, false);
});

test('popup replacement holds only an existing real business stack, releases after success or failure, and reads the wallet authority', () => {
  const f = fixture(); const emptyRelease = f.overlay.holdDuringSwitch(); f.overlay.lateUpdate();
  assert.equal(f.overlay.bars.active, false); emptyRelease();
  f.stack.push(f.popup()); const release = f.overlay.holdDuringSwitch(); f.stack.length = 0;
  f.overlay.lateUpdate(); assert.equal(f.overlay.bars.active, true);
  f.setWallet({ coins: 81, diamonds: 20 }); f.overlay.lateUpdate(); assert.equal(f.overlay.coins.string, '81'); assert.equal(f.overlay.diamonds.string, '20');
  release(); release(); f.overlay.lateUpdate(); assert.equal(f.overlay.bars.active, false);
  f.listeners.forEach(action => action()); assert.equal(f.clicks(), 2);
  f.overlay.onDestroy(); f.stack.push(f.popup()); f.overlay.lateUpdate(); assert.equal(f.overlay.bars.active, false);
});
