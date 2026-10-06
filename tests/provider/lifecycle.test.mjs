import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const framework = fileURLToPath(new URL('../../extensions/MKFramework/assets/MKFramework/Framework/', import.meta.url));
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const bounded = promise => Promise.race([promise, new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('Provider operation did not settle')), 300); timer.unref(); })]);

/** Runs actual pool/status/UI/bundle files; cc/IO and View/Event helpers are doubles; Release is optionally real. This is not an engine Runtime check. */
function provider({ editor = true, realRelease = false } = {}) {
  const state = { callbacks: new Map(), directorCallbacks: new Map(), gameCallbacks: new Map(), prefabs: [], nodes: [], instantiateFailure: false, instantiateCause: new Error('instantiate failed'), assetGet: async () => new Prefab(), launched: [], sceneCallbacks: [], release: async () => {} };
  class Node {
    isValid = true; active = true; parent = null; children = []; components = new Map();
    constructor() { state.nodes.push(this); }
    getComponent(Key) { return [...this.components.values()].find(value => value instanceof Key) ?? null; }
    addComponent(Key) { const value = new Key(); value.node = this; this.components.set(Key, value); return value; }
    addChild(node) { node.parent = this; this.children.push(node); }
    removeFromParent() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; }
    destroy() { this.isValid = false; for (const node of this.children) node.destroy(); }
  }
  class Scene extends Node {}
  class Prefab { isValid = true; refs = 1; constructor() { state.prefabs.push(this); } decRef() { this.refs--; } }
  class View {
    isShowAlone = false; orderNum = 0; isStatic = false; closed = false; config = {}; typeStr = 'default';
    get isValid() { return this.node.isValid; } get valid() { return this.node.isValid && !this.closed; }
    async _open() { this.closed = false; } async _close() { this.closed = true; }
  }
  class Event {
    key = new Proxy({}, { get: (_, key) => key }); handlers = new Map();
    on(key, callback, owner) { const list = this.handlers.get(key) ?? []; list.push({ callback, owner }); this.handlers.set(key, list); }
    once() {} request(key, value) { return (this.handlers.get(key) ?? []).map(item => item.callback.call(item.owner, value)); }
    emit(key, ...args) { this.emitted ??= []; this.emitted.push({ key, args }); }
  }
  class Base { static instance() { if (this.name === 'MKBundle' && state.bundle) return state.bundle; return new this(); } }
  class Logger { error() {} warn() {} debug() {} }
  const event = new Event(), scene = new Scene();
  const director = { once: (key, callback) => state.directorCallbacks.set(key, callback), getScene: () => scene, isPersistRootNode: () => false, removePersistRootNode() {},
    runScene: (asset, _, callback) => { state.launched.push(asset.name); state.sceneCallbacks.push(() => callback(null, asset)); } };
  const mocks = {
    cc: { Node, Scene, Prefab, Asset: Prefab, Canvas: class {}, Component: class {}, NodePool: class {}, Constructor: Function,
      instantiate: () => { if (state.instantiateFailure) throw state.instantiateCause; return new Node(); },
      isValid: value => value?.isValid, director, game: { once: (key, callback) => state.gameCallbacks.set(key, callback) },
       Game: { EVENT_GAME_INITED: 'game-inited' }, Director: { EVENT_BEFORE_SCENE_LAUNCH: 'before-scene-launch' }, assetManager: {}, js: { getClassName: key => key.name, createMap: () => ({}), getSuper: key => { const base = Object.getPrototypeOf(key); return base?.prototype ? base : null; } } },
    'cc/env': { EDITOR: editor, PREVIEW: false },
    MKInstanceBase: { default: Base }, MKLogger: { default: Logger, mkLog: new Logger() }, MKViewBase: { default: View }, MKEventTarget: { default: Event },
    MKAsset: { default: { get: (...args) => state.assetGet(...args) } }, GlobalEvent: { default: event },
    MKRelease: { default: class Release { releaseAll() { return state.release(); } static followRelease(owner, callback) { if (!owner) return; const list = state.callbacks.get(owner) ?? []; list.push(callback); state.callbacks.set(owner, list); if (owner.released) { owner.releaseTask = callback(); void owner.releaseTask.catch(() => undefined); } } } },
    MKToolObject: { default: {} },
    MKFollowNodeRelease: { default: class {} },
  };
  if (realRelease) delete mocks.MKRelease;
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path).exports;
    const module = { exports: {} }; cache.set(path, module);
    const compiled = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, useDefineForClassFields: false } }).outputText;
    const require = name => {
      const key = name.split('/').at(-1), mock = mocks[name] ?? mocks[key];
      if (mock) return { __esModule: true, ...mock };
      if (!['MKObjectPool', 'MKStatusTask', 'MKToolFunc', 'MKRelease'].includes(key)) throw Error(`Unexpected Provider dependency: ${name}`);
      return load(resolve(dirname(path), name + '.ts'));
    };
    vm.runInNewContext(compiled, { module, exports: module.exports, require, window: { cc: {} }, setTimeout, clearTimeout, AggregateError, console }, { filename: path });
    return module.exports;
  }
  const { MKUIManage } = load(resolve(framework, 'MKUIManage.ts'));
  const { MKBundle, MKBundle_ } = load(resolve(framework, 'Resources/MKBundle.ts'));
  state.bundle = new MKBundle();
  const ui = new MKUIManage();
  mocks.MKUIManage = { default: ui }; mocks.MKMonitor = { default: { clear() {} } };
  const { default: MVCControlBase } = load(resolve(framework, 'Module/MVC/MVCControlBase.ts'));
  const { default: ObjectPool } = load(resolve(framework, 'MKObjectPool.ts'));
  mocks.mk = { default: { MVCControlBase, uiManage: ui } };
  mocks.progressModel = { ProgressModel: { async new() { return { page: null, close() { state.popupModelCloses = (state.popupModelCloses ?? 0) + 1; } }; } } };
  class PopupView extends View { event = { on() {}, off() {}, targetOff() {} }; isAvailable() { return this.node.isValid; } }
  mocks.progressView = { ColonyProgressView: PopupView };
  mocks.settingsView = { ColonySettingsView: PopupView };
  mocks.confirmView = { ColonyConfirmView: PopupView };
  mocks.socialPopupView = { ColonySocialPopupView: PopupView };
  mocks.shopView = { ColonyShopView: PopupView };
  mocks.colonyUtil = { ColonyUtil: { applyUiLayer() {} } };
  mocks.resultPopupNav = { swallowMkInterrupt: async value => { try { await value; } catch (cause) { if (cause !== '中断') throw cause; } } };
  const { ProgressControl } = load(fileURLToPath(new URL('../../assets/Colony/popups/progress/script/progressControl.ts', import.meta.url)));
  return { state, ui, ObjectPool, MVCControlBase, ProgressControl, PopupView, bundle: state.bundle, BundleManageBase: MKBundle_.BundleManageBase, View, Node, Scene, Prefab, scene };
}
const lazy = { poolInitFillNum: 0, poolMinHoldNum: 0, poolMaxHoldNum: 0 };

