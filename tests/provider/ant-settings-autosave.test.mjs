import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PlayerProfile } from '../../assets/Colony/scripts/application/playerProfile.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

// Actual popup/view/controller and profile persistence; cc/MVC resource lifecycle is a double.
// Native EditBox focus and Creator UI geometry remain a separate Preview acceptance gate.
function fixture() {
  class Events {
    handlers = new Map();
    on(key, fn, owner) { const list = this.handlers.get(key) ?? []; list.push({ fn, owner }); this.handlers.set(key, list); }
    off(key) { this.handlers.delete(key); }
    targetOff(owner) { for (const [key, list] of this.handlers) this.handlers.set(key, list.filter(entry => entry.owner !== owner)); }
    emit(key, ...args) { return Promise.all((this.handlers.get(key) ?? []).map(entry => entry.fn.call(entry.owner, ...args))); }
  }
  class Button { static EventType = { CLICK: 'click' }; }
  class EditBox { static EventType = { EDITING_DID_ENDED: 'ended', EDITING_RETURN: 'return', TEXT_CHANGED: 'changed' }; }
  class Node extends Events {
    static EventType = { TOUCH_START: 'start', TOUCH_MOVE: 'move' };
    isValid = true; active = true; components = new Map();
    get activeInHierarchy() { return this.active; }
    getComponent(Type) { if (!this.components.has(Type)) this.components.set(Type, new Type()); return this.components.get(Type); }
  }
  class Color { constructor(value) { this.value = value; } }
  class View { valid = true; event = new Events(); }
  class Model { static async new() { return new this(); } }
  class Control {
    isClosing = false;
    async close() { this.isClosing = true; this._view.event.targetOff(this); this._view.close(); }
  }
  const cc = { Node, Button, EditBox, Color, Label: class {}, Layout: class {}, Sprite: class {}, SpriteFrame: class {},
    _decorator: { ccclass: () => Class => Class, property: (_target, key) => typeof key === 'string' ? undefined : () => {} } };
  const classes = {}, cache = new Map();
  const load = (path, mocks = {}) => {
    if (cache.has(path)) return cache.get(path);
    const exports = {};
    const source = readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, experimentalDecorators: true, useDefineForClassFields: false } }).outputText,
    { exports, require: name => name === 'cc' ? cc : name === 'mk' ? { default: mk }
      : mocks[name] ?? classes[name.split('/').at(-1)] ?? {} });
    cache.set(path, exports); return exports;
  };
  const colors = ['#111111', '#222222', '#333333'];
  const stored = new Map(), calls = [], gates = [];
  let failure = false, writes = 0, closed = 0, delayed = false;
  const profile = new PlayerProfile({ read: key => stored.get(key) ?? null, write(key, value) {
    if (failure) throw Error('disk full'); stored.set(key, value); writes++;
  } }, colors.length, () => 'local-' + 'c'.repeat(32), () => 1000, false);
  const page = () => ({ title: '', summary: '', rows: [], layout: 'settings', settings: {
    inRound: false, soundEnabled: true, musicEnabled: true, version: 'fixture', userId: profile.snapshot().playerId,
    profile: { ...profile.snapshot(), avatarColor: colors[profile.snapshot().avatar], avatarColors: colors },
  } });
  const wire = view => {
    view.node = new Node();
    for (const key of ['settingsRoot', 'musicButton', 'soundButton', 'homeButton', 'restartButton', 'feedbackButton',
      'agreementButton', 'privacyButton', 'closeButton', 'productNavigationButton', 'avatarButton']) view[key] = new Node();
    for (const key of ['musicIcon', 'soundIcon', 'versionLabel', 'userIdLabel', 'noticeLabel', 'profileAvatar', 'profileInitial', 'registeredLabel']) view[key] = { node: new Node(), string: '' };
    view.nicknameEdit = { node: new Node(), string: '' };
    view.controlsLayout = { updateLayout() {} };
    for (const key of ['musicOnFrame', 'musicOffFrame', 'soundOnFrame', 'soundOffFrame']) view[key] = {};
  };
  const mk = { MVCViewBase: View, MVCModelBase: Model, MVCControlBase: Control,
    uiManage: { async open(Type, { init }) { const view = new Type(); wire(view); view.init(init); view.open(); return view; } } };
  classes.popupView = load('assets/Colony/popups/progress/script/popupView.ts');
  classes.settingsView = load('assets/Colony/popups/settings/script/settingsView.ts', {
    '../../../scripts/application/playerProfile': { PlayerProfile },
  });
  classes.progressModel = load('assets/Colony/popups/progress/script/progressModel.ts');
  classes.colonyUtil = { ColonyUtil: { applyUiLayer() {} } };
  classes.resultPopupNav = { swallowMkInterrupt: promise => promise };
  classes.progressControl = load('assets/Colony/popups/progress/script/progressControl.ts');
  const { ProgressControl } = classes.progressControl;
  const control = new ProgressControl(new Node(), { read: page, async act(action) {
    calls.push(action);
    if (delayed) { const gate = deferred(); gates.push(gate); await gate.promise; }
    const edit = JSON.parse(decodeURIComponent(action.split(':')[1]));
    profile.save(edit.nickname, edit.avatar); return '';
  }, closed() { closed++; } }, classes.settingsView.ColonySettingsView);
  return { control, profile, calls, gates, stored, EditBox, Button, page,
    async actualPresentation(pendingReward = false) {
      classes.toolControl = { ToolControl: class {} };
      classes.communityControl = { CommunityControl: class {} };
      classes.playState = { PlayState: { current: () => null } };
      classes.buildInfo = { COLONY_BUILD_VERSION: 'fixture' };
      const { ProgressPresentation } = load('assets/Colony/scripts/presentation/progressPresentation.ts');
      const toasts = [], refreshed = [];
      const context = { popupRoot: new Node(), generation: 1, destroyed: false, profile,
        progress: { snapshot: () => ({ coins: 0, diamonds: 0, clearedLevels: [], streak: 0 }), availability: () => ({}) },
        leaderboardConfig: { avatarColors: colors }, settings: { snapshot: () => ({ soundEnabled: true, musicEnabled: true }) },
        ads: { hasPendingReward: () => pendingReward }, toast: { show: (...args) => toasts.push(args) },
        refreshProfile() { refreshed.push(profile.snapshot()); },
      };
      const presentation = new ProgressPresentation(context, 'settings');
      const actual = presentation.control = presentation.createControl(); context.progressPopup = actual;
      await actual.open();
      return { view: actual._view, control: actual, context, toasts, refreshed };
    },
    start: async () => { await control.open(); return control._view; },
    fail(value) { failure = value; }, delay(value) { delayed = value; }, writes: () => writes, closed: () => closed };
}

