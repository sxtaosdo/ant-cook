import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { StateMachine } from 'db://shidai3/index';
import * as auth from 'db://shidai3/auth/index';
import * as telemetry from 'db://shidai3/observability/index';
import { PRODUCT_BUILD_VERSION } from '../../assets/shell/buildInfo';
import * as contracts from '../../assets/shell/contracts.ts';

const decorators = { ccclass: () => Type => Type, property: (_target, key) => typeof key === 'string' ? undefined : () => {} };
class UiNode {
  static EventType = { TOUCH_END: 'touch-end' };
  active = true; isValid = true; parent = null; position = { x: 0, y: 0, z: 0 }; listeners = [];
  get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
  on(event, callback, target) { this.listeners.push({ event, callback, target }); }
  targetOff(target) { this.listeners = this.listeners.filter(listener => listener.target !== target); }
  emit(event = UiNode.EventType.TOUCH_END) {
    for (const listener of [...this.listeners]) if (listener.event === event) listener.callback.call(listener.target);
  }
  setPosition(x, y, z = 0) { this.position = { x, y, z }; }
}

function navigationFixture(accountBindings = true) {
  const cc = { _decorator: decorators, Node: UiNode, Label: class {}, Graphics: class {}, UITransform: class {} };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../../assets/shell/productNavigationView.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, useDefineForClassFields: false },
  }).outputText, { exports, require: name => {
    if (name === 'cc') return cc;
    if (name === 'mk') return { default: { StaticViewBase: class {} } };
    throw Error(`Unresolved actual navigation import: ${name}`);
  } });
  const view = new exports.ProductNavigationView(); view.node = new UiNode();
  view.rootTransform = { setContentSize() {} }; view.backdrop = {}; view.panelPaper = {}; view.panel = new UiNode();
  for (const key of ['antButton', 'cookButton', 'continueButton', 'retryButton']) {
    view[key] = new UiNode(); view[key].parent = view.node;
  }
  for (const key of ['antLabel', 'cookLabel', 'continueLabel', 'retryLabel', 'statusLabel']) view[key] = { string: '' };
  view.buttonPlates = [{}, {}, {}, {}];
  // cc drawing only; real configure/reveal/event/projection methods execute below.
  view.drawPlates = () => {}; view.drawPlate = () => {};
  if (accountBindings) {
    view.accountStatusLabel = { string: '' }; view.accountActionLabel = { string: '' };
    view.accountActionButton = new UiNode(); view.accountActionButton.parent = view.node;
  }
  return view;
}

function fixture(navigation = null) {
  const scene = {}, transitions = [], timers = [];
  class Component { isValid = true; enabledInHierarchy = true; schedule() {} unschedule() {} }
  class Coordinator {
    lastPlayed = 'ant';
    constructor(_modes, driver, _storage, _unused, port) { this.telemetry = port; this.driver = driver; }
  }
  const cc = { Component, Camera: class {}, Canvas: class {}, Node: class {}, Label: class {}, UITransform: class {},
    _decorator: decorators,
    director: { getScene: () => scene, addPersistRootNode() {}, off() {}, once(_event, callback) { callback(); } },
    Director: { EVENT_BEFORE_UPDATE: 'before-update', EVENT_AFTER_DRAW: 'after-draw' },
    Layers: { addLayer() {} }, ResolutionPolicy: { FIXED_WIDTH: 1 },
    view: { setDesignResolutionSize() {}, getVisibleSize: () => ({ width: 750, height: 1334 }) },
    sys: { isNative: false, platform: 'web', Platform: { WECHAT_GAME: 'wechat' }, localStorage: {},
      getSafeAreaRect: () => ({ x: 0, y: 0, width: 750, height: 1334 }) } };
  const imports = { cc, 'db://shidai3/index': { StateMachine }, 'db://shidai3/auth/index': auth,
    'db://shidai3/observability/index': telemetry, mk: { default: { bundle: { async loadScene() { return {}; } } } },
    './buildModes': { BUILD_MODES: [{ id: 'ant' }] }, './contracts': contracts,
    './promotion': { ShellPromotion: class {} }, './switchCoordinator': { SwitchCoordinator: Coordinator },
    './productNavigationView': { ProductNavigationView: class {} }, './buildInfo': { PRODUCT_BUILD_VERSION } };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../../assets/shell/productBootstrap.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, useDefineForClassFields: false },
  }).outputText, { exports, Date, Math, setTimeout() { timers.push('schedule'); throw Error('No auth deadline without ports'); },
    clearTimeout() { timers.push('cancel'); }, require: name => {
      assert.ok(Object.hasOwn(imports, name), `Unresolved actual Bootstrap import: ${name}`);
      return imports[name];
    } });
  const root = new exports.ProductBootstrap(); root.node = { parent: scene, getComponent: () => ({ setContentSize() {} }) };
  if (navigation) {
    root.navigationView = navigation; root.shellCamera = {}; root.shellCanvas = {};
  } else root.initializeNavigation = () => {};
  root.openMode = async mode => { transitions.push(mode); };
  return { root, timers, transitions, runningState: exports.ShellRunningState };
}

