import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { LoginFacade } from 'db://shidai3/auth/index';
import { ModuleEntryGate, UNAVAILABLE_ACCOUNT } from '../../assets/shell/contracts.ts';
import { PlayerProfile } from '../../assets/Colony/scripts/application/playerProfile.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
// Preserve the real legacy asset boundary even after Owner later checkpoints the new row.
const LEGACY_SETTINGS_REVISION = 'c9818cd67ab1f1845e84893e7d00982be1db0258';

// Actual facade, Settings view, controller and presenter; all platform/storage ports are synthetic.
async function fixture(config = { enabled: true, platformConfigured: true, provider: 'google',
  scope: { issuer: 'fixture', applicationId: 'fixture', host: 'fixture' } }, assetVariant) {
  let now = 1000, acquires = 0, exchanges = 0, reads = 0, current = true;
  const deadlines = new Map(), attempts = [], stored = new Map(), warnings = []; let writes = 0;
  const assetPath = 'assets/Colony/popups/settings/prefab/settings.prefab';
  let serialized = null;
  if (assetVariant === 'head') {
    serialized = JSON.parse(execFileSync('git', ['show', LEGACY_SETTINGS_REVISION + ':' + assetPath],
      { cwd: new URL('../../', import.meta.url), encoding: 'utf8' }));
  } else if (assetVariant === 'owner') {
    serialized = JSON.parse(readFileSync(new URL('../../' + assetPath, import.meta.url), 'utf8'));
  }
  const clock = { now: () => now, schedule(fn) { const id = {}; deadlines.set(id, fn); return id; }, cancel(id) { deadlines.delete(id); } };
  const facade = new LoginFacade({ clock, timeoutMs: 100, config,
    credential: { acquire() { acquires++; const gate = deferred(); attempts.push(gate); return gate.promise; } },
    exchange: { async exchange() { exchanges++; return { gameAccountId: 'fixture-account', sessionId: 'fixture-session', expiresAtMs: now + 1000 }; } },
  });
  const project = () => { const state = facade.snapshot(); return { authStatus: state.auth.status, feedback: state.feedback,
    canRequestLogin: state.canRequestLogin, localPlayAvailable: true }; };
  const account = { snapshot: project, async requestLogin() { await facade.requestLogin(); }, cancel: () => facade.cancel(), logout: () => facade.logout() };
  const entry = { mode: 'ant', isCurrent: () => current, account }; ModuleEntryGate.bind(entry);
  const profile = new PlayerProfile({ read: key => stored.get(key) ?? null, write(key, value) { writes++; stored.set(key, value); } },
    3, () => 'local-' + 'c'.repeat(32), () => 1000, false);
  class Events {
    handlers = new Map();
    on(key, fn, owner) { const list = this.handlers.get(key) ?? []; list.push({ fn, owner }); this.handlers.set(key, list); }
    off(key) { this.handlers.delete(key); }
    targetOff(owner) { for (const [key, list] of this.handlers) this.handlers.set(key, list.filter(x => x.owner !== owner)); }
    emit(key, ...args) { return Promise.all((this.handlers.get(key) ?? []).map(x => x.fn.call(x.owner, ...args))); }
  }
  class Button { static EventType = { CLICK: 'click' }; }
  class EditBox { static EventType = { EDITING_DID_ENDED: 'ended', EDITING_RETURN: 'return' }; }
  class Node extends Events {
    static EventType = { TOUCH_START: 'start', TOUCH_MOVE: 'move' };
    isValid = true; active = true; components = new Map();
    get activeInHierarchy() { return this.active; }
    getComponent(Type) { if (!this.components.has(Type)) this.components.set(Type, new Type()); return this.components.get(Type); }
  }
  class Control { isClosing = false; async close() { this.isClosing = true; this._view.event.targetOff(this); this._view.close(); } }
  const cc = { Node, Button, EditBox, Color: class { constructor(value) { this.value = value; } }, Label: class {}, Layout: class {}, Sprite: class {}, SpriteFrame: class {},
    _decorator: { ccclass: () => Type => Type, property: (_target, key) => typeof key === 'string' ? undefined : () => {} } };
  const classes = { contracts: { ModuleEntryGate, UNAVAILABLE_ACCOUNT }, playerProfile: { PlayerProfile },
    colonyUtil: { ColonyUtil: { applyUiLayer() {} } }, resultPopupNav: { swallowMkInterrupt: promise => promise },
    toolControl: { ToolControl: class {} }, communityControl: { CommunityControl: class {} },
    playState: { PlayState: { current: () => null } }, buildInfo: { COLONY_BUILD_VERSION: 'fixture' } };
  const wire = view => {
    if (serialized) {
      // Read the real saved graph; only cc/resource lifecycle is replaced. Never rewrite either asset.
      const objects = serialized.map(value => {
        if (value.__type__ === 'cc.Node') { const node = new Node(); node.name = value._name; node.active = value._active !== false; return node; }
        const Type = cc[value.__type__?.replace('cc.', '')];
        return Type ? new Type() : {};
      });
      serialized.forEach((value, index) => {
        const object = objects[index];
        if (value.node?.__id__ !== undefined) {
          object.node = objects[value.node.__id__];
          const Type = cc[value.__type__?.replace('cc.', '')]; if (Type) object.node.components.set(Type, object);
        }
        if (value.__type__ === 'cc.Label' || value.__type__ === 'cc.EditBox') object.string = value._string ?? '';
        if (value.__type__ === 'cc.Layout') object.updateLayout = () => {};
      });
      const component = serialized.find(value => Object.hasOwn(value, 'nicknameEdit') && Object.hasOwn(value, 'userIdLabel'));
      assert.ok(component, 'actual saved Settings component exists');
      view.node = objects[component.node.__id__];
      for (const [key, value] of Object.entries(component)) {
        if (!Object.hasOwn(view, key)) continue;
        view[key] = value?.__id__ !== undefined ? objects[value.__id__] : value?.__uuid__ ? {} : value;
      }
      return;
    }
    view.node = new Node();
    for (const key of ['settingsRoot', 'musicButton', 'soundButton', 'homeButton', 'restartButton', 'feedbackButton', 'agreementButton',
      'privacyButton', 'closeButton', 'productNavigationButton', 'avatarButton', 'accountActionButton']) view[key] = new Node();
    for (const key of ['musicIcon', 'soundIcon', 'versionLabel', 'userIdLabel', 'noticeLabel', 'profileAvatar', 'profileInitial', 'registeredLabel',
      'accountStatusLabel', 'accountActionLabel']) view[key] = { node: new Node(), string: '' };
    view.nicknameEdit = { node: new Node(), string: '' }; view.controlsLayout = { updateLayout() {} };
    for (const key of ['musicOnFrame', 'musicOffFrame', 'soundOnFrame', 'soundOffFrame']) view[key] = {};
  };
  const mk = { MVCViewBase: class { valid = true; event = new Events(); }, MVCModelBase: class { static async new() { return new this(); } }, MVCControlBase: Control,
    uiManage: { async open(Type, { init }) { const view = new Type(); wire(view); view.init(init); view.open(); return view; } } };
  const load = path => {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../../' + path, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, useDefineForClassFields: false },
    }).outputText, { exports, console: { warn: (...args) => warnings.push(args) },
      require: name => name === 'cc' ? cc : name === 'mk' ? { default: mk } : classes[name.split('/').at(-1)] ?? {} });
    return exports;
  };
  classes.popupView = load('assets/Colony/popups/progress/script/popupView.ts');
  classes.settingsView = load('assets/Colony/popups/settings/script/settingsView.ts');
  classes.progressModel = load('assets/Colony/popups/progress/script/progressModel.ts');
  classes.progressControl = load('assets/Colony/popups/progress/script/progressControl.ts');
  const { ProgressPresentation } = load('assets/Colony/scripts/presentation/progressPresentation.ts');
  const colors = ['#111111', '#222222', '#333333'];
  const context = { popupRoot: new Node(), generation: 1, destroyed: false, profile,
    progress: { snapshot() { reads++; return { coins: 10, diamonds: 20, clearedLevels: [], streak: 0 }; }, availability: () => ({}) },
    leaderboardConfig: { avatarColors: colors }, settings: { snapshot: () => ({ soundEnabled: true, musicEnabled: true }) },
    ads: { hasPendingReward: () => false }, toast: { show() {} }, refreshProfile() {},
  };
  const presentation = new ProgressPresentation(context, 'settings');
  const control = presentation.control = presentation.createControl(); context.progressPopup = control; await control.open();
  const view = control._view, initialProfile = profile.snapshot(), initialStore = [...stored], initialWrites = writes;
  return { facade, account, context, presentation, control, view, attempts, deadlines, profile, stored, Button, warnings,
    reads: () => reads, acquires: () => acquires, exchanges: () => exchanges,
    advance(value) { now = value; }, stale() { current = false; },
    complete(index = attempts.length - 1) { attempts[index].resolve({ provider: 'google', scope: config.scope,
      proof: { kind: 'google-id-token', idToken: 'synthetic', nonce: 'synthetic' } }); },
    unchanged() { assert.deepEqual(profile.snapshot(), initialProfile); assert.deepEqual([...stored], initialStore); assert.equal(writes, initialWrites); },
  };
}

