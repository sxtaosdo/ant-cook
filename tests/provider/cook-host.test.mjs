import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { StateMachine } from '../../extensions/shidai3/assets/runtime/stateMachine.ts';
import { P10CookApplication } from '../../assets/bundles/game/application/P10CookApplication.ts';
import { P10GameCore } from '../../assets/bundles/game/core/P10GameCore.ts';
import { ModuleEntryGate } from '../../assets/shell/contracts.ts';
import { ProductStorage } from '../../assets/shell/productStorage.ts';

/** Executes actual Host/Bootstrap/States/Session/Model; only cc and rendering IO are doubles. */
function fixture({ failInitial = false, values = new Map(), rules = null } = {}) {
  const state = { events: [], ready: 0, blocked: 0, fail: failInitial, writes: [], values, current: true };
  let root;
  const store = { getItem: key => state.values.get(key) ?? null, setItem(key, value) { state.writes.push(value); if (state.fail) throw Error('quota'); state.values.set(key, value); }, removeItem: key => state.values.delete(key) };
  ModuleEntryGate.bind({ mode: 'cook', transactionId: 'host-1', generation: 1, source: 'launch', storage: new ProductStorage(store, 'cook'), isCurrent: () => state.current,
    attach() {}, ready() { state.ready++; state.events.push('ready'); }, saveBlocked() { state.blocked++; }, fail(cause) { throw cause; } });
  class Component {}
  class Presentation {
    hasRenderFailure = false;
    async initializeResources() { assert.equal(root.bootstrap.StateMachine.current.constructor.name, 'LoadingState'); state.events.push('resources'); }
    render(model) { state.events.push(`render:${model.screen}`); this.model = model; }
    async settleRender() { state.events.push('settled'); }
    setInputEnabled() {} update() {} async shutdown() {}
  }
  class Adapter { constructor(ports) { this.ports = ports; } }
  class Lifecycle { constructor(_, adapter) { this.adapter = adapter; } onLoad() { state.events.push('wired'); } update(delta) { this.adapter.ports.update(delta); this.adapter.ports.presentation.render(); } onDestroy() {} }
  const base = fileURLToPath(new URL('../../assets/bundles/game/', import.meta.url));
  const mocks = { mk: { default: { asset: { async get() { return { json: rules ?? JSON.parse(readFileSync(new URL('../../assets/bundles/game/resources/config/kitchen-rules.json', import.meta.url), 'utf8')) }; } } } }, cc: { Component, _decorator: { ccclass: () => Class => Class }, Director: { EVENT_AFTER_DRAW: 'draw' }, director: { once(_, cb) { state.events.push('draw'); queueMicrotask(cb); } } },
    'db://shidai3/index': { StateMachine, CocosAdapter: Adapter, CocosComponentLifecycleHost: Lifecycle },
    P10CookApplication: { P10CookApplication }, contracts: { ModuleEntryGate }, P10CookPresentation: { P10CookPresentation: Presentation } };
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path).exports;
    const module = { exports: {} }; cache.set(path, module);
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true, useDefineForClassFields: false } }).outputText;
    const require = name => {
      if (mocks[name]) return mocks[name];
      const key = name.split('/').at(-1);
      if (mocks[key] && key !== 'contracts') return mocks[key];
      if (name.endsWith('shell/contracts')) return mocks.contracts;
      let target = resolve(dirname(path), name + '.ts');
      if (name.endsWith('/pageStates')) target = resolve(dirname(path), name, 'index.ts');
      return load(target);
    };
    vm.runInNewContext(code, { module, exports: module.exports, require, console, queueMicrotask, AggregateError }, { filename: path });
    return module.exports;
  }
  const { GameRoot } = load(resolve(base, 'GameRoot.ts'));
  root = new GameRoot(); root.node = { getComponent() { return null; }, addComponent(Class) { const value = new Class(); value.node = this; return value; } };
  return { root, state, load, base };
}

function unlockSecondLevel(root) {
  const snapshot = JSON.parse(root.application.core.serialize());
  const id = root.application.read().catalog.restaurants[0].levelIds[1]; snapshot.levels[id].unlocked = true;
  root.application.core = P10GameCore.load(JSON.stringify(snapshot)); root.application.flush();
  return id;
}

test('Host loads startup IO inside LoadingState, then renders current State before Ready', async () => {
  const f = fixture(); await f.root.boot();
  assert.equal(f.state.ready, 1); assert.ok(f.state.events.indexOf('resources') > f.state.events.indexOf('wired'));
  assert.ok(f.state.events.indexOf('ready') > f.state.events.indexOf('draw'));
  assert.equal(f.root.bootstrap.StateMachine.current.constructor.name, 'MapState');
  assert.equal('screen' in f.root.application.read(), false); assert.equal(f.root.presentation.model.screen, 'map');
});

