import assert from 'node:assert/strict';
import test from 'node:test';
import { SwitchCoordinator } from '../../assets/shell/switchCoordinator';
import { TelemetryClient } from '../../assets/shell/observability/telemetryClient';
import { LocalRecordingAdapter } from '../../assets/shell/observability/telemetryAdapters';
import type { GameplayModule, LeaveStatus, LocalStoragePort, ModeId, ModuleEntry, ProductTelemetryPort, SaveOutcome, SceneDriver } from '../../assets/shell/contracts';
import type { FactIdentity, TelemetryEventName } from '../../assets/shell/observability/telemetrySchema';

class Store implements LocalStoragePort {
  values = new Map<string, string>(); fail = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.fail) throw Error('quota'); this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
class Module implements GameplayModule {
  leave: LeaveStatus = 'ready'; saved: SaveOutcome = { ok: true }; closed = 0;
  constructor(readonly id: ModeId) {}
  canLeave() { return this.leave; }
  async prepareExit() { return this.leave; }
  async flush() { return this.saved; }
  async close() { this.closed++; }
  resumeInput() {}
}
const modes = [{ id: 'ant', bundleName: 'Colony', sceneName: 'ColonyGame' }, { id: 'cook', bundleName: 'game', sceneName: 'Game' }] as const;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const report = (entry: ModuleEntry) => entry.ready({ mode: entry.mode, transactionId: entry.transactionId, businessReady: true, firstFrameReady: true });
function fixture(observer?: ProductTelemetryPort, timeout = 100) {
  const store = new Store(), entries: ModuleEntry[] = [], modules: Module[] = [];
  const facts: { name: TelemetryEventName; fields: unknown; identity: FactIdentity; active: ModeId | null }[] = [];
  let coordinator!: SwitchCoordinator;
  const telemetry: ProductTelemetryPort = observer ?? { track(name, fields, identity) { facts.push({ name, fields, identity, active: coordinator.currentMode }); } };
  const driver: SceneDriver = { async preflight() {}, async enter(descriptor, entry) {
    const module = new Module(descriptor.id); entries.push(entry); modules.push(module); entry.attach(module); report(entry);
  } };
  coordinator = new SwitchCoordinator(modes, driver, store, timeout, telemetry);
  return { store, entries, modules, driver, coordinator, facts };
}

test('switch fact waits for both readiness signals, scene completion and active assignment; a joined flight emits once', async () => {
  const f = fixture(); let finish!: () => void;
  f.driver.enter = async (descriptor, entry) => {
    const module = new Module(descriptor.id); f.entries.push(entry); f.modules.push(module); entry.attach(module);
    await new Promise<void>(resolve => { finish = resolve; });
  };
  const flight = f.coordinator.switchTo('ant', 'launch'); assert.equal(f.coordinator.switchTo('ant'), flight);
  await tick(); const entry = f.entries[0];
  entry.ready({ mode: 'ant', transactionId: entry.transactionId, businessReady: true, firstFrameReady: false });
  assert.deepEqual(f.facts, []); report(entry); await tick(); assert.deepEqual(f.facts, []);
  finish(); assert.equal((await flight).ok, true);
  assert.deepEqual(f.facts, [{ name: 'gameplay_switch_completed', fields: { from: 'shell', to: 'ant' }, identity: { factId: entry.transactionId }, active: 'ant' }]);
});

test('metadata-pending activation counts as success; same-mode selection and metadata retries add no facts', async () => {
  const f = fixture(); await f.coordinator.switchTo('ant'); f.store.fail = true;
  assert.deepEqual(await f.coordinator.switchTo('cook'), { ok: true, mode: 'cook', metadataPending: true });
  assert.deepEqual(f.facts[1], { name: 'gameplay_switch_completed', fields: { from: 'ant', to: 'cook' }, identity: { factId: f.entries[1].transactionId }, active: 'cook' });
  assert.equal((await f.coordinator.switchTo('cook')).ok, true); assert.equal(f.coordinator.retryMetadata(), false);
  f.store.fail = false; assert.equal(f.coordinator.retryMetadata(), true); assert.equal(await f.coordinator.retrySave(), true);
  assert.equal(f.facts.length, 2); assert.equal(f.entries.length, 2);
});