test('actual Presentation-Control-MVC failed popup open releases its business placeholder and permits retry', async () => {
  const f = provider(), file = fileURLToPath(new URL('../../assets/Colony/scripts/presentation/progressPresentation.ts', import.meta.url));
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true), printer = ts.createPrinter();
  const Class = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'ProgressPresentation');
  const members = Class.members.filter(node => node.name && ['open', 'createControl', 'waitForControl', 'progressViewType'].includes(node.name.getText(source)))
    .map(node => printer.printNode(ts.EmitHint.Unspecified, node, source)).join('\n');
  const code = ts.transpileModule(`class ProgressPresentation {
    constructor(context, section, onClosed) { this.context=context; this.section=section; this.onClosed=onClosed; }
    read() { return { rows: [] }; } act() {} ${members}
  }; ProgressPresentation`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const Presentation = vm.runInNewContext(code, { ProgressControl: f.ProgressControl, ToolControl: f.ProgressControl, ColonyProgressView: f.PopupView, ColonyLeaderboardView: f.PopupView, console });
  let feedback = '', openCalls = 0;
  const context = { progress: { readSocial: () => ({ unread: 0 }) }, progressPopup: null, popupRoot: f.scene, inputLocked: false,
    hudView: { hideRailBackground() {}, setFeedback(value) { feedback = value; } }, app: { setError() {} },
    play: { snapshot: () => ({ result: 'PLAYING' }) }, homeView: { refresh() {} }, constructionView: { refreshSocialNotice() {} } };
  f.ui.open = async () => { openCalls++; return null; };
  await bounded(Presentation.open(context, 'daily'));
  assert.equal(context.progressPopup, null); assert.equal(context.inputLocked, false); assert.equal(f.state.popupModelCloses, 1);
  assert.match(feedback, /加载失败/);
  const view = new f.PopupView(); view.node = new f.Node();
  f.ui.open = async () => { openCalls++; return view; };
  await bounded(Presentation.open(context, 'daily')); assert.ok(context.progressPopup); assert.equal(openCalls, 2);
  await context.progressPopup.forceClose(); assert.equal(context.progressPopup, null); assert.equal(context.inputLocked, false);
  for (const notification of ['refresh', 'onClosed']) {
    context.homeView.refresh = () => { if (notification === 'refresh') throw Error('refresh save failed'); };
    f.ui.open = async () => null;
    await bounded(Presentation.open(context, 'daily', () => { if (notification === 'onClosed') throw Error('notification failed'); }));
    assert.equal(context.progressPopup, null); assert.equal(context.inputLocked, false);
    assert.match(feedback, /加载失败/);
  }
});

