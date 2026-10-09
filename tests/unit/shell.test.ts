import assert from 'node:assert/strict';
import test from 'node:test';
import { SwitchCoordinator } from '../../assets/shell/switchCoordinator';
import { ProductStorage } from '../../assets/shell/productStorage';
import type { GameplayModule, LeaveStatus, LocalStoragePort, ModuleEntry, SceneDriver, SaveOutcome } from '../../assets/shell/contracts';

class Store implements LocalStoragePort {
  values = new Map<string, string>(); accesses: string[] = []; fail = false;
  getItem(key: string) { this.accesses.push(key); return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.accesses.push(key); if (this.fail) throw Error('quota'); this.values.set(key, value); }
  removeItem(key: string) { this.accesses.push(key); this.values.delete(key); }
}
class Module implements GameplayModule {
  qualified = false;
  promotionReady() { return this.qualified; }
  leave: LeaveStatus = 'ready'; saved: SaveOutcome = { ok: true }; closed = 0; resumed = 0; closeFailure = false;
  constructor(readonly id: 'ant' | 'cook') {}
  canLeave() { return this.leave; }
  async prepareExit() { return this.leave; }
  async flush() { return this.saved; }
  async close() { this.closed++; if (this.closeFailure) throw Error('partial cleanup'); }
  resumeInput() { this.resumed++; }
}
const modes = [{ id: 'ant', bundleName: 'Colony', sceneName: 'ColonyGame' }, { id: 'cook', bundleName: 'game', sceneName: 'Game' }] as const;
function fixture(autoReady = true) {
  const store = new Store(); const entries: ModuleEntry[] = []; const modules: Module[] = [];
  const driver: SceneDriver = {
    async preflight() {},
    async enter(descriptor, entry) { const module = new Module(descriptor.id); entries.push(entry); modules.push(module); entry.attach(module); if (autoReady) report(entry); },
  };
  const coordinator = new SwitchCoordinator(modes, driver, store, 100);
  return { store, entries, modules, driver, coordinator };
}
function report(entry: ModuleEntry) { entry.ready({ mode: entry.mode, transactionId: entry.transactionId, businessReady: true, firstFrameReady: true }); }
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('recommendation reads qualified current module only after all save/recovery gates are ready',async()=>{
  const f=fixture();assert.equal(f.coordinator.promotionSource,null);await f.coordinator.switchTo('ant');
  f.modules[0].qualified=true;assert.equal(f.coordinator.promotionSource,'ant');f.modules[0].leave='playing';assert.equal(f.coordinator.promotionSource,null);
  f.modules[0].leave='ready';f.modules[0].saved={ok:false,reason:'disk'};await f.coordinator.switchTo('cook');assert.equal(f.coordinator.promotionSource,null);
  f.modules[0].saved={ok:true};assert.equal(await f.coordinator.retrySave(),true);assert.equal(f.coordinator.promotionSource,'ant');
  await f.coordinator.switchTo('cook','promotion');assert.equal(f.entries.at(-1)?.source,'promotion');assert.equal(f.coordinator.promotionSource,null);
});

test('pending shell metadata prevents recommendations until its own retry succeeds',async()=>{
  const f=fixture();f.store.fail=true;const result=await f.coordinator.switchTo('ant');assert.equal(result.ok,true);
  f.modules[0].qualified=true;assert.equal(f.coordinator.promotionSource,null);f.store.fail=false;assert.equal(f.coordinator.retryMetadata(),true);assert.equal(f.coordinator.promotionSource,'ant');
});

test('each gameplay and shell use only their new physical namespace; old bytes survive', () => {
  const store = new Store(); store.values.set('p10_cook_framework_snapshot_v1', 'old cook'); store.values.set('colony.save', 'old ant');
  const ant = new ProductStorage(store, 'ant'), cook = new ProductStorage(store, 'cook'), shell = new ProductStorage(store, 'shell');
  ant.setItem('progress', 'ant'); cook.setItem('progress', 'cook'); shell.setItem('navigation', 'shell');
  assert.equal(ant.getItem('progress'), 'ant'); assert.equal(cook.getItem('progress'), 'cook');
  assert.equal(store.values.get('p10_cook_framework_snapshot_v1'), 'old cook');
  assert.equal(store.values.get('colony.save'), 'old ant');
  assert.ok(store.accesses.every(key => key.startsWith('p4000.ant-cook.dev1.')));
});