test('Cocos-style destruction clearing the old component ID cannot corrupt the completed switch source', async () => {
  const f = fixture(); await f.coordinator.switchTo('ant'); const old = f.modules[0];
  old.close = async () => { old.closed++; Object.defineProperty(old, 'id', { value: '' }); };
  assert.equal((await f.coordinator.switchTo('cook')).ok, true);
  assert.deepEqual(f.facts[1].fields, { from: 'ant', to: 'cook' }); assert.equal(f.facts[1].active, 'cook');
});

test('a failed target returns to the captured source mode after destruction cleared its component ID', async () => {
  const f = fixture(); await f.coordinator.switchTo('ant'); const old = f.modules[0];
  old.close = async () => { old.closed++; Object.defineProperty(old, 'id', { value: '' }); };
  const enter = f.driver.enter; f.driver.enter = async (d, e) => { await enter(d, e); if (d.id === 'cook') throw Error('target page failed'); };
  const result = await f.coordinator.switchTo('cook'); assert.ok(!result.ok && result.recoveredMode === 'ant');
  assert.equal(f.coordinator.currentMode, 'ant'); assert.equal(f.entries[2].mode, 'ant'); assert.equal(f.facts.length, 1);
});

test('source close rejection after ID clearing keeps the cleanup retry route and exact owner through repeated failures', async () => {
  const f = fixture(); await f.coordinator.switchTo('ant'); const old = f.modules[0]; let calls = 0;
  old.close = async () => { calls++; Object.defineProperty(old, 'id', { value: '' }); if (calls < 3) throw Error('late cleanup failed'); };
  assert.equal((await f.coordinator.switchTo('cook')).ok, false); assert.equal(f.coordinator.cleanupBlockedMode, 'ant');
  assert.equal(await f.coordinator.retrySave(), false); assert.equal(f.entries.length, 1);
  assert.equal(await f.coordinator.retryCleanup(), false); assert.equal(f.coordinator.cleanupBlockedMode, 'ant');
  assert.equal((await f.coordinator.switchTo('cook')).ok, false); assert.equal(f.entries.length, 1);
  assert.equal(await f.coordinator.retryCleanup(), true); assert.equal(calls, 3); assert.equal(f.coordinator.cleanupBlockedMode, null);
  assert.equal((await f.coordinator.switchTo('cook')).ok, true); assert.equal(f.entries.length, 2);
});

test('initial save continuation stores its mode before a rejected flush and cleanup clear component fields', async () => {
  const f = fixture(); let failCleanup = true;
  f.driver.enter = async (d, e) => {
    const module = new Module(d.id); f.entries.push(e); f.modules.push(module); e.attach(module);
    module.flush = async () => { Object.defineProperty(module, 'id', { value: '' }); throw Error('page recovery failed'); };
    module.close = async () => { Object.defineProperty(module, 'id', { value: '' }); if (failCleanup) throw Error('cleanup failed'); };
    e.saveBlocked('quota');
  };
  assert.equal((await f.coordinator.switchTo('cook')).ok, false); assert.equal(await f.coordinator.retrySave(), false);
  assert.equal(f.coordinator.cleanupBlockedMode, 'cook'); assert.equal(f.entries[0].isCurrent(), false);
  assert.equal((await f.coordinator.switchTo('ant')).ok, false); assert.equal(f.entries.length, 1);
  failCleanup = false; assert.equal(await f.coordinator.retryCleanup(), true); assert.deepEqual(f.facts, []);
});