test('disabled/missing local login leaves the actual settings row unavailable with zero SDK/storage work', async () => {
  for (const config of [{ enabled: false }, { enabled: true }]) {
    const f = await fixture(config);
    assert.match(f.view.accountStatusLabel.string, /登录暂不可用.*离线玩法/);
    assert.equal(f.view.accountActionButton.getComponent(f.Button).interactable, false);
    await f.view.accountActionButton.emit('click'); f.view.update(1);
    assert.equal(f.acquires(), 0); assert.equal(f.exchanges(), 0); f.unchanged();
  }
});

test('account refresh and request/cancel bypass generic snapshots and busy profile saves without replacing drafts', async () => {
  const f = await fixture(), { view, control } = f, before = f.reads();
  view.nicknameEdit.string = '未提交草稿'; control._model.feedback = '资料保存待重试'; view.noticeLabel.string = control._model.feedback;
  control.navigation.read = () => { throw Error('Generic read must not run in account lane'); };
  f.context.progress.snapshot = () => { throw Error('Daily/rollback progress snapshot must not run'); };
  control.busy = true; control.profileSaveInFlight = true;
  await view.accountActionButton.emit('click'); await view.event.emit('account-action', 'login');
  assert.equal(f.acquires(), 1); assert.equal(view.accountActionLabel.string, '取消');
  assert.equal(view.accountActionButton.getComponent(f.Button).interactable, true);
  f.advance(86400001); view.update(1); f.advance(500); view.update(1);
  assert.equal(view.nicknameEdit.string, '未提交草稿'); assert.equal(view.noticeLabel.string, '资料保存待重试');
  assert.equal(control._model.feedback, '资料保存待重试');
  await view.accountActionButton.emit('click'); await tick();
  assert.match(view.accountStatusLabel.string, /已取消/); assert.equal(control.busy, true);
  assert.equal(f.reads(), before); f.unchanged();
  f.complete(); await tick(); assert.notEqual(f.facade.snapshot().auth.status, 'active');
});