test('editing end/return autosave once, no per-character write, avatar changes save immediately and reopen detaches listeners', async () => {
  const f = fixture(), view = await f.start(), initial = f.writes();
  view.nicknameEdit.string = '  新昵称  ';
  await view.nicknameEdit.node.emit('changed'); assert.equal(f.writes(), initial);
  await view.nicknameEdit.node.emit('return'); await view.nicknameEdit.node.emit('ended'); await tick();
  assert.equal(f.calls.length, 1); assert.equal(f.writes(), initial + 1); assert.equal(f.profile.snapshot().nickname, '新昵称');
  assert.equal(view.nicknameEdit.string, '新昵称');
  await view.avatarButton.emit('click'); await tick(); assert.equal(f.profile.snapshot().avatar, 1);
  view.close(); await view.nicknameEdit.node.emit('ended'); assert.equal(f.calls.length, 2);
  view.open(); view.open(); view.nicknameEdit.string = '重新打开';
  view.event.on('action', f.control.act, f.control);
  await view.nicknameEdit.node.emit('ended'); await tick(); assert.equal(f.calls.length, 3);
  assert.equal(view.userIdLabel.string, `ID：${PlayerProfile.displayId(f.profile.snapshot().playerId)}`);
});

test('queued final save failure leaves the latest draft open, then close retries only that draft', async () => {
  const f = fixture(), view = await f.start(); f.delay(true);
  view.nicknameEdit.string = '第一次'; await view.nicknameEdit.node.emit('ended');
  view.nicknameEdit.string = '最后草稿'; await view.closeButton.emit('click');
  f.gates[0].resolve(); await tick(); f.fail(true); f.gates[1].resolve(); await tick();
  assert.equal(f.profile.snapshot().nickname, '第一次'); assert.equal(view.nicknameEdit.string, '最后草稿');
  assert.equal(f.closed(), 0); assert.equal(view.isAvailable(), true);
  f.fail(false); f.delay(false); await view.closeButton.emit('click'); await tick();
  assert.equal(f.profile.snapshot().nickname, '最后草稿'); assert.equal(f.closed(), 1); assert.equal(f.calls.length, 3);
});

test('suspend and destruction release the stable EditBox node after its component reference is cleared', async () => {
  const f = fixture(), view = await f.start(), node = view.nicknameEdit.node;
  view.nicknameEdit.node = null; view.suspend();
  assert.equal([...node.handlers.values()].flat().length, 0);
  view.onDestroy(); await node.emit('ended'); assert.equal(f.calls.length, 0);
});

test('failed autosave retains the draft/avatar, keeps close pending and allows the same draft retry', async () => {
  const f = fixture(), view = await f.start(), before = f.profile.snapshot();
  f.fail(true); view.nicknameEdit.string = '保留草稿';
  await view.avatarButton.emit('click'); await tick();
  assert.deepEqual(f.profile.snapshot(), before); assert.equal(view.nicknameEdit.string, '保留草稿');
  assert.equal(view.profileAvatar.color.value, '#222222'); assert.match(view.noticeLabel.string, /disk full/);
  await view.closeButton.emit('click'); await tick(); assert.equal(f.closed(), 0); assert.equal(view.isAvailable(), true);
  f.fail(false); await view.closeButton.emit('click'); await tick();
  assert.equal(f.profile.snapshot().nickname, '保留草稿'); assert.equal(f.profile.snapshot().avatar, 1); assert.equal(f.closed(), 1);
});