test('scene load completion alone cannot commit mode; same click joins and other click is blocked', async () => {
  const f = fixture(false); const first = f.coordinator.switchTo('ant');
  assert.equal(f.coordinator.switchTo('ant'), first);
  assert.equal((await f.coordinator.switchTo('cook')).ok, false);
  await tick(); assert.equal(f.coordinator.currentMode, null);
  f.entries[0].ready({ mode: 'ant', transactionId: 'wrong', businessReady: true, firstFrameReady: true });
  f.entries[0].ready({ mode: 'ant', transactionId: f.entries[0].transactionId, businessReady: true, firstFrameReady: false });
  assert.equal(f.coordinator.currentMode, null);
  report(f.entries[0]); assert.equal((await first).ok, true); assert.equal(f.coordinator.currentMode, 'ant');
});

test('ads, rewards, live round and pending save block switch without closing the source', async () => {
  const f = fixture(); await f.coordinator.switchTo('ant');
  for (const reason of ['adShowing', 'rewardPending', 'playing', 'saveFailed'] as const) {
    f.modules[0].leave = reason;
    assert.deepEqual(await f.coordinator.switchTo('cook'), { ok: false, reason, canContinue: reason !== 'saveFailed' });
    assert.equal(f.modules[0].closed, 0); assert.equal(f.coordinator.currentMode, 'ant');
  }
});

test('flush failure stays on source, and retry does not execute another mode transition', async () => {
  const f = fixture(); await f.coordinator.switchTo('ant'); f.modules[0].saved = { ok: false, reason: 'quota' };
  const blocked = await f.coordinator.switchTo('cook'); assert.ok(!blocked.ok && blocked.canContinue === false); assert.equal(f.modules[0].closed, 0);
  assert.equal(await f.coordinator.retrySave(), false);
  f.modules[0].saved = { ok: true }; assert.equal(await f.coordinator.retrySave(), true);
  assert.equal(f.entries.length, 1); assert.equal(f.modules[0].resumed, 1);
});

test('partial source close retains failed owner and blocks every entry until serialized cleanup succeeds', async () => {
  const f = fixture(); await f.coordinator.switchTo('ant'); const stale = f.entries[0]; f.modules[0].closeFailure = true;
  const result = await f.coordinator.switchTo('cook'); assert.equal(result.ok, false);
  assert.ok(!result.ok && !result.recoveredMode); assert.equal(f.entries.length, 1);
  assert.equal(stale.isCurrent(), false); report(stale); assert.equal(f.coordinator.currentMode, null);
  assert.equal(f.coordinator.cleanupBlockedMode, 'ant');
  assert.equal((await f.coordinator.switchTo('cook')).ok, false);
  assert.equal((await f.coordinator.switchTo('ant')).ok, false);
  assert.equal(await f.coordinator.retrySave(), false); assert.equal(await f.coordinator.retryCleanup(), false);
  let finish!: () => void;
  f.modules[0].close = () => new Promise<void>(resolve => { finish = resolve; });
  const retry = f.coordinator.retryCleanup(); assert.equal(f.coordinator.retryCleanup(), retry);
  await tick(); assert.equal((await f.coordinator.switchTo('cook')).ok, false); assert.equal(f.entries.length, 1);
  finish(); assert.equal(await retry, true); assert.equal(f.coordinator.cleanupBlockedMode, null);
  assert.equal((await f.coordinator.switchTo('cook')).ok, true);
});

test('same-mode selection cannot dismiss a pending business save, while preload refusal permits returning', async () => {
  const f = fixture(); await f.coordinator.switchTo('ant'); f.modules[0].leave = 'saveFailed';
  const pending = await f.coordinator.switchTo('ant'); assert.ok(!pending.ok && pending.canContinue === false);
  assert.equal(f.entries.length, 1); assert.equal(f.modules[0].resumed, 0);
  f.modules[0].leave = 'ready'; f.driver.preflight = async () => { throw Error('offline'); };
  const stillPending = await f.coordinator.switchTo('cook'); assert.ok(!stillPending.ok && stillPending.canContinue === false);
  assert.equal(await f.coordinator.retrySave(), true);
  const offline = await f.coordinator.switchTo('cook'); assert.ok(!offline.ok && offline.canContinue === true);
  assert.equal(f.coordinator.currentMode, 'ant'); assert.equal(f.modules[0].closed, 0);
});

test('metadata failure after business recovery allows continuation and subsequent retries never flush gameplay', async () => {
  const f = fixture(); f.store.fail = true; await f.coordinator.switchTo('ant');
  const module = f.modules[0]; let flushes = 0; module.leave = 'saveFailed';
  module.flush = async () => { flushes++; module.leave = 'ready'; return { ok: true }; };
  assert.equal(await f.coordinator.retrySave(), false); assert.equal(flushes, 1);
  assert.equal(f.coordinator.onlyMetadataPending, true); assert.equal(f.coordinator.currentMode, 'ant');
  assert.equal(await f.coordinator.retrySave(), false); assert.equal(flushes, 1);
  f.store.fail = false; assert.equal(await f.coordinator.retrySave(), true); assert.equal(flushes, 1);
  assert.equal(f.coordinator.hasPendingMetadata, false); assert.equal(f.entries.length, 1);
});

