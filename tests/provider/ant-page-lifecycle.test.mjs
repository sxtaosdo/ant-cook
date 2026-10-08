import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Exercise the current production classes; resource IO and node destruction are
// fixtures. Lease assertions verify calls/ownership, not Cocos deferred destruction.
function load(file, modules, extra = {}) {
  const source = readFileSync(new URL(`../../assets/Colony/scripts/presentation/${file}.ts`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, require: name => modules[name] ?? {}, ...extra });
  return exports;
}

function pageFixture() {
  const names = ['boardView', 'slotView', 'hudView', 'toolBarView', 'loadingView', 'constructionView'];
  const modules = {}, classes = {};
  for (const name of names) {
    const key = `Colony${name[0].toUpperCase()}${name.slice(1)}`;
    const type = classes[name] = class {};
    modules[`../views/${name}`] = { [key]: type };
  }
  let finishLoad, created = 0, missing = false;
  const roots = [], released = [], leases = new Map();
  const prefab = {};
  modules.mk = { default: {
    asset: { get: (_path, _type, owner) => { assert.equal(owner, null); return new Promise(resolve => { finishLoad = resolve; }); } },
    Release: {
      release: async value => { released.push(value); },
      followRelease: (owner, value) => { assert.equal(value, prefab); leases.set(owner, value); },
    },
  } };
  modules['../colonyUtil'] = { ColonyUtil: { applyUiLayer() {} } };
  modules.cc = { instantiate: () => {
    created++;
    const node = { isValid: true, destroy() {
      this.isValid = false;
      if (leases.has(this)) { released.push(leases.get(this)); leases.delete(this); }
    }, setSiblingIndex() {},
      getComponentInChildren: type => missing ? null : { node, type }, getComponent: type => missing ? null : { node, type },
      getChildByName: name => ({ name }),
    };
    roots.push(node); return node;
  } };
  const session = { node: { isValid: true }, destroyed: false, popupRoot: { getSiblingIndex: () => 1 } };
  return { ...load('pageNodes', modules), session, roots, released, leases, prefab,
    release: () => finishLoad(prefab), get created() { return created; }, breakBindings: () => { missing = true; } };
}

test('page mount rejects stale navigation and destroyed owners before creating nodes', async () => {
  const fixture = pageFixture(); let current = true;
  const pending = fixture.mountPage(fixture.session, 'playRoot', () => current);
  current = false; fixture.release(); assert.equal(await pending, null); assert.equal(fixture.created, 0);
  assert.deepEqual(fixture.released, [fixture.prefab]); assert.equal(fixture.leases.size, 0);
  const destroyed = fixture.mountPage(fixture.session, 'loading', () => true);
  fixture.session.destroyed = true; fixture.release(); assert.equal(await destroyed, null); assert.equal(fixture.created, 0);
  assert.deepEqual(fixture.released, [fixture.prefab, fixture.prefab]); assert.equal(fixture.leases.size, 0);
});

test('play page remount uses fresh nodes and unmount clears every dynamic binding', async () => {
  const fixture = pageFixture();
  const first = fixture.mountPage(fixture.session, 'playRoot', () => true); fixture.release();
  const old = await first; assert.ok(fixture.session.boardView);
  assert.equal(fixture.leases.get(old), fixture.prefab);
  fixture.unmountPlay(fixture.session); assert.equal(old.isValid, false);
  assert.deepEqual(fixture.released, [fixture.prefab]); assert.equal(fixture.leases.size, 0);
  for (const key of ['playRoot', 'boardView', 'slotView', 'hudView', 'toolBarView', 'stackRoot', 'transportRoot']) assert.equal(fixture.session[key], null);
  const second = fixture.mountPage(fixture.session, 'playRoot', () => true); fixture.release();
  assert.notEqual(await second, old); assert.equal(fixture.created, 2);
  fixture.unmountPlay(fixture.session); fixture.unmountPlay(fixture.session);
  assert.equal(fixture.roots.filter(node => node.isValid).length, 0);
  assert.equal(fixture.leases.size, 0); assert.equal(fixture.released.length, 2);
});

test('missing dynamic page bindings destroy the orphan instead of leaving a blank mounted root', async () => {
  for (const page of ['playRoot', 'loading', 'construction']) {
    const fixture = pageFixture(); fixture.breakBindings();
    const pending = fixture.mountPage(fixture.session, page, () => true); fixture.release();
    await assert.rejects(pending, /缺少页面绑定/); assert.equal(fixture.roots[0].isValid, false);
    assert.equal(fixture.leases.size, 0); assert.deepEqual(fixture.released, [fixture.prefab]);
  }
});

test('failed new-page enter recovers home even after mount, while failed save preserves the old page', async () => {
  const { HomeState } = load('pageStates/homeState', {});
  const calls = [], messages = [];
  const session = { destroyed: false, playRoot: {}, constructionView: null,
    StateMachine: { changeState: async state => { calls.push(state); session.playRoot = null; session.constructionView = null; } },
    homeView: { setFeedback: message => messages.push(message) },
  };
  await HomeState.recover(session, 'save failed'); assert.equal(calls.length, 0); assert.ok(session.playRoot);
  await HomeState.recover(session, 'notice load failed', true); assert.equal(calls[0], HomeState); assert.deepEqual(messages, ['notice load failed']);
  session.constructionView = {};
  await HomeState.recover(session, 'construction binding failed', true); assert.equal(calls.length, 2); assert.equal(session.constructionView, null);
  session.destroyed = true;
  await HomeState.recover(session, 'scene gone', true); assert.equal(calls.length, 2);
});