const projection = (authStatus, feedback = authStatus, canRequestLogin = false) =>
  Object.freeze({ authStatus, feedback, canRequestLogin, localPlayAvailable: true });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function configuredFacade(credential, exchange, clock = { now: () => 1000, schedule: () => 1, cancel() {} }) {
  return new auth.LoginFacade({ clock, timeoutMs: 10000,
    config: { enabled: true, platformConfigured: true, provider: 'google',
      scope: { issuer: 'fixture', applicationId: 'fixture', host: 'fixture' } }, credential, exchange });
}
const syntheticCredential = () => ({ provider: 'google', scope: { issuer: 'fixture', applicationId: 'fixture', host: 'fixture' },
  proof: { kind: 'google-id-token', idToken: 'synthetic', nonce: 'synthetic' } });
const syntheticSession = () => ({ gameAccountId: 'synthetic', sessionId: 'synthetic', expiresAtMs: 2000 });
const settle = () => new Promise(resolve => setImmediate(resolve));

test('actual Bootstrap owns a disabled shared LoginFacade without startup login and disposes once', async () => {
  const { root, timers, transitions } = fixture();
  await root.boot();
  assert.ok(root.loginFacade instanceof auth.LoginFacade);
  assert.equal(root.loginFacade.readiness().status, 'disabled');
  assert.deepEqual(root.loginFacade.snapshot().auth, { status: 'guest' });
  assert.equal((await root.loginFacade.requestLogin()).status, 'unavailable');
  assert.deepEqual(timers, []);
  assert.deepEqual(transitions, ['ant']);
  assert.ok(root.telemetry instanceof telemetry.TelemetryClient);
  assert.ok(root.telemetryRecords instanceof telemetry.LocalRecordingAdapter);
  assert.equal(root.coordinator.telemetry, root.telemetry);
  assert.equal(root.telemetry.flush().status, 'disabled');
  assert.equal(root.telemetry.capabilities().externalDelivery, false);
  assert.deepEqual(root.telemetryRecords.snapshot(), []);
  const facade = root.loginFacade;
  let disposals = 0;
  const dispose = facade.dispose.bind(facade);
  facade.dispose = () => { disposals++; dispose(); };
  root.initializeAccount();
  assert.equal(root.loginFacade, facade);
  root.onDestroy(); root.onDestroy(); root.initializeAccount();
  assert.equal(disposals, 1);
  assert.equal(root.loginFacade, null);
});

test('ready shared facade at actual Bootstrap startup acquires no credential or exchange; only explicit current entry acts', async () => {
  const { root, transitions } = fixture();
  let acquires = 0, exchanges = 0, current = true, reads = 0;
  const scope = { issuer: 'fixture', applicationId: 'fixture', host: 'fixture' };
  const facade = root.loginFacade = new auth.LoginFacade({
    config: { enabled: true, platformConfigured: true, provider: 'google', scope },
    clock: { now: () => 1000, schedule: () => 1, cancel() {} },
    credential: { async acquire() { acquires++; return { provider: 'google', scope, proof: { kind: 'google-id-token', idToken: 'synthetic', nonce: 'synthetic' } }; } },
    exchange: { async exchange() { exchanges++; return { gameAccountId: 'synthetic', sessionId: 'synthetic', expiresAtMs: 2000 }; } },
  });
  const snapshot = facade.snapshot.bind(facade);
  facade.snapshot = () => { reads++; return snapshot(); };
  await root.boot();
  assert.equal(acquires, 0); assert.equal(exchanges, 0); assert.deepEqual(transitions, ['ant']);
  await root.coordinator.driver.enter({ id: 'ant', bundleName: 'Colony', sceneName: 'ColonyGame' }, { mode: 'ant', isCurrent: () => current });
  const port = contracts.ModuleEntryGate.require('ant').account;
  assert.deepEqual(Object.keys(port.snapshot()).sort(), ['authStatus', 'canRequestLogin', 'feedback', 'localPlayAvailable']);
  await port.requestLogin(); assert.equal(acquires, 1); assert.equal(exchanges, 1);
  assert.equal(port.snapshot().authStatus, 'active');
  current = false; const before = reads;
  assert.equal(port.snapshot().feedback, 'unavailable');
  await port.requestLogin(); port.cancel(); port.logout();
  assert.equal(reads, before); assert.equal(facade.snapshot().auth.status, 'active');
  root.onDestroy(); current = true;
  assert.equal(port.snapshot().feedback, 'unavailable');
  await port.requestLogin(); assert.equal(acquires, 1);
});