test('page recovery rejection cannot be mistaken for metadata-only work or bypassed by selecting the same mode', async () => {
  const f = fixture(); f.store.fail = true; await f.coordinator.switchTo('cook');
  const module = f.modules[0]; let flushes = 0; module.leave = 'saveFailed';
  module.flush = async () => { flushes++; module.leave = 'playing'; throw Error('page render failed after save'); };
  assert.equal(await f.coordinator.retrySave(), false); assert.equal(f.coordinator.onlyMetadataPending, false);
  const same = await f.coordinator.switchTo('cook'); assert.ok(!same.ok && same.canContinue === false);
  module.flush = async () => { flushes++; module.leave = 'ready'; return { ok: true }; };
  assert.equal(await f.coordinator.retrySave(), false); assert.equal(flushes, 2); assert.equal(f.coordinator.onlyMetadataPending, true);
  f.store.fail = false; assert.equal(await f.coordinator.retrySave(), true); assert.equal(flushes, 2);
  assert.equal(f.entries.length, 1);
});

test('failed target and failed recovery cleanup retain their exact owner, with no fresh entry', async () => {
  for (const failure of ['target', 'recovery']) {
    const f = fixture(); await f.coordinator.switchTo('ant'); const enter = f.driver.enter;
    f.driver.enter = async (d, e) => {
      await enter(d, e);
      if (d.id === 'cook' || e.source === 'recovery') {
        f.modules.at(-1)!.closeFailure = failure === 'target' ? d.id === 'cook' : e.source === 'recovery';
        throw Error('page failed');
      }
    };
    assert.equal((await f.coordinator.switchTo('cook')).ok, false);
    assert.equal(f.entries.length, failure === 'target' ? 2 : 3);
    assert.equal(f.coordinator.cleanupBlockedMode, failure === 'target' ? 'cook' : 'ant');
    const count = f.entries.length; assert.equal((await f.coordinator.switchTo('ant')).ok, false); assert.equal(f.entries.length, count);
    f.modules.at(-1)!.closeFailure = false; assert.equal(await f.coordinator.retryCleanup(), true);
  }
});

test('startup save continuation cleanup failure blocks subsequent fresh entry', async () => {
  const f = fixture(false);
  f.driver.enter = async (d, e) => {
    const module = new Module(d.id); f.entries.push(e); f.modules.push(module); e.attach(module);
    module.closeFailure = true; module.flush = async () => { throw Error('page failed'); }; e.saveBlocked('quota');
  };
  await f.coordinator.switchTo('cook'); assert.equal(await f.coordinator.retrySave(), false);
  assert.equal(f.coordinator.cleanupBlockedMode, 'cook'); assert.equal((await f.coordinator.switchTo('ant')).ok, false);
  f.modules[0].closeFailure = false; assert.equal(await f.coordinator.retryCleanup(), true);
});

test('invalid shell navigation and read failure preserve gameplay bytes and permit included entry', async () => {
  for (const raw of ['{bad', '{}', '{"version":9}', '{"version":1,"lastPlayed":"unknown"}']) {
    const f = fixture(); const nav = new ProductStorage(f.store, 'shell'); nav.setItem('navigation', raw);
    new ProductStorage(f.store, 'ant').setItem('progress', 'untouched');
    const coordinator = new SwitchCoordinator(modes, f.driver, f.store);
    assert.ok(coordinator.navigationWarning); assert.equal(coordinator.lastPlayed, undefined);
    assert.equal((await coordinator.switchTo('cook')).ok, true);
    assert.equal(new ProductStorage(f.store, 'ant').getItem('progress'), 'untouched');
  }
  const f = fixture(); f.store.getItem = () => { throw Error('storage read failed'); };
  const coordinator = new SwitchCoordinator([modes[0]], f.driver, f.store);
  assert.ok(coordinator.navigationWarning); assert.equal((await coordinator.switchTo('ant')).ok, true);
  const other = fixture(); new ProductStorage(other.store, 'shell').setItem('navigation', '{"version":1,"lastPlayed":"cook"}');
  assert.equal(new SwitchCoordinator([modes[0]], other.driver, other.store).lastPlayed, undefined);
});