test('actual MVC rejected open settles its gate and concurrent cleanup retries partial owners', async () => {
  const f = provider(); let modelCloses = 0, derivedCloses = 0, fail = true;
  class Control extends f.MVCControlBase {
    async open() { this._model = { close: async () => { modelCloses++; } }; throw Error('open failed'); }
    async close() { derivedCloses++; if (fail) throw Error('derived cleanup failed'); }
  }
  const control = new Control();
  const first = control.close(); assert.equal(first, control.close());
  await assert.rejects(bounded(first), /derived cleanup failed/); assert.equal(control.openError.message, 'open failed');
  await assert.rejects(control.whenOpened(), /open failed/);
  assert.equal(modelCloses, 1); fail = false;
  const retry = control.close(); await bounded(retry); await bounded(control.close());
  assert.equal(derivedCloses, 2); assert.equal(modelCloses, 2);
});

test('actual pool keeps failed nodes and destroy callback until successful retry', async () => {
  const f = provider(); let fail = true, destroyCalls = 0; const released = [];
  const pool = new f.ObjectPool({ createFunc: () => new f.Node(), minHoldNum: 0,
    clearFunc: nodes => { if (fail) throw Error('clear failed'); nodes.forEach(node => { node.destroy(); released.push(node); }); },
    destroyFunc: () => { destroyCalls++; } });
  const a = new f.Node(), b = new f.Node(); await pool.put(a); await pool.put(b);
  await assert.rejects(pool.destroy(), /clear failed/); assert.equal(destroyCalls, 0); assert.equal(a.isValid, true);
  fail = false; const closing = pool.destroy(); assert.equal(closing, pool.destroy()); await closing; await pool.destroy();
  assert.equal(a.isValid, false); assert.equal(b.isValid, false); assert.equal(released.length, 2); assert.equal(destroyCalls, 1);
});

test('actual unregister keeps failed pools and fences old-owner cleanup after replacement', async () => {
  const f = provider(), owner = new f.Node(), fresh = new f.Node(); class Page extends f.View {}
  await f.ui.regis(Page, 'page', owner, { ...lazy, poolInitFillNum: 1, poolMaxHoldNum: 1, parent: f.scene });
  const pool = f.ui._uiPoolMap.get(Page).get('default'), node = pool._objectList[0];
  let fail = true; const original = pool.config.clearFunc;
  pool.config.clearFunc = nodes => { if (fail) throw Error('node close failed'); return original(nodes); };
  await assert.rejects(f.ui.unregis(Page, owner), /cleanup failed/);
  assert.equal(f.ui._uiPoolMap.get(Page).get('default'), pool); assert.equal(node.isValid, true);
  assert.equal(await f.ui.open(Page), null); await assert.rejects(f.ui.regis(Page, 'page', fresh, lazy), /cleanup is incomplete/);
  fail = false; await f.ui.unregis(Page, owner); assert.equal(node.isValid, false); assert.equal(f.state.prefabs[0].refs, 0);
  await f.ui.regis(Page, 'page', fresh, { ...lazy, parent: f.scene });
  await f.ui.unregis(Page, owner); assert.ok(await f.ui.open(Page)); await f.ui.unregis(Page, fresh);
});

test('completed registration releases once and an old owner cannot unregister a new one', async () => {
  const f = provider(), owner = new f.Node(), fresh = new f.Node(); class Page extends f.View {}
  await f.ui.regis(Page, 'page', owner, { ...lazy, parent: f.scene });
  const first = await f.ui.open(Page); assert.ok(first);
  await f.state.callbacks.get(owner)[0](); assert.equal(first.node.isValid, false);
  await f.ui.regis(Page, 'page', fresh, { ...lazy, parent: f.scene });
  await f.state.callbacks.get(owner)[0](); assert.ok(await f.ui.open(Page));
  await f.ui.unregis(Page); assert.ok(f.state.prefabs.every(asset => asset.refs === 0));
});