test('actual navigation renders account feedback and binds explicit actions without changing gameplay controls', () => {
  const view = navigationFixture(), actions = [];
  view.configure({ enter() {}, continueCurrent() {}, retry() {}, account: action => actions.push(action) });
  view.reveal(['ant', 'cook'], 'ant', true, true, '重试入口记录', 750, 1334, 0, 0);
  view.presentAccount(projection('guest', 'unavailable'));
  assert.match(view.accountStatusLabel.string, /未配置.*游客/);
  assert.equal(view.accountActionButton.active, false);
  view.accountActionButton.emit(); assert.deepEqual(actions, []);
  view.presentAccount(projection('guest', 'guest', true));
  view.accountActionButton.emit(); assert.deepEqual(actions, ['login']);
  view.presentAccount(projection('pending')); assert.equal(view.accountActionLabel.string, '取消登录');
  view.accountActionButton.emit();
  for (const feedback of ['failed', 'timeout', 'cancelled', 'expired']) {
    view.presentAccount(projection(feedback === 'expired' ? 'expired' : 'guest', feedback, true));
    assert.equal(view.accountActionLabel.string, '登录'); assert.ok(view.accountStatusLabel.string);
  }
  view.presentAccount(projection('active')); assert.equal(view.accountStatusLabel.string, '已登录');
  view.accountActionButton.emit(); assert.deepEqual(actions, ['login', 'cancel', 'logout']);
  assert.equal(view.continueButton.active, true); assert.equal(view.retryButton.active, true);
  assert.equal(view.retryLabel.string, '重试入口记录');
  view.onDisable(); view.accountActionButton.emit(); assert.equal(actions.length, 3);
  view.node.active = false; view.actOnAccount(); assert.equal(actions.length, 3);
  view.node.active = true; view.onEnable(); view.onEnable();
  view.accountActionButton.emit(); assert.equal(actions.length, 4);
  view.onDestroy(); view.accountActionButton.emit(); assert.equal(actions.length, 4);
});

test('legacy and partial navigation account bindings keep local continue and retry usable', () => {
  for (const partial of [false, true]) {
    const view = navigationFixture(false), calls = [];
    if (partial) { view.accountStatusLabel = { string: '' }; view.accountActionButton = new UiNode(); }
    view.configure({ enter() {}, continueCurrent: () => calls.push('continue'), retry: () => calls.push('retry'),
      account: () => calls.push('account') });
    view.reveal(['ant'], 'ant', true, true, '重试保存', 750, 1334, 0, 0);
    view.presentAccount(projection('guest', 'guest', true));
    if (partial) {
      assert.match(view.accountStatusLabel.string, /入口未配置/); assert.equal(view.accountActionButton.active, false);
      view.accountActionButton.emit();
    }
    view.continueButton.emit(); view.retryButton.emit(); assert.deepEqual(calls, ['continue', 'retry']);
  }
});