test('actual facade timeout/failure/retry/active/expiry/logout feedback reaches only the fixed account row', async () => {
  const f = await fixture(), { view } = f;
  await view.accountActionButton.emit('click'); [...f.deadlines.values()][0](); await tick();
  assert.match(view.accountStatusLabel.string, /登录超时/);
  await view.accountActionButton.emit('click'); f.attempts.at(-1).reject(Error('PRIVATE_PROOF_RAW_FAILURE')); await tick();
  assert.equal(view.accountStatusLabel.string, '本次登录未完成');
  await view.accountActionButton.emit('click'); f.complete(); await tick();
  assert.equal(view.accountStatusLabel.string, '已登录'); assert.equal(view.accountActionLabel.string, '退出');
  await view.accountActionButton.emit('click'); assert.match(view.accountStatusLabel.string, /游客/);
  await view.accountActionButton.emit('click'); f.complete(); await tick(); f.advance(2500); view.update(1);
  assert.equal(view.accountStatusLabel.string, '登录已过期'); assert.equal(view.accountActionLabel.string, '登录');
  f.unchanged();
});

test('pending login never blocks close; late completion, stale entries, generation and destruction cannot repaint the old view', async () => {
  for (const boundary of ['close', 'stale', 'generation', 'destroy']) {
    const f = await fixture(), { view, control } = f;
    await view.accountActionButton.emit('click'); assert.equal(control.busy, false);
    if (boundary === 'close') { await view.closeButton.emit('click'); assert.equal(control.isClosing, true); }
    if (boundary === 'stale') f.stale();
    if (boundary === 'generation') f.context.generation++;
    if (boundary === 'destroy') f.context.destroyed = true;
    const text = view.accountStatusLabel.string;
    f.complete(); await tick(); assert.equal(view.accountStatusLabel.string, text);
    f.unchanged();
    if (boundary === 'close') { view.update(2); assert.equal(view.isAvailable(), false); }
    f.facade.dispose(); assert.equal(f.facade.snapshot().feedback, 'unavailable');
  }
});

test('synthetic synchronous/rejected consumer ports neither leak errors nor produce unhandled login rejection', async () => {
  for (const failure of [() => { throw Error('RAW_SECRET'); }, () => Promise.reject(Error('RAW_SECRET'))]) {
    const f = await fixture(); f.account.requestLogin = failure;
    await f.view.accountActionButton.emit('click'); await tick();
    assert.doesNotMatch(f.view.accountStatusLabel.string, /RAW_SECRET/);
    assert.equal(f.control.busy, false); f.unchanged();
  }
});