test('register then immediate unregister settles with no residual registration', async () => {
  const f = provider(); class Page extends f.View {}
  await bounded(Promise.all([f.ui.regis(Page, 'page', new f.Node(), lazy), f.ui.unregis(Page)]));
  assert.equal(await f.ui.open(Page), null);
});

test('invalid and already-released owners cannot leave a registered pool', async () => {
  const f = provider(); class Page extends f.View {}
  const node = new f.Node(); node.destroy();
  await assert.rejects(f.ui.regis(Page, 'page', node, lazy), /owner is invalid/);
  const released = { released: true };
  await bounded(f.ui.regis(Page, 'page', released, lazy)); await released.releaseTask;
  assert.equal(await f.ui.open(Page), null);
});

test('asset-load and pool-instantiation failures settle and release partial source leases', async () => {
  for (const failure of ['load', 'instantiate']) {
    const f = provider(); class Page extends f.View {}
    f.state.assetGet = async path => { if (failure === 'load' && path === 'second') throw Error('asset failed'); return new f.Prefab(); };
    f.state.instantiateFailure = failure === 'instantiate';
    const regis = f.ui.regis(Page, { first: 'first', second: 'second' }, new f.Node(), { poolInitFillNum: 1, poolMinHoldNum: 0, poolMaxHoldNum: 0 });
    const cleanup = f.ui.unregis(Page);
    await assert.rejects(bounded(regis), /asset failed|instantiate failed/); await bounded(cleanup);
    assert.ok(f.state.prefabs.every(asset => asset.refs === 0));
    f.state.instantiateFailure = false; f.state.assetGet = async () => new f.Prefab();
    await f.ui.regis(Page, 'page', new f.Node(), { ...lazy, parent: f.scene }); assert.ok(await f.ui.open(Page)); await f.ui.unregis(Page);
  }
});

test('every falsey pool rejection remains a failed registration and releases its source', async () => {
  for (const cause of [undefined, null, 0, '']) {
    const f = provider(); class Page extends f.View {}
    f.state.instantiateFailure = true; f.state.instantiateCause = cause;
    let rejected = false;
    try { await f.ui.regis(Page, 'page', new f.Node(), { poolInitFillNum: 1, poolMinHoldNum: 0 }); }
    catch (actual) { rejected = true; assert.equal(actual, cause); }
    assert.equal(rejected, true); assert.equal(await f.ui.open(Page), null);
    assert.ok(f.state.prefabs.every(asset => asset.refs === 0));
  }
});

test('shared pending open rejection fails all current waiters; a later clean generation can retry', async () => {
  const f = bundleFixture(), opening = deferred(); let opened = 0, closed = 0;
  const manage = { init() {}, open: () => { opened++; return opened === 1 ? opening.promise : Promise.resolve(); }, close: () => { closed++; } };
  f.bundle.bundleMap.set('game', { bundleStr: 'game', manage });
  const first = f.bundle.loadScene('first', { bundleStr: 'game' }); await tick(); f.callbacks[0].callback(null, { name: 'first' });
  const launch = finishLaunch(f, 0); await tick();
  const second = f.bundle.loadScene('second', { bundleStr: 'game' }); await tick(); f.callbacks[1].callback(null, { name: 'second' }); await tick();
  opening.reject(Error('open failed')); await launch;
  assert.equal(await first, false); assert.equal(await second, false); assert.equal(closed, 1); assert.equal(opened, 1);
  const retry = f.bundle.loadScene('retry', { bundleStr: 'game' }); await tick(); f.callbacks[2].callback(null, { name: 'retry' }); await finishLaunch(f, 1);
  assert.equal(await retry, true); assert.equal(opened, 2);
});