test('Host non-default unlocked level is one durable atomic start and failed write retries identical bytes once', async () => {
  for (const fail of [false, true]) {
    const f = fixture(); await f.root.boot(); const id = unlockSecondLevel(f.root), before = f.state.writes.length;
    f.state.fail = fail; await f.root.routeIntent({ type: 'p10.start-level', payload: { levelIndex: 1 } });
    assert.equal(f.state.writes.length, before + 1); assert.equal(f.root.application.read().selection.levelIndex, 1);
    assert.equal(f.root.application.read().kitchen.levelId, id);
    if (fail) {
      assert.equal(f.root.bootstrap.StateMachine.current.constructor.name, 'MapState'); const bytes = f.state.writes.at(-1);
      f.root.application.update(20); assert.equal(f.root.application.hasPendingSave, true);
      f.state.fail = false; assert.equal((await f.root.flush()).ok, true);
      assert.equal(f.state.writes.length, before + 2); assert.equal(f.state.writes.at(-1), bytes);
    }
    assert.equal(f.root.bootstrap.StateMachine.current.constructor.name, 'KitchenState');
    await f.root.close('recovery');
  }
});

test('initial save retry stays in the same LoadingState and initializes resources once', async () => {
  const f = fixture({ failInitial: true }); await f.root.boot(); const loading = f.root.bootstrap.StateMachine.current;
  assert.equal(loading.constructor.name, 'LoadingState'); assert.equal(f.state.blocked, 1); assert.equal(f.state.ready, 0);
  assert.equal(f.state.events.includes('resources'), false); const bytes = f.state.writes[0];
  f.state.fail = false; assert.equal((await f.root.flush()).ok, true); assert.equal(f.state.writes[1], bytes);
  assert.equal(f.state.events.filter(value => value === 'resources').length, 1); assert.equal(f.state.ready, 1);
  await f.root.close('recovery');
});

test('failed restaurant selection resumes its LevelState exactly once after fixed-snapshot retry', async () => {
  const f = fixture(); await f.root.boot(); const before = f.state.writes.length;
  f.state.fail = true; await f.root.routeIntent({ type: 'p10.select-restaurant', payload: { restaurantIndex: 0 } });
  assert.equal(f.root.bootstrap.StateMachine.current.constructor.name, 'MapState');
  const bytes = f.state.writes.at(-1); f.state.fail = false;
  assert.equal((await f.root.flush()).ok, true);
  assert.equal(f.state.writes.length, before + 2); assert.equal(f.state.writes.at(-1), bytes);
  assert.equal(f.root.bootstrap.StateMachine.current.constructor.name, 'LevelState');
  assert.equal(f.root.pendingPageCommit, null); await f.root.close('recovery');
});

test('Bootstrap concurrent disposal joins one exit and failed Host owners can retry cleanup', async () => {
  const f = fixture(); await f.root.boot(); const bootstrap = f.root.bootstrap;
  let release; let exits = 0;
  bootstrap.StateMachine.current.exit = () => { exits++; return new Promise(resolve => { release = resolve; }); };
  const a = bootstrap.dispose(), b = bootstrap.dispose(); assert.equal(a, b); assert.equal(exits, 1);
  release(); await Promise.all([a, b]); assert.equal(bootstrap.StateMachine.current, null);
  let attempts = 0;
  f.root.presentation.shutdown = async () => { if (++attempts === 1) throw Error('resource close'); };
  const first = f.root.close('recovery'); assert.equal(first, f.root.close('recovery'));
  await assert.rejects(first, /cleanup did not complete/);
  assert.equal(f.root.closing, true); assert.notEqual(f.root.presentation, null);
  await f.root.close('recovery'); assert.equal(attempts, 2); assert.equal(f.root.application, null);
});