test('actual Bootstrap navigation startup and repeated visible rendering never request login with disabled or missing exchange', async () => {
  for (const missingExchange of [false, true]) {
    const view = navigationFixture(), { root, timers, transitions } = fixture(view);
    let acquires = 0;
    if (missingExchange) root.loginFacade = configuredFacade({ async acquire() { acquires++; return syntheticCredential(); } });
    await root.boot(); root.update(); root.update();
    assert.deepEqual(transitions, ['ant']); assert.equal(acquires, 0); assert.deepEqual(timers, []);
    assert.equal(root.loginFacade.snapshot().auth.status, 'guest');
    assert.match(view.accountStatusLabel.string, /未配置.*游客/);
    assert.equal(view.accountActionButton.active, false);
    view.accountActionButton.emit(); root.accountAction('login'); assert.equal(acquires, 0);
    assert.equal(root.telemetry.flush().status, 'disabled'); assert.deepEqual(root.telemetryRecords.snapshot(), []);
    root.onDestroy();
  }
});

test('explicit shell login shares one pending session across Ant and Cook while local continue and retry remain independent', async () => {
  const view = navigationFixture(), { root, runningState } = fixture(view), material = deferred();
  let acquires = 0, exchanges = 0, antCurrent = true, cookCurrent = true, localSaves = 0;
  const facade = root.loginFacade = configuredFacade({ acquire() { acquires++; return material.promise; } },
    { async exchange() { exchanges++; return syntheticSession(); } });
  await root.boot();
  const driver = root.coordinator.driver;
  await driver.enter({ id: 'ant', bundleName: 'Colony', sceneName: 'ColonyGame' }, { mode: 'ant', isCurrent: () => antCurrent });
  const ant = contracts.ModuleEntryGate.require('ant').account;
  view.accountActionButton.emit(); root.accountAction('login');
  assert.equal(acquires, 1); assert.equal(exchanges, 0); assert.equal(ant.snapshot().authStatus, 'pending');
  antCurrent = false;
  await driver.enter({ id: 'cook', bundleName: 'game', sceneName: 'Game' }, { mode: 'cook', isCurrent: () => cookCurrent });
  const cook = contracts.ModuleEntryGate.require('cook').account;
  assert.equal(root.loginFacade, facade); assert.equal(cook.snapshot().authStatus, 'pending');
  await ant.requestLogin(); ant.cancel(); ant.logout(); assert.equal(cook.snapshot().authStatus, 'pending');
  await root.StateMachine.changeState(runningState); root.showNavigation();
  root.coordinator.hasPendingMetadata = true; root.coordinator.retryMetadata = () => { localSaves++; return true; };
  root.showNavigation(); view.retryButton.emit(); assert.equal(localSaves, 1);
  view.continueButton.emit(); assert.equal(view.node.active, false); assert.equal(facade.snapshot().auth.status, 'pending');
  material.resolve(syntheticCredential()); await settle();
  assert.equal(exchanges, 1); assert.equal(cook.snapshot().authStatus, 'active'); assert.equal(view.node.active, false);
  root.showNavigation(); assert.equal(view.accountStatusLabel.string, '已登录');
  view.accountActionButton.emit(); assert.equal(cook.snapshot().authStatus, 'guest');
  cookCurrent = false; root.onDestroy();
});

test('shell cancel drops late credentials, allows a fresh explicit retry, and disposal stops late UI updates', async () => {
  const view = navigationFixture(), { root } = fixture(view), attempts = [deferred(), deferred(), deferred()];
  let acquires = 0, exchanges = 0;
  root.loginFacade = configuredFacade({ acquire() { return attempts[acquires++].promise; } },
    { async exchange() { exchanges++; return syntheticSession(); } });
  await root.boot();
  view.accountActionButton.emit(); assert.equal(acquires, 1);
  view.accountActionButton.emit(); assert.equal(root.loginFacade.snapshot().auth.status, 'guest');
  attempts[0].resolve(syntheticCredential()); await settle(); assert.equal(exchanges, 0);
  assert.match(view.accountStatusLabel.string, /取消/);
  view.accountActionButton.emit(); assert.equal(acquires, 2);
  attempts[1].resolve(syntheticCredential()); await settle(); assert.equal(exchanges, 1);
  assert.equal(view.accountStatusLabel.string, '已登录');
  view.accountActionButton.emit(); view.accountActionButton.emit(); assert.equal(acquires, 3);
  const lastText = view.accountStatusLabel.string;
  root.onDestroy(); attempts[2].resolve(syntheticCredential()); await settle(); root.update();
  assert.equal(exchanges, 1); assert.equal(view.accountStatusLabel.string, lastText);
  view.accountActionButton.emit(); assert.equal(acquires, 3);
});