test('different Bundle waits for open and close, then a return starts a new manager generation', async () => {
  const f = bundleFixture(), opening = deferred(), closing = deferred(); const calls = [];
  f.bundle.load = async info => ({ name: info.bundleStr, preloadScene: (_, callback) => callback(null), loadScene: (name, callback) => f.callbacks.push({ name, callback }) });
  const a = { init() { calls.push('a.init'); }, open() { calls.push('a.open'); return calls.filter(x => x === 'a.open').length === 1 ? opening.promise : Promise.resolve(); }, close() { calls.push('a.close'); return closing.promise; } };
  const b = { init() { calls.push('b.init'); }, open() { calls.push('b.open'); }, close() { calls.push('b.close'); } };
  f.bundle.bundleMap.set('a', { bundleStr: 'a', manage: a }); f.bundle.bundleMap.set('b', { bundleStr: 'b', manage: b });
  const first = f.bundle.loadScene('a1', { bundleStr: 'a' }); await tick(); f.callbacks[0].callback(null, { name: 'a1' }); const launch = finishLaunch(f, 0); await tick();
  const next = f.bundle.loadScene('b1', { bundleStr: 'b' }); await tick(); f.callbacks[1].callback(null, { name: 'b1' }); await tick();
  assert.deepEqual(calls, ['a.init', 'a.open']); opening.resolve(); await launch; await tick();
  assert.deepEqual(calls, ['a.init', 'a.open', 'a.close']); assert.equal(f.state.launched.length, 1);
  closing.resolve(); await finishLaunch(f, 1); assert.equal(await next, true); assert.equal(await first, false);
  const back = f.bundle.loadScene('a2', { bundleStr: 'a' }); await tick(); f.callbacks[2].callback(null, { name: 'a2' }); await finishLaunch(f, 2);
  assert.equal(await back, true); assert.deepEqual(calls, ['a.init', 'a.open', 'a.close', 'b.init', 'b.open', 'b.close', 'a.init', 'a.open']);
});

test('failed close keeps its owner and prevents another manager init until cleanup succeeds', async () => {
  const f = bundleFixture(); let fail = true, bInits = 0;
  f.bundle.load = async info => ({ name: info.bundleStr, preloadScene: (_, callback) => callback(null), loadScene: (name, callback) => f.callbacks.push({ name, callback }) });
  f.bundle.bundleMap.set('a', { bundleStr: 'a', manage: { init() {}, open() {}, close() { if (fail) throw Error('cleanup failed'); } } });
  f.bundle.bundleMap.set('b', { bundleStr: 'b', manage: { init() { bInits++; }, open() {}, close() {} } });
  const first = f.bundle.loadScene('a', { bundleStr: 'a' }); await tick(); f.callbacks[0].callback(null, { name: 'a' }); await finishLaunch(f, 0); assert.equal(await first, true);
  const next = f.bundle.loadScene('b', { bundleStr: 'b' }); await tick(); f.callbacks[1].callback(null, { name: 'b' }); assert.equal(await next, false); assert.equal(bInits, 0);
  fail = false; const retry = f.bundle.loadScene('b', { bundleStr: 'b' }); await tick(); f.callbacks[2].callback(null, { name: 'b' }); await finishLaunch(f, 1); assert.equal(await retry, true);
});

test('real BundleManageBase helper propagates init/open errors and includes pending Release completion', async () => {
  for (const phase of ['init', 'open']) {
    const f = provider({ editor: false });
    class Main extends f.BundleManageBase {
      nameStr = 'main';
      init() { if (phase === 'init') return Promise.reject(Error('real init failure')); }
      open() { if (phase === 'open') return Promise.reject(Error('real open failure')); }
    }
    const manage = new Main(); f.bundle.bundleMap.set('main', { bundleStr: 'main', manage });
    await f.state.directorCallbacks.get('before-scene-launch')({ name: 'Bootstrap' });
    assert.equal(await f.bundle._initTask.task, false);
  }
  const f = provider({ editor: false }), release = deferred(); f.state.release = () => release.promise;
  class Game extends f.BundleManageBase { nameStr = 'game'; init() {} open() {} close() {} }
  const manage = new Game(); await manage.init(); await manage.open(); let finished = false;
  const close = manage.close().then(() => { finished = true; }); await tick(); assert.equal(finished, false); assert.equal(manage.isValid, true);
  release.resolve(); await close; assert.equal(manage.isValid, false);
});

test('real derived close failure keeps owner valid; retry neither skips derived cleanup nor releases an asset twice', async () => {
  const f = bundleFixture({ editor: false, realRelease: true }); let fail = true, attempts = 0, otherInits = 0;
  await f.state.directorCallbacks.get('before-scene-launch')({ name: 'Bootstrap' });
  class Game extends f.BundleManageBase { nameStr = 'game'; init() {} open() {} close() { attempts++; if (fail) throw Error('derived close failed'); } }
  const manage = new Game(); f.bundle.bundleMap.set('game', { bundleStr: 'game', manage });
  f.bundle.load = async info => ({ name: info.bundleStr, preloadScene: (_, callback) => callback(null), loadScene: (name, callback) => f.callbacks.push({ name, callback }) });
  f.bundle.bundleMap.set('other', { bundleStr: 'other', manage: { init() { otherInits++; }, open() {}, close() {} } });
  const entered = f.bundle.loadScene('one', { bundleStr: 'game' }); await tick(); f.callbacks[0].callback(null, { name: 'one' }); await finishLaunch(f, 0); assert.equal(await entered, true);
  const asset = new f.Prefab(); manage.followRelease(asset);
  const other = f.bundle.loadScene('other', { bundleStr: 'other' }); await tick(); f.callbacks[1].callback(null, { name: 'other' }); assert.equal(await other, false);
  assert.equal(otherInits, 0); assert.equal(manage.isValid, true); assert.equal(asset.refs, 0); assert.equal(attempts, 1);
  fail = false; const retry = f.bundle.loadScene('other', { bundleStr: 'other' }); await tick(); f.callbacks[2].callback(null, { name: 'other' }); await finishLaunch(f, 1);
  assert.equal(await retry, true); assert.equal(attempts, 2); assert.equal(asset.refs, 0); assert.equal(manage.isValid, false);
});