test('hard-level notice cancels pending loads and resolves its visible lifetime on timeout or exit', async () => {
  let release, timeout, cleared = 0, created = 0, node;
  const modules = { mk: { default: { asset: { get: () => new Promise(resolve => { release = resolve; }) } } },
    '../colonyUtil': { ColonyUtil: { applyUiLayer() {} } },
    cc: { instantiate: () => { created++; node = { setPosition() {}, destroy() { this.destroyed = true; } }; return node; } },
  };
  const { HardLevelNotice } = load('hardLevelNotice', modules, { setTimeout: fn => { timeout = fn; return 1; }, clearTimeout: () => { cleared++; } });
  const parent = { isValid: true };
  const stale = new HardLevelNotice(); const staleShow = stale.show({}, parent, () => true);
  stale.dispose(); release({}); await staleShow; assert.equal(created, 0);
  for (const reason of ['timeout', 'exit']) {
    const notice = new HardLevelNotice(); const show = notice.show({}, parent, () => true);
    release({}); await new Promise(resolve => setImmediate(resolve));
    assert.equal(node.parent, parent); assert.equal(node.active, true);
    if (reason === 'timeout') timeout(); else notice.dispose();
    await show; assert.equal(node.destroyed, true);
  }
  assert.equal(created, 2); assert.equal(cleared, 2);
});

test('slot arrival keeps a 500ms gate and pool cancellation cannot strand animation promises', async () => {
  const animations = [], pooled = [];
  const stop = target => animations.filter(a => a.target === target).forEach(a => { a.stopped = true; });
  const pool = { put: node => { stop(node); pooled.push(node); } };
  const Vec3 = class { constructor(x, y, z) { Object.assign(this, { x, y, z }); } static ONE = { x: 1, y: 1, z: 1 }; };
  const { BoardPresentation } = load('boardPresentation', {
    cc: { Vec3, Tween: { stopAllByTarget: stop }, tween: target => {
      const actions = []; const animation = { target, actions,
        to: duration => { actions.push({ duration }); return animation; }, delay: duration => { actions.push({ duration }); return animation; },
        call: fn => { actions.push({ fn }); return animation; }, start: () => { animations.push(animation); return animation; },
        complete: () => { for (const action of actions) { if (animation.stopped) break; action.fn?.(); } },
      }; return animation;
    } }, './nodeFactory': { NodeFactory: class { pool() { return pool; } } },
  });
  const root = { parent: null, targetOff() {} }, slot = { isValid: true, position: { x: 0, y: 0 }, children: [], setScale() {}, setPosition() {}, getComponent: () => null };
  const board = new BoardPresentation({}, {}, [slot], {}, {}, root, () => {});
  board.slotNodes = [slot];
  let finished = false; const pulse = board.pulseSlot(0).then(() => { finished = true; });
  assert.equal(animations[0].actions.slice(0, -1).reduce((n, a) => n + a.duration, 0), 0.7);
  assert.equal(animations[0].actions.at(-2).duration, 0.5);
  assert.equal(finished, false); board.recycle(); await pulse; assert.equal(finished, true);
  const cell = { parent: {}, isValid: true }; board.cellNodes.set('cell', cell);
  const clearing = board.clearCell('cell'); animations.at(-1).complete(); await clearing;
  assert.ok(pooled.includes(cell)); assert.equal(board.animationWaits.size, 0);
});

test('dynamic HUD and toolbar teardown tolerates child components already destroyed', () => {
  const cc = { Button: class {}, Label: class {}, Tween: { stopAllByTarget() {} }, view: { off() {} },
    _decorator: { ccclass: () => type => type, property: () => () => {} } };
  const mk = { default: { StaticViewBase: class {} } };
  const { LevelRailView } = load('../views/levelRailView', { cc });
  const rail = Object.create(LevelRailView.prototype);
  let destroyed = 0;
  Object.assign(rail, { scroll: { node: null }, viewport: { isValid: false, targetOff() { throw Error('Destroyed viewport'); } },
    node: { destroy() { destroyed++; } }, fillState: {}, centerTimer: null, finishProgress: null });
  const { ColonyHudView } = load('../views/hudView', { cc, mk, './levelRailView': { LevelRailView } });
  const hud = Object.create(ColonyHudView.prototype);
  Object.assign(hud, { railRequest: 0, railView: rail, speedButton: { node: null }, boundNodes: new Set() });
  assert.doesNotThrow(() => hud.onDestroy());
  assert.equal(hud.railView, null); assert.equal(destroyed, 1);
  const { ColonyToolBarView } = load('../views/toolBarView', { cc, mk });
  const toolbar = Object.create(ColonyToolBarView.prototype);
  for (const key of ['trowelButton', 'slotButton', 'compassButton']) toolbar[key] = { node: null };
  assert.doesNotThrow(() => toolbar.onDestroy());
});