test('an older completed save cannot overwrite a later unsubmitted edit', async () => {
  const f = fixture(), view = await f.start(); f.delay(true);
  view.nicknameEdit.string = '先提交'; await view.nicknameEdit.node.emit('ended');
  view.nicknameEdit.string = '继续输入'; f.gates[0].resolve(); await tick();
  assert.equal(f.profile.snapshot().nickname, '先提交'); assert.equal(view.nicknameEdit.string, '继续输入');
  await view.nicknameEdit.node.emit('ended'); f.gates[1].resolve(); await tick();
  assert.equal(f.profile.snapshot().nickname, '继续输入');
});

test('rapid avatar edits serialize only the latest pending draft and closing waits for that save', async () => {
  const f = fixture(), view = await f.start(); f.delay(true);
  await view.avatarButton.emit('click'); await view.avatarButton.emit('click'); await view.avatarButton.emit('click');
  await view.closeButton.emit('click'); assert.equal(f.calls.length, 1); assert.equal(f.closed(), 0);
  f.gates[0].resolve(); await tick(); assert.equal(f.calls.length, 2); assert.equal(f.closed(), 0);
  f.gates[1].resolve(); await tick(); assert.equal(f.profile.snapshot().avatar, 0); assert.equal(f.closed(), 1);
  assert.equal(f.writes(), 3);
});

test('returning to the in-flight draft cancels an obsolete queued edit without an extra disk write', async () => {
  const f = fixture(), view = await f.start(); f.delay(true);
  view.nicknameEdit.string = '甲'; await view.nicknameEdit.node.emit('ended');
  view.nicknameEdit.string = '乙'; await view.nicknameEdit.node.emit('ended');
  view.nicknameEdit.string = '甲'; await view.nicknameEdit.node.emit('ended');
  f.gates[0].resolve(); await tick(); assert.equal(f.calls.length, 1); assert.equal(f.profile.snapshot().nickname, '甲');
});

test('return to the original avatar survives a failed final queued save and closing retries that avatar', async () => {
  const f = fixture(), view = await f.start(); f.delay(true);
  await view.avatarButton.emit('click'); await view.avatarButton.emit('click'); await view.avatarButton.emit('click');
  await view.closeButton.emit('click'); f.gates[0].resolve(); await tick();
  assert.equal(view.profileAvatar.color.value, '#111111');
  f.fail(true); f.gates[1].resolve(); await tick();
  assert.equal(f.profile.snapshot().avatar, 1); assert.equal(view.profileAvatar.color.value, '#111111');
  assert.equal(f.closed(), 0);
  f.fail(false); f.delay(false); await view.closeButton.emit('click'); await tick();
  assert.equal(f.profile.snapshot().avatar, 0); assert.equal(f.closed(), 1);
});

test('returning to the original nickname without submitting survives an older save completion', async () => {
  const f = fixture(), view = await f.start(), original = f.profile.snapshot().nickname; f.delay(true);
  view.nicknameEdit.string = '提交的新名字'; await view.nicknameEdit.node.emit('ended');
  view.nicknameEdit.string = original; f.gates[0].resolve(); await tick();
  assert.equal(f.profile.snapshot().nickname, '提交的新名字'); assert.equal(view.nicknameEdit.string, original);
  f.delay(false); await view.closeButton.emit('click'); await tick();
  assert.equal(f.profile.snapshot().nickname, original); assert.equal(f.closed(), 1);
});

test('actual presentation reports failed persistence as a Toast, retains the draft and refreshes only after retry saves', async () => {
  const f = fixture(), actual = await f.actualPresentation(), { view } = actual;
  const before = f.profile.snapshot(); f.fail(true); view.nicknameEdit.string = '实际失败';
  await view.nicknameEdit.node.emit('ended'); await tick();
  assert.deepEqual(f.profile.snapshot(), before); assert.equal(actual.refreshed.length, 0);
  assert.equal(view.nicknameEdit.string, '实际失败'); assert.match(actual.toasts[0][0], /资料保存未完成.*disk full/);
  assert.equal(actual.toasts[0][1], 'profile-save-failed');
  f.fail(false); await view.nicknameEdit.node.emit('return'); await tick();
  assert.equal(f.profile.snapshot().nickname, '实际失败'); assert.equal(actual.refreshed.length, 1);
  assert.equal(actual.toasts.at(-1)[0], '资料已保存');
});

test('actual presentation pending reward is a failed profile submission so closing cannot discard the draft', async () => {
  const f = fixture(), actual = await f.actualPresentation(true), { view } = actual, initialWrites = f.writes();
  view.nicknameEdit.string = '奖励期间的草稿'; await view.closeButton.emit('click'); await tick();
  assert.equal(f.writes(), initialWrites); assert.equal(view.nicknameEdit.string, '奖励期间的草稿');
  assert.equal(actual.control.isClosing, false); assert.equal(view.isAvailable(), true);
  assert.match(actual.toasts[0][0], /奖励待保存/); assert.equal(actual.toasts[0][1], 'profile-save-failed');
});