test('real Release retains failed callbacks, consumes successful assets once and handles closing late leases', async () => {
  const f = provider({ editor: false, realRelease: true }), blocking = deferred(); let fail = true, called = 0;
  class Game extends f.BundleManageBase { nameStr = 'game'; init() {} open() {} close() {} }
  const manage = new Game(); await manage.init(); await manage.open();
  const first = new f.Prefab(); manage.followRelease(first);
  manage.followRelease(async () => { called++; await blocking.promise; if (fail) throw Error('callback failed'); });
  const closing = manage.close(); await tick();
  const late = new f.Prefab(), node = new f.Node(); manage.followRelease(late); manage.followRelease(node);
  await tick(); assert.equal(late.refs, 0); assert.equal(node.isValid, false); assert.equal(first.refs, 0);
  blocking.resolve(); await assert.rejects(closing, /Resource lease cleanup failed/); assert.equal(manage.isValid, true);
  fail = false; await manage.close(); assert.equal(called, 2); assert.equal(first.refs, 0); assert.equal(late.refs, 0); assert.equal(manage.isValid, false);
});

test('manager replacement while queued cannot change the captured lifecycle or cleanup identity', async () => {
  const f = bundleFixture(), opening = deferred(); let aOpened = 0, aClosed = 0, bCalled = 0;
  const a = { init() {}, open() { aOpened++; return opening.promise; }, close() { aClosed++; } };
  const b = { init() { bCalled++; throw Error('replacement'); }, open() { bCalled++; }, close() { bCalled++; } };
  f.bundle.bundleMap.set('game', { bundleStr: 'game', manage: a });
  const first = f.bundle.loadScene('first', { bundleStr: 'game' }); await tick(); f.callbacks[0].callback(null, { name: 'first' }); const launch = finishLaunch(f, 0); await tick();
  const second = f.bundle.loadScene('second', { bundleStr: 'game' }); await tick(); f.callbacks[1].callback(null, { name: 'second' }); await tick();
  f.bundle.bundleMap.get('game').manage = b; opening.resolve(); await launch; await finishLaunch(f, 1);
  assert.equal(await second, true); assert.equal(await first, false); assert.equal(aOpened, 1); assert.equal(bCalled, 0);
  const third = f.bundle.loadScene('third', { bundleStr: 'game' }); await tick(); f.callbacks[2].callback(null, { name: 'third' }); assert.equal(await third, false);
  assert.equal(aClosed, 1); assert.equal(bCalled, 2); assert.equal(f.bundle._owner, null);
});

test('one view close failure preserves its owner while releasing other views, then retries it', async () => {
  const f = provider(); let attempts = 0;
  class Page extends f.View { async _close() { attempts++; if (attempts === 1) throw Error('close failed'); return super._close(); } }
  await f.ui.regis(Page, 'page', new f.Node(), { ...lazy, isRepeat: true, parent: f.scene });
  const first = await f.ui.open(Page), second = await f.ui.open(Page);
  await assert.rejects(f.ui.unregis(Page), /UI unregister cleanup failed/);
  assert.equal(attempts, 2); assert.equal(first.node.isValid, true); assert.equal(second.node.isValid, false);
  assert.equal(await f.ui.open(Page), null); await f.ui.unregis(Page); assert.equal(attempts, 3); assert.equal(first.node.isValid, false);
  await f.ui.regis(Page, 'page', new f.Node(), { ...lazy, parent: f.scene }); assert.ok(await f.ui.open(Page)); await f.ui.unregis(Page);
  assert.ok(f.state.prefabs.every(asset => asset.refs === 0));
});