test('target readiness failure disposes target then reloads source', async () => {
  const f = fixture(); await f.coordinator.switchTo('ant');
  const enter = f.driver.enter;
  f.driver.enter = async (d, e) => { await enter(d, e); if (d.id === 'cook') throw Error('first page failed'); };
  const result = await f.coordinator.switchTo('cook');
  assert.ok(!result.ok && result.recoveredMode === 'ant');
  assert.equal(f.modules[1].closed, 1); assert.equal(f.coordinator.currentMode, 'ant');
});

test('shell metadata failure retains ready gameplay and retry creates no scene', async () => {
  const f = fixture(); f.store.fail = true;
  assert.deepEqual(await f.coordinator.switchTo('cook'), { ok: true, mode: 'cook', metadataPending: true });
  f.store.fail = false; assert.equal(f.coordinator.retryMetadata(), true); assert.equal(f.entries.length, 1);
  assert.equal(f.coordinator.lastPlayed, 'cook');
});

test('excluded mode is rejected before resource preflight', async () => {
  let calls = 0; const coordinator = new SwitchCoordinator([modes[0]], { async preflight() { calls++; }, async enter() {} }, new Store(), 10);
  assert.equal((await coordinator.switchTo('cook')).ok, false); assert.equal(calls, 0);
});

test('initial save block keeps the attached module for exact save retry then readiness', async () => {
  const f = fixture(false);
  f.driver.enter = async (d, e) => {
    const module = new Module(d.id); f.entries.push(e); f.modules.push(module); e.attach(module);
    module.saved = { ok: false, reason: 'quota' };
    module.flush = async () => { if (module.saved.ok) report(e); return module.saved; };
    e.saveBlocked('quota');
  };
  assert.equal((await f.coordinator.switchTo('cook')).ok, false);
  assert.equal(f.modules[0].closed, 0); assert.equal(f.coordinator.currentMode, null);
  assert.equal(await f.coordinator.retrySave(), false);
  f.modules[0].saved = { ok: true }; assert.equal(await f.coordinator.retrySave(), true);
  assert.equal(f.coordinator.currentMode, 'cook'); assert.equal(f.entries.length, 1);
});

test('pending startup continuation failure clears the entry and permits a fresh attempt', async () => {
  const f = fixture(false);
  f.driver.enter = async (d, e) => {
    const module = new Module(d.id); f.entries.push(e); f.modules.push(module); e.attach(module);
    module.flush = async () => { throw Error('first page failed'); };
    e.saveBlocked('quota');
  };
  await f.coordinator.switchTo('cook'); assert.equal(await f.coordinator.retrySave(), false);
  assert.equal(f.modules[0].closed, 1); assert.equal(f.entries[0].isCurrent(), false);
  f.driver.enter = async (d, e) => { const module = new Module(d.id); e.attach(module); report(e); };
  assert.equal((await f.coordinator.switchTo('ant')).ok, true);
});

test('scene load with no callback expires and a late entry is fenced', async () => {
  let late!: ModuleEntry;
  const coordinator = new SwitchCoordinator(modes, { async preflight() {}, enter: async (_, e) => { late = e; await new Promise(() => undefined); } }, new Store(), 10);
  assert.equal((await coordinator.switchTo('cook')).ok, false);
  assert.equal(coordinator.isSwitching, false); assert.equal(late.isCurrent(), false);
});

test('startup save retry with no ready is bounded and permits another choice', async () => {
  let module!: Module;
  const coordinator = new SwitchCoordinator(modes, { async preflight() {}, async enter(d, e) { module = new Module(d.id); e.attach(module); e.saveBlocked('quota'); } }, new Store(), 10);
  await coordinator.switchTo('cook'); assert.equal(await coordinator.retrySave(), false); assert.equal(module.closed, 1);
});

test('ordinary save retry also commits pending shell metadata', async () => {
  const f = fixture(); f.store.fail = true; await f.coordinator.switchTo('ant');
  assert.equal(await f.coordinator.retrySave(), false); f.store.fail = false;
  assert.equal(await f.coordinator.retrySave(), true); assert.equal(f.coordinator.lastPlayed, 'ant');
});

test('cleanup must settle before any fresh module can reuse global registration keys', async () => {
  const f = fixture(); await f.coordinator.switchTo('ant');
  let finish!: () => void;
  f.modules[0].close = () => new Promise<void>(resolve => { finish = resolve; });
  const switchTask = f.coordinator.switchTo('cook'); await tick();
  assert.equal(f.entries.length, 1); assert.equal(f.coordinator.isSwitching, true);
  assert.equal((await f.coordinator.switchTo('ant')).ok, false);
  finish(); assert.equal((await switchTask).ok, true); assert.equal(f.entries.length, 2);
});