test('restored checkpoint synchronizes restaurant and earlier level before rendering and retrying', async () => {
  for (const restaurantIndex of [0, 1]) {
    const f = fixture(); await f.root.boot(); const snapshot = JSON.parse(f.root.application.core.serialize());
    const restaurant = f.root.application.read().catalog.restaurants[restaurantIndex];
    snapshot.restaurants[restaurant.id].unlocked = true;
    for (const id of restaurant.levelIds) snapshot.levels[id].unlocked = true;
    f.root.application.core = P10GameCore.load(JSON.stringify(snapshot));
    assert.equal(f.root.application.startLevelAt(restaurantIndex, 0).ok, true);
    const values = f.state.values; await f.root.close('recovery');
    const restored = fixture({ values }); await restored.root.boot();
    let model = restored.root.application.read();
    assert.equal(model.selection.restaurantIndex, restaurantIndex); assert.equal(model.selection.levelIndex, 0);
    assert.equal(model.level.id, restaurant.levelIds[0]); assert.equal(model.kitchen.levelId, model.level.id);
    await restored.root.routeIntent({ type: 'p10.resume-checkpoint', payload: {} });
    await restored.root.routeIntent({ type: 'p10.restart', payload: {} });
    model = restored.root.application.read(); assert.equal(model.kitchen.levelId, restaurant.levelIds[0]);
    assert.equal(restored.root.presentation.model.level.id, model.kitchen.levelId);
    await restored.root.close('recovery');
  }
});

test('recovery reset persists once and a rejected save retries identical bytes before returning to Map', async () => {
  for (const failReset of [false, true]) {
    const first = fixture(); await first.root.boot();
    await first.root.routeIntent({ type: 'p10.start-level', payload: { levelIndex: 0 } });
    assert.equal(first.root.application.hasCheckpoint, true);
    await first.root.close('recovery');
    const restored = fixture({ values: first.state.values }); await restored.root.boot();
    assert.equal(restored.root.bootstrap.StateMachine.current.constructor.name, 'RecoveryState');
    const before = restored.state.writes.length; restored.state.fail = failReset;
    await restored.root.routeIntent({ type: 'p10.reset-save', payload: {} });
    assert.equal(restored.state.writes.length, before + 1);
    assert.equal(restored.root.application.hasCheckpoint, false);
    if (failReset) {
      assert.equal(restored.root.application.hasPendingSave, true);
      assert.equal(restored.root.bootstrap.StateMachine.current.constructor.name, 'RecoveryState');
      const pendingBytes = restored.state.writes.at(-1);
      await restored.root.routeIntent({ type: 'p10.reset-save', payload: {} });
      assert.equal(restored.state.writes.length, before + 1);
      restored.state.fail = false; assert.equal((await restored.root.flush()).ok, true);
      assert.equal(restored.state.writes.at(-1), pendingBytes);
      assert.equal(restored.state.writes.length, before + 2);
    }
    assert.equal(restored.root.bootstrap.StateMachine.current.constructor.name, 'MapState');
    await restored.root.close('recovery');
    const reboot = fixture({ values: restored.state.values }); await reboot.root.boot();
    assert.equal(reboot.root.application.hasCheckpoint, false);
    assert.equal(reboot.root.bootstrap.StateMachine.current.constructor.name, 'MapState');
    await reboot.root.close('recovery');
  }
});

test('Host optional per-level rules travel from bundle loading to next selected kitchen without a new injection path', async () => {
  const rules = JSON.parse(readFileSync(new URL('../../assets/bundles/game/resources/config/kitchen-rules.json', import.meta.url), 'utf8'));
  rules.source = 'synthetic-host-level-rules-not-original-game-data';
  rules.recipes = [rules.recipes[0]];
  rules.levelOverrides = [
    { levelId: 'r01-l01', customers: { count: 1, itemsPerCustomer: 1 }, goal: { metric: 'dishes', target: 1 } },
    { levelId: 'r01-l02', customers: { count: 3, itemsPerCustomer: 1 }, goal: { metric: 'coins', target: 9 } },
  ];
  const f = fixture({ rules });
  try {
    await f.root.boot();
    await f.root.routeIntent({ type: 'p10.start-level', payload: { levelIndex: 0 } });
    assert.equal(f.root.application.read().kitchen.production.customers.length, 1);
    assert.equal(f.root.application.read().kitchen.production.goal.target, 1);
    await f.root.routeIntent({ type: 'p10.start-cooking', payload: { dishId: 'jianbing' } });
    f.root.application.update(3);
    const slot = f.root.application.read().kitchen.production.slots.find(row => row.canServe);
    await f.root.routeIntent({ type: 'p10.serve-ready', payload: { slotId: slot.id } });
    assert.equal(f.root.application.read().result.success, true);
    await f.root.routeIntent({ type: 'p10.next-after-result', payload: {} });
    const next = f.root.application.read().kitchen;
    assert.equal(next.levelId, 'r01-l02'); assert.equal(next.production.customers.length, 3);
    assert.equal(next.production.goal.metric, 'coins'); assert.equal(next.production.goal.target, 9);
  } finally { await f.root.close('recovery'); }
});
