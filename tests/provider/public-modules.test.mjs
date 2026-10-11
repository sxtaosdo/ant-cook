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

function fixture() {
  const scene = {}, transitions = [], timers = [];
  class Component { isValid = true; enabledInHierarchy = true; schedule() {} unschedule() {} }
  class Coordinator {
    lastPlayed = 'ant';
    constructor(_modes, driver, _storage, _unused, port) { this.telemetry = port; this.driver = driver; }
  }
  const cc = { Component, Camera: class {}, Canvas: class {}, Node: class {}, Label: class {}, UITransform: class {},
    _decorator: { ccclass: () => Type => Type, property: (_target, key) => typeof key === 'string' ? undefined : () => {} },
    director: { getScene: () => scene, addPersistRootNode() {}, off() {} }, Director: { EVENT_BEFORE_UPDATE: 'before-update' },
    Layers: { addLayer() {} }, ResolutionPolicy: { FIXED_WIDTH: 1 }, view: { setDesignResolutionSize() {} },
    sys: { isNative: false, platform: 'web', Platform: { WECHAT_GAME: 'wechat' }, localStorage: {} } };
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
  const root = new exports.ProductBootstrap(); root.node = { parent: scene };
  root.initializeNavigation = () => {};
  root.openMode = async mode => { transitions.push(mode); };
  return { root, timers, transitions };
}

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
