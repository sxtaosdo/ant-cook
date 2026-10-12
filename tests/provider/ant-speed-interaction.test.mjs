import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PlayerProgress, PROGRESS_SAVE_KEY } from '../../assets/Colony/scripts/application/playerProgress.ts';
import { RewardedAds } from '../../assets/Colony/scripts/application/rewardedAds.ts';
import { AD_BOOST_MS, FREE_BOOST_MS } from '../../assets/Colony/scripts/application/speedBoost.ts';
import { leaderboardTestConfig, socialTestConfig } from '../ant/support/leaderboardTestConfig.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));

// Actual View/Control/Presenter, reward receipt and memory persistence; Cocos/MK and video are doubles.
async function fixture(available = true) {
  class Events {
    handlers = new Map();
    on(key, fn, owner) { const rows = this.handlers.get(key) ?? []; rows.push({ fn, owner }); this.handlers.set(key, rows); }
    off(key) { this.handlers.delete(key); }
    targetOff(owner) { for (const [key, rows] of this.handlers) this.handlers.set(key, rows.filter(row => row.owner !== owner)); }
    emit(key, ...args) { return Promise.all((this.handlers.get(key) ?? []).map(row => row.fn.call(row.owner, ...args))); }
  }
  class Button { static EventType = { CLICK: 'click' }; interactable = true; }
  class Node extends Events {
    static EventType = { TOUCH_START: 'start', TOUCH_MOVE: 'move' };
    isValid = true; active = true; button = new Button();
    get activeInHierarchy() { return this.active; }
    getComponent() { return this.button; }
    async click() {
      if (!this.activeInHierarchy || !this.button.interactable) return;
      await this.emit('start'); await this.emit('click');
    }
  }
  class View { valid = true; event = new Events(); }
  class Model { static async new() { return new this(); } }
  class Control {
    isClosing = false;
    async close() { this.isClosing = true; this._view.event.targetOff(this); this._view.close(); }
  }
  const cc = { Node, Button, Color: class {}, Label: class {}, _decorator: {
    ccclass: () => Class => Class, property: (_target, key) => typeof key === 'string' ? undefined : () => {},
  } };
  const wire = view => {
    view.node = new Node();
    for (const key of ['titleLabel', 'summaryLabel', 'durationLabel', 'remainingLabel', 'offerDetailLabel', 'actionLabel', 'feedbackLabel']) {
      view[key] = { string: '', node: new Node() };
    }
    view.actionButton = new Node(); view.dismissButton = new Node();
  };
  const mk = { MVCViewBase: View, MVCModelBase: Model, MVCControlBase: Control,
    uiManage: { async open(Type, { init }) { const view = new Type(); wire(view); view.init(init); view.open(); return view; } } };
  const classes = {
    settingsView: { ColonySettingsView: class {} }, progressView: { ColonyProgressView: class {} },
    toolControl: { ToolControl: class {} }, communityControl: { CommunityControl: class {} },
    colonyUtil: { ColonyUtil: { applyUiLayer() {} } },
    resultPopupNav: { swallowMkInterrupt: promise => promise },
    playState: { PlayState: { current: () => null } }, speedBoost: { AD_BOOST_MS, FREE_BOOST_MS },
  };
  const load = name => {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../../' + name, import.meta.url), 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, useDefineForClassFields: false,
    } }).outputText, { exports, require: key => key === 'cc' ? cc : key === 'mk' ? { default: mk } : classes[key.split('/').at(-1)] ?? {} });
    return exports;
  };
  classes.popupView = load('assets/Colony/popups/progress/script/popupView.ts');
  classes.speedView = load('assets/Colony/popups/speed/script/speedView.ts');
  classes.progressModel = load('assets/Colony/popups/progress/script/progressModel.ts');
  classes.progressControl = load('assets/Colony/popups/progress/script/progressControl.ts');
  const { ProgressPresentation } = load('assets/Colony/scripts/presentation/progressPresentation.ts');
  const stored = new Map(); let fail = false, shows = 0, closeVideo, errorVideo, closed = 0, actions = 0;
  const progress = new PlayerProgress({ read: key => stored.get(key) ?? null, write(key, value) {
    if (fail && key === PROGRESS_SAVE_KEY) throw Error('isolated save failure'); stored.set(key, value);
  } }, { now: () => Date.parse('2026-10-12T12:00:00+08:00') }, leaderboardTestConfig, socialTestConfig);
  for (let n = 0; n < FREE_BOOST_MS / 1000; n++) progress.reserveSpeedBoost(1000);
  const video = { load: async () => {}, show: async () => { shows++; }, onClose: callback => { closeVideo = callback; },
    offClose() {}, onError: callback => { errorVideo = callback; }, offError() {}, destroy() {} };
  const ads = new RewardedAds(available ? { createRewardedVideoAd: () => video } : null,
    available ? { speed: 'isolated-interaction' } : {}, () => 'round');
  const context = { generation: 1, destroyed: false, progress, ads, popupRoot: new Node(), round: { id: 'round' },
    inputLocked: true, toast: { show() {} } };
  const presentation = new ProgressPresentation(context, 'speed', () => { closed++; });
  const act = presentation.act.bind(presentation);
  presentation.act = action => { actions++; return act(action); };
  const control = presentation.control = presentation.createControl(); context.progressPopup = control;
  await control.open();
  return { control, view: control._view, context, progress, ads, stored,
    fail: value => { fail = value; }, shows: () => shows, closed: () => closed, actions: () => actions,
    end: complete => closeVideo({ isEnded: complete }), error: () => errorVideo(Error('isolated video failure')) };
}