test('registration waits for pending teardown and late prefab load returns its lease', async () => {
  const f = provider(), asset = deferred(); class Page extends f.View {}
  f.state.assetGet = () => asset.promise;
  await f.ui.regis(Page, 'page', new f.Node(), { ...lazy, parent: f.scene });
  const opening = f.ui.open(Page); await tick(); const pendingTeardown = f.ui.unregis(Page);
  let cleaned = false; void pendingTeardown.then(() => { cleaned = true; }); await tick(); assert.equal(cleaned, false);
  const loaded = new f.Prefab(); asset.resolve(loaded); await bounded(pendingTeardown); assert.equal(await bounded(opening), null); assert.equal(loaded.refs, 0);
  const close = deferred(); const original = f.ui.close.bind(f.ui);
  f.state.assetGet = async () => new f.Prefab(); await f.ui.regis(Page, 'page', new f.Node(), { ...lazy, parent: f.scene }); await f.ui.open(Page);
  f.ui.close = async (...args) => { await close.promise; return original(...args); };
  const teardown = f.ui.unregis(Page); let registered = false;
  const registration = f.ui.regis(Page, 'page', new f.Node(), { ...lazy, parent: f.scene }).then(() => { registered = true; });
  await tick(); assert.equal(registered, false); close.resolve(); await bounded(Promise.all([teardown, registration]));
  f.ui.close = original; assert.ok(await f.ui.open(Page)); await f.ui.unregis(Page);
});

test('an old open completion cannot finish the new owners load task or return an old view', async () => {
  const f = provider(), oldOpen = deferred(), newOpen = deferred(); let count = 0;
  class Page extends f.View { async _open() { await (++count === 1 ? oldOpen.promise : newOpen.promise); } }
  await f.ui.regis(Page, 'page', new f.Node(), { ...lazy, parent: f.scene });
  const first = f.ui.open(Page); await tick(); await f.ui.unregis(Page);
  await f.ui.regis(Page, 'page', new f.Node(), { ...lazy, parent: f.scene });
  const second = f.ui.open(Page); await tick(); oldOpen.resolve(); assert.equal(await first, null);
  assert.equal(f.ui._uiLoadMap.get(Page).isFinish, false);
  newOpen.resolve(); assert.ok(await second); await f.ui.unregis(Page);
});

function bundleFixture(options) {
  const f = provider(options);
  const callbacks = [];
  f.bundle.load = async () => ({ name: 'game', preloadScene: (_, callback) => callback(null), loadScene: (name, callback) => callbacks.push({ name, callback }) });
  return { ...f, callbacks };
}
async function finishLaunch(f, index) {
  for (let attempt = 0; attempt < 10 && !f.state.sceneCallbacks[index]; attempt++) await tick();
  assert.ok(f.state.sceneCallbacks[index], 'scene must be launched');
  return f.state.sceneCallbacks[index]();
}

test('a late scene load cannot launch or clear the newer operation flag', async () => {
  const f = bundleFixture(); let current = true;
  const first = f.bundle.loadScene('old', { bundleStr: 'game', launchGuardFunc: () => current }); await tick();
  current = false; const second = f.bundle.loadScene('new', { bundleStr: 'game', launchGuardFunc: () => true }); await tick();
  f.callbacks[0].callback(null, { name: 'old' }); assert.equal(await first, false); assert.equal(f.bundle.isSwitchScene, true);
  await f.callbacks[1].callback(null, { name: 'new' }); await finishLaunch(f, 0); assert.equal(await second, true);
  assert.deepEqual(f.state.launched, ['new']); assert.equal(f.bundle.isSwitchScene, false);
});

test('late manager init cannot close a manager reused by a new operation; init errors settle', async () => {
  const f = bundleFixture(), init = deferred(); let calls = 0, closed = 0;
  const manage = { init: () => ++calls === 1 ? init.promise : Promise.resolve(), open: async () => {}, close: () => { closed++; } };
  f.bundle.bundleMap.set('game', { bundleStr: 'game', manage });
  const first = f.bundle.loadScene('old', { bundleStr: 'game' }); await tick(); const oldCallback = f.callbacks[0].callback(null, { name: 'old' });
  const second = f.bundle.loadScene('new', { bundleStr: 'game' }); await tick(); await f.callbacks[1].callback(null, { name: 'new' });
  assert.equal(calls, 1); assert.equal(f.state.launched.length, 0); init.resolve(); await oldCallback; await finishLaunch(f, 0);
  assert.equal(await second, true); assert.equal(await first, false); assert.equal(closed, 0);
  f.bundle.bundleMap.set('game', { bundleStr: 'game', manage: { init: async () => { throw Error('init failed'); }, open() {}, close() {} } });
  const third = f.bundle.loadScene('bad', { bundleStr: 'game' }); await tick(); await f.callbacks[2].callback(null, { name: 'bad' }); assert.equal(await third, false);
});