test('failed target cleanup uses its descriptor mode after destruction and exposes cleanup retry before source recovery', async () => {
  const f = fixture(); await f.coordinator.switchTo('ant'); const enter = f.driver.enter; let failCleanup = true;
  f.driver.enter = async (d, e) => {
    await enter(d, e); if (d.id !== 'cook') return;
    const failed = f.modules.at(-1)!;
    failed.close = async () => { Object.defineProperty(failed, 'id', { value: '' }); if (failCleanup) throw Error('target cleanup failed'); };
    throw Error('target page failed');
  };
  assert.equal((await f.coordinator.switchTo('cook')).ok, false); assert.equal(f.coordinator.cleanupBlockedMode, 'cook');
  assert.equal(f.entries.length, 2); assert.equal(await f.coordinator.retrySave(), false);
  failCleanup = false; assert.equal(await f.coordinator.retryCleanup(), true); assert.equal(f.coordinator.cleanupBlockedMode, null);
  f.driver.enter = enter; assert.equal((await f.coordinator.switchTo('ant')).ok, true); assert.equal(f.coordinator.currentMode, 'ant');
});

test('leave refusal, failed save and a failed target recovered to source produce no new completion fact', async () => {
  const f = fixture(); await f.coordinator.switchTo('ant');
  for (const reason of ['playing', 'adShowing', 'rewardPending'] as const) {
    f.modules[0].leave = reason; assert.equal((await f.coordinator.switchTo('cook')).ok, false); assert.equal(f.facts.length, 1);
  }
  f.modules[0].leave = 'ready'; f.modules[0].saved = { ok: false, reason: 'quota' };
  assert.equal((await f.coordinator.switchTo('cook')).ok, false); assert.equal(await f.coordinator.retrySave(), false);
  f.modules[0].saved = { ok: true }; assert.equal(await f.coordinator.retrySave(), true);
  const enter = f.driver.enter; f.driver.enter = async (d, e) => { await enter(d, e); if (d.id === 'cook') throw Error('page failed'); };
  const failed = await f.coordinator.switchTo('cook'); assert.ok(!failed.ok && failed.recoveredMode === 'ant');
  assert.equal(f.coordinator.currentMode, 'ant'); assert.equal(f.facts.length, 1);
});

test('initial save recovery uses the original entry fact ID once, only after successful persist and readiness', async () => {
  const f = fixture(); f.driver.enter = async (descriptor, entry) => {
    const module = new Module(descriptor.id); f.entries.push(entry); f.modules.push(module); entry.attach(module);
    module.saved = { ok: false, reason: 'quota' };
    module.flush = async () => { if (module.saved.ok) report(entry); return module.saved; };
    entry.saveBlocked('quota');
  };
  assert.equal((await f.coordinator.switchTo('cook', 'launch')).ok, false); assert.deepEqual(f.facts, []);
  assert.equal(await f.coordinator.retrySave(), false); assert.deepEqual(f.facts, []);
  f.modules[0].saved = { ok: true }; f.store.fail = true;
  assert.equal(await f.coordinator.retrySave(), false); assert.equal(f.coordinator.onlyMetadataPending, true);
  assert.deepEqual(f.facts, [{ name: 'gameplay_switch_completed', fields: { from: 'shell', to: 'cook' }, identity: { factId: f.entries[0].transactionId }, active: 'cook' }]);
  f.store.fail = false; assert.equal(await f.coordinator.retrySave(), true); assert.equal((await f.coordinator.switchTo('cook')).ok, true);
  assert.equal(f.facts.length, 1); assert.equal(f.entries.length, 1);
});

test('a throwing observer cannot fail activation, save recovery or metadata retries', async () => {
  let attempts = 0; const f = fixture({ track() { attempts++; throw Error('observer unavailable'); } });
  assert.equal((await f.coordinator.switchTo('ant')).ok, true); f.store.fail = true;
  assert.deepEqual(await f.coordinator.switchTo('cook'), { ok: true, mode: 'cook', metadataPending: true });
  assert.equal(f.coordinator.currentMode, 'cook'); f.store.fail = false; assert.equal(f.coordinator.retryMetadata(), true);
  assert.equal(attempts, 2); assert.equal(f.modules[0].closed, 1);
});