test('speed controls visibly block duplicate video and dismiss touches throughout the pending operation', async () => {
  const f = await fixture();
  await f.view.actionButton.click(); await tick();
  assert.equal(f.shows(), 1); assert.equal(f.control.busy, true);
  assert.equal(f.view.actionButton.button.interactable, false);
  assert.equal(f.view.dismissButton.button.interactable, false);
  assert.equal(f.view.actionLabel.string, '处理中');
  await f.view.actionButton.click(); await f.view.dismissButton.click(); await tick();
  assert.equal(f.actions(), 1); assert.equal(f.context.progressPopup, f.control);
  f.end(false); await tick();
  assert.equal(f.control.busy, false); assert.equal(f.view.actionButton.button.interactable, true);
  assert.equal(f.view.dismissButton.button.interactable, true); assert.equal(f.view.actionLabel.string, '观看视频');
  assert.equal(f.progress.readSpeedBoost().remainingMs, 0);
});

test('actual save-failure UI keeps the receipt, refuses dismiss, then retries without another video or duplicate credit', async () => {
  const f = await fixture(); await f.view.actionButton.click(); await tick();
  f.fail(true); f.end(true); await tick();
  const receipt = f.ads.pendingRequestKey('speed'); assert.ok(receipt);
  assert.equal(f.view.actionButton.button.interactable, true); assert.equal(f.view.actionLabel.string, '重试领取');
  assert.match(f.view.feedbackLabel.string, /奖励待保存/); assert.equal(f.progress.readSpeedBoost().remainingMs, 0);
  await f.view.dismissButton.click(); await tick();
  assert.equal(f.control.isClosing, false); assert.equal(f.ads.pendingRequestKey('speed'), receipt);
  f.fail(false); await f.view.actionButton.click(); await tick();
  assert.equal(f.shows(), 1); assert.equal(f.progress.readSpeedBoost().remainingMs, AD_BOOST_MS);
  assert.equal(f.progress.snapshot().daily.boostAds, 1); assert.equal(f.ads.hasPendingReward(), false);
  assert.equal(f.context.progressPopup, null); assert.equal(f.context.inputLocked, false); assert.equal(f.closed(), 1);
  assert.equal(f.progress.grantSpeedBoostReward(receipt), false);
});

test('a failed video restores the existing offer and usable dismiss action without granting time', async () => {
  const f = await fixture(); await f.view.actionButton.click(); await tick(); f.error(); await tick();
  assert.equal(f.control.busy, false); assert.equal(f.view.actionLabel.string, '观看视频');
  assert.equal(f.view.actionButton.button.interactable, true); assert.equal(f.view.dismissButton.button.interactable, true);
  assert.equal(f.progress.readSpeedBoost().remainingMs, 0); await f.view.dismissButton.click(); await tick();
  assert.equal(f.control.isClosing, true); assert.equal(f.context.progressPopup, null);
});

test('unavailable video remains disabled while the normal dismiss path stays usable', async () => {
  const f = await fixture(false); assert.equal(f.view.actionButton.button.interactable, false);
  assert.equal(f.view.actionLabel.string, '视频暂不可用'); await f.view.actionButton.click(); await tick();
  assert.equal(f.actions(), 0); assert.equal(f.shows(), 0); assert.equal(f.control.busy, false);
  await f.view.dismissButton.click(); await tick(); assert.equal(f.control.isClosing, true);
});

test('forced close and reuse reset the local pending state; late completion cannot repaint the reopened view', async () => {
  const f = await fixture(); await f.view.actionButton.click(); await tick(); await f.control.forceClose();
  const page = { ...f.control._model.page, title: 'Reopened', rows: [{ ...f.control._model.page.rows[0], button: 'Next offer' }] };
  f.view.init({ page, feedback: 'New view' }); f.view.open();
  assert.equal(f.view.actionButton.button.interactable, true); assert.equal(f.view.dismissButton.button.interactable, true);
  assert.equal(f.view.actionLabel.string, 'Next offer'); f.end(true); await tick();
  assert.equal(f.progress.readSpeedBoost().remainingMs, AD_BOOST_MS);
  assert.equal(f.view.titleLabel.string, 'Reopened'); assert.equal(f.view.actionLabel.string, 'Next offer');
  assert.equal(f.view.feedbackLabel.string, 'New view'); assert.equal(f.context.progressPopup, null);
});