test('a global scene event rejection releases the owned switch flag', async () => {
  const f = bundleFixture(); f.bundle.event.on('beforeSceneSwitch', async () => { throw Error('scene event failed'); });
  await assert.rejects(f.bundle.loadScene('bad', { bundleStr: 'game' }), /scene event failed/); assert.equal(f.bundle.isSwitchScene, false);
});

test('manager open rejection is included in loadScene failure without an unhandled rejection', async () => {
  const f = bundleFixture(); f.bundle.bundleMap.set('game', { bundleStr: 'game', manage: { init: async () => {}, close() {}, open: async () => { throw Error('open failed'); } } });
  const task = f.bundle.loadScene('bad', { bundleStr: 'game' }); await tick(); await f.callbacks[0].callback(null, { name: 'bad' });
  await finishLaunch(f, 0); assert.equal(await bounded(task), false); assert.equal(f.bundle.isSwitchScene, false);
});

test('same Bundle waits for pending open and commits only the current scene generation', async () => {
  const f = bundleFixture(), opening = deferred(); let opened = 0;
  f.bundle.bundleMap.set('game', { bundleStr: 'game', manage: { init: async () => {}, close() {}, open: () => { opened++; return opening.promise; } } });
  await tick();
  const first = f.bundle.loadScene('old', { bundleStr: 'game' }); await tick(); await f.callbacks[0].callback(null, { name: 'old' });
  const oldLaunched = finishLaunch(f, 0); await tick();
  const second = f.bundle.loadScene('new', { bundleStr: 'game' }); let settled = false; void second.then(() => { settled = true; });
  await tick(); await f.callbacks[1].callback(null, { name: 'new' }); await tick();
  assert.equal(settled, false); assert.equal(opened, 1); assert.equal(f.bundle.bundleStr, 'main'); assert.equal(f.state.launched.length, 1);
  opening.resolve(); await oldLaunched; await finishLaunch(f, 1);
  assert.equal(await second, true); assert.equal(await first, false); assert.equal(opened, 1);
  const switches = f.bundle.event.emitted.filter(event => event.key === 'afterBundleSwitch').map(event => event.args[0].currBundleStr);
  assert.deepEqual(switches, ['main', 'game']);
});

test('Runtime initialization waits for main open before allowing scene loading', async () => {
  const f = bundleFixture({ editor: false }), opening = deferred();
  f.bundle.bundleMap.set('main', { bundleStr: 'main', manage: { init: async () => {}, close() {}, open: () => opening.promise } });
  const initialization = f.state.directorCallbacks.get('before-scene-launch')({ name: 'Bootstrap' });
  const loading = f.bundle.loadScene('gameplay', { bundleStr: 'game' });
  await tick(); assert.equal(f.bundle._initTask.isFinish, false); assert.equal(f.callbacks.length, 0);
  opening.resolve(); await bounded(initialization); await tick(); assert.equal(f.callbacks.length, 1);
  await f.callbacks[0].callback(null, { name: 'gameplay' }); await finishLaunch(f, 0);
  assert.equal(await bounded(loading), true);
  const notifications = f.bundle.event.emitted.filter(event => event.key === 'afterBundleSwitch').map(event => event.args[0].currBundleStr);
  assert.deepEqual(notifications, ['main', 'game']);
});

test('Runtime main init and open rejection settle the gate and reject gameplay entry without launching', async () => {
  for (const phase of ['init', 'open']) {
    const f = bundleFixture({ editor: false });
    f.bundle.bundleMap.set('main', { bundleStr: 'main', manage: {
      init: async () => { if (phase === 'init') throw Error('main init failed'); }, close() {},
      open: async () => { if (phase === 'open') throw Error('main open failed'); },
    } });
    const loading = f.bundle.loadScene('gameplay', { bundleStr: 'game' });
    await bounded(f.state.directorCallbacks.get('before-scene-launch')({ name: 'Bootstrap' }));
    assert.equal(await bounded(loading), false); assert.equal(f.bundle._initTask.isFinish, true);
    assert.deepEqual(f.state.launched, []); assert.equal(f.callbacks.length, 0);
    assert.deepEqual((f.bundle.event.emitted ?? []).filter(event => event.key === 'afterBundleSwitch'), []);
  }
});