test('a previous generation cannot dispatch a new login, cancellation or logout against the current entry', async () => {
  const f = await fixture(); let commands = 0;
  f.account.requestLogin = async () => { commands++; };
  f.account.cancel = () => { commands++; }; f.account.logout = () => { commands++; };
  f.context.generation++;
  for (const action of ['login', 'cancel', 'logout']) await f.view.event.emit('account-action', action);
  assert.equal(commands, 0); f.view.update(1);
  assert.match(f.view.accountStatusLabel.string, /登录暂不可用/); f.unchanged();
});

test('actual legacy v67 Prefab plus new source keeps offline Settings/profile saving/closing available and fails account actions closed', async () => {
  const f = await fixture(undefined, 'head'), { view, control } = f; let commands = 0;
  assert.equal(view.hasAccountBindings(), false);
  assert.equal(view.noticeLabel.string, '登录界面暂不可用，离线玩法可继续'); assert.equal(view.noticeLabel.node.active, true);
  f.account.requestLogin = async () => { commands++; }; f.account.cancel = () => { commands++; }; f.account.logout = () => { commands++; };
  f.account.snapshot = () => { throw Error('Missing account UI must not read the live account during refresh'); };
  for (const action of ['login', 'cancel', 'logout']) await view.event.emit('account-action', action);
  view.update(1); view.update(2); control.refreshAccount();
  assert.equal(commands, 0); assert.equal(f.acquires(), 0); assert.equal(f.exchanges(), 0);
  assert.deepEqual(f.warnings, [['SETTINGS_ACCOUNT_UI_UNAVAILABLE']]);
  const before = f.profile.snapshot();
  view.nicknameEdit.string = '旧资产兼容'; await view.nicknameEdit.node.emit('ended'); await tick();
  assert.equal(f.profile.snapshot().nickname, '旧资产兼容');
  assert.equal(f.profile.snapshot().playerId, before.playerId); assert.equal(f.profile.snapshot().registeredAt, before.registeredAt);
  assert.equal(view.noticeLabel.string, '登录界面暂不可用，离线玩法可继续');
  control._model.feedback = '资料保存待重试'; view.render(); view.update(1);
  assert.equal(view.noticeLabel.string, '资料保存待重试'); // Account fallback never overwrites profile feedback.
  await view.avatarButton.emit('click'); await tick(); assert.equal(f.profile.snapshot().avatar, 1);
  await view.closeButton.emit('click'); assert.equal(control.isClosing, true); assert.equal(view.isAvailable(), false);
});

test('actual current Owner Prefab plus new source retains the bound account row when the uncommitted asset is present', async t => {
  const graph = JSON.parse(readFileSync(new URL('../../assets/Colony/popups/settings/prefab/settings.prefab', import.meta.url), 'utf8'));
  if (!graph.some(value => value.accountStatusLabel && value.accountActionButton && value.accountActionLabel)) {
    t.skip('Owner account-row asset is deliberately excluded from the source checkpoint'); return;
  }
  const f = await fixture({ enabled: false }, 'owner'), { view } = f;
  assert.equal(view.hasAccountBindings(), true); assert.match(view.accountStatusLabel.string, /登录暂不可用/);
  assert.equal(view.accountActionButton.getComponent(f.Button).interactable, false); assert.deepEqual(f.warnings, []);
  view.nicknameEdit.string = '账号行旁的草稿'; view.update(1); assert.equal(view.nicknameEdit.string, '账号行旁的草稿'); f.unchanged();
});

test('each partial account binding stays disabled without replacing profile feedback', async () => {
  for (const property of ['accountStatusLabel', 'accountActionButton', 'accountActionLabel']) {
    const partial = await fixture(), value = partial.view[property]; partial.view[property] = null;
    let requests = 0; partial.account.requestLogin = async () => { requests++; };
    partial.control.refreshAccount(); await partial.view.event.emit('account-action', 'login');
    assert.equal(requests, 0); assert.match(partial.view.noticeLabel.string, /登录界面暂不可用/);
    if (partial.view.accountActionButton) assert.equal(partial.view.accountActionButton.getComponent(partial.Button).interactable, false);
    partial.view.renderAccount({ authStatus: 'active', feedback: 'active', canRequestLogin: false, localPlayAvailable: true });
    assert.match(partial.view.noticeLabel.string, /登录界面暂不可用/);
    partial.control._model.feedback = '资料保存待重试'; partial.view.render(); partial.view.update(1);
    assert.equal(partial.view.noticeLabel.string, '资料保存待重试');
    partial.view[property] = value;
  }
});
