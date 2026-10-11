import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { StateMachine } from 'db://shidai3/index';
import * as auth from 'db://shidai3/auth/index';
import * as telemetry from 'db://shidai3/observability/index';
import { PRODUCT_BUILD_VERSION } from '../../assets/shell/buildInfo';

function fixture() {
  const scene = {}, transitions = [], timers = [];
  class Component { isValid = true; enabledInHierarchy = true; schedule() {} unschedule() {} }
  class Coordinator {
    lastPlayed = 'ant';
    constructor(_modes, _driver, _storage, _unused, port) { this.telemetry = port; }
  }
  const cc = { Component, Camera: class {}, Canvas: class {}, Node: class {}, Label: class {}, UITransform: class {},
    _decorator: { ccclass: () => Type => Type, property: (_target, key) => typeof key === 'string' ? undefined : () => {} },
    director: { getScene: () => scene, addPersistRootNode() {}, off() {} }, Director: { EVENT_BEFORE_UPDATE: 'before-update' },
    Layers: { addLayer() {} }, ResolutionPolicy: { FIXED_WIDTH: 1 }, view: { setDesignResolutionSize() {} },
    sys: { isNative: false, platform: 'web', Platform: { WECHAT_GAME: 'wechat' }, localStorage: {} } };
  const imports = { cc, 'db://shidai3/index': { StateMachine }, 'db://shidai3/auth/index': auth,
    'db://shidai3/observability/index': telemetry, mk: { default: { bundle: {} } },
    './buildModes': { BUILD_MODES: [{ id: 'ant' }] }, './contracts': { ModuleEntryGate: {} },
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

test('actual Bootstrap owns shared guest auth and feeds the shared disabled telemetry to its coordinator', async () => {
  const { root, timers, transitions } = fixture();
  await root.boot();
  assert.ok(root.authSession instanceof auth.AuthSession);
  assert.deepEqual(root.authSession.snapshot(), { status: 'guest' });
  assert.equal((await root.authSession.login()).status, 'unavailable');
  assert.deepEqual(timers, []);
  assert.deepEqual(transitions, ['ant']);
  assert.ok(root.telemetry instanceof telemetry.TelemetryClient);
  assert.ok(root.telemetryRecords instanceof telemetry.LocalRecordingAdapter);
  assert.equal(root.coordinator.telemetry, root.telemetry);
  assert.equal(root.telemetry.flush().status, 'disabled');
  assert.equal(root.telemetry.capabilities().externalDelivery, false);
  assert.deepEqual(root.telemetryRecords.snapshot(), []);
  const session = root.authSession;
  let logouts = 0;
  const logout = session.logout.bind(session);
  session.logout = () => { logouts++; logout(); };
  root.beginAuthSession();
  assert.equal(root.authSession, session);
  root.onDestroy(); root.onDestroy(); root.beginAuthSession();
  assert.equal(logouts, 1);
  assert.equal(root.authSession, null);
});

test('actual Bootstrap starts local modes without waiting for shared auth login', async () => {
  const { root, transitions } = fixture();
  const login = auth.AuthSession.prototype.login;
  let calls = 0;
  try {
    auth.AuthSession.prototype.login = () => { calls++; return new Promise(() => {}); };
    await root.boot();
    assert.equal(calls, 1);
    assert.deepEqual(transitions, ['ant']);
    root.onDestroy();
  } finally { auth.AuthSession.prototype.login = login; }
});