test('initial save retry cannot activate or emit while the original scene entry is still pending', async () => {
  const f = fixture(); let finish!: () => void;
  f.driver.enter = async (descriptor, entry) => {
    const module = new Module(descriptor.id); f.entries.push(entry); f.modules.push(module); entry.attach(module);
    module.flush = async () => { report(entry); return { ok: true }; };
    entry.saveBlocked('quota'); await new Promise<void>(resolve => { finish = resolve; });
  };
  assert.equal((await f.coordinator.switchTo('cook', 'launch')).ok, false);
  const retry = f.coordinator.retrySave(); await tick();
  assert.equal(f.coordinator.currentMode, null); assert.deepEqual(f.facts, []);
  finish(); assert.equal(await retry, true); assert.equal(f.coordinator.currentMode, 'cook');
  assert.equal(f.facts.length, 1); assert.equal(f.facts[0].identity.factId, f.entries[0].transactionId);
});

test('original scene entry rejection during initial save retry cannot report success or escape cleanup', async () => {
  const f = fixture(); let fail!: (cause: unknown) => void;
  f.driver.enter = async (descriptor, entry) => {
    const module = new Module(descriptor.id); f.entries.push(entry); f.modules.push(module); entry.attach(module);
    module.flush = async () => { report(entry); return { ok: true }; };
    entry.saveBlocked('quota'); await new Promise<void>((_resolve, reject) => { fail = reject; });
  };
  assert.equal((await f.coordinator.switchTo('cook', 'launch')).ok, false);
  const retry = f.coordinator.retrySave(); await tick(); fail(Error('scene entry failed after save'));
  assert.equal(await retry, false); assert.equal(f.coordinator.currentMode, null); assert.deepEqual(f.facts, []);
  assert.equal(f.entries[0].isCurrent(), false); assert.equal(f.modules[0].closed, 1);
  f.driver.enter = async (d, e) => { const module = new Module(d.id); e.attach(module); report(e); };
  assert.equal((await f.coordinator.switchTo('ant')).ok, true); assert.equal(f.facts.length, 1);
});

test('late readiness for a timed-out entry emits no fact and cannot take over a newer gameplay', async () => {
  const f = fixture(undefined, 15); const enter = f.driver.enter;
  f.driver.enter = async (d, e) => { const m = new Module(d.id); f.entries.push(e); f.modules.push(m); e.attach(m); };
  assert.equal((await f.coordinator.switchTo('cook')).ok, false); assert.deepEqual(f.facts, []);
  const stale = f.entries[0]; f.driver.enter = enter; assert.equal((await f.coordinator.switchTo('ant')).ok, true);
  report(stale); assert.equal(f.coordinator.currentMode, 'ant'); assert.equal(f.facts.length, 1);
  assert.equal(f.facts[0].identity.factId, f.entries[1].transactionId);
});

test('default-off and invalid metadata clients observe the same lifecycle without recording or storage effects', async () => {
  for (const enabled of [false, true]) {
    const recorder = new LocalRecordingAdapter();
    const client = new TelemetryClient({ enabled, adapter: recorder, context: {
      product: 'ant-cook', gameplay: 'shell', environment: 'development', platform: 'web',
      sessionId: 'fixture-session', release: '0.3.0.21', commit: '', buildId: '',
    } });
    const f = fixture(client); assert.equal((await f.coordinator.switchTo('ant')).ok, true); assert.equal((await f.coordinator.switchTo('cook')).ok, true);
    client.flush(); assert.deepEqual(recorder.snapshot(), []);
    assert.ok([...f.store.values.keys()].every(key => key.endsWith('.shell.navigation')));
  }
});
