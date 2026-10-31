import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const cache = new Map();
let openView;
const mk = { StaticViewBase: class {}, MVCViewBase: class {}, MVCControlBase: class { async close() {} },
  MVCModelBase: class { static async new() { return new this(); } },
  uiManage: { open: (...args) => openView(...args) } };
function load(relative) {
  const path = resolve(root, relative);
  if (cache.has(path)) return cache.get(path);
  const exports = {}; cache.set(path, exports);
  const compiled = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    experimentalDecorators: true, useDefineForClassFields: false } }).outputText;
  runInNewContext(compiled, { exports, require: specifier => {
    if (specifier === 'cc') return { Button: { EventType: { CLICK: 'click' } }, Label: class {}, Layers: { Enum: { UI_2D: 1 } }, _decorator: { ccclass: () => type => type, property: () => () => {} } };
    if (specifier === 'mk') return { default: mk };
    if (specifier.endsWith('/themePresentation')) return { refreshThemeCollection() {} };
    if (specifier.endsWith('/resultFailControl')) return { ResultFailControl: class {} };
    if (specifier.endsWith('/progressPresentation')) return { ProgressPresentation: { notifyPartnerUnlock() {} } };
    if (specifier.endsWith('/hardLevelNotice')) return { HardLevelNotice: class {} };
    const target = resolve(dirname(path), specifier + '.ts');
    if (specifier.startsWith('.') && existsSync(target) && !path.endsWith('playState.ts') && !path.endsWith('hudView.ts')) return load(target);
    if (specifier.endsWith('/gameModel') || specifier.endsWith('/gameplayFeedback')) return load(target);
    return {};
  } });
  return exports;
}
const { ColonyFlowModel } = load('assets/Colony/scripts/gameModel.ts');
function model(groups, cells) {
  return new ColonyFlowModel({ levels: [{ level: 1, sourceId: 'feedback', shape: 'NIGHT_MARKET', rows: 3, columns: 3, groups, cells }] });
}
const group = (id, pile, extra = {}) => ({ id, pile, depth: 0, color: 'white', count: 1, ...extra });
const white = count => Array.from({ length: count }, (_, i) => ({ id: `cell-${i}`, row: Math.floor(i / 3), column: i % 3, color: 'white' }));
const plain = value => JSON.parse(JSON.stringify(value));

test('linked rejection gives required slots without changing model or transient state', () => {
  const m = model([group('a', 0), group('b', 1), group('c', 2), group('d', 3),
    group('pair-a', 4, { linkId: 'pair' }), group('pair-b', 4, { depth: 1, linkId: 'pair' })], white(6));
  for (const id of ['a', 'b', 'c', 'd']) m.selectStack(id);
  const before = JSON.stringify([m.snapshot(), m.lastEventList(), m.usedToolList(), m.suggestedStack()]);
  assert.equal(m.feedback('pair-a').emptySlots, 1);
  assert.deepEqual(plain(m.feedback('pair-a').selection), { reason: 'slots', requiredSlots: 2 });
  assert.throws(() => m.selectStack('pair-a'), /Not enough/);
  assert.equal(JSON.stringify([m.snapshot(), m.lastEventList(), m.usedToolList(), m.suggestedStack()]), before);
});

test('transport colors only include slotted reachable unreserved cargo', () => {
  const m = model([group('w', 0, { count: 2 }), group('b', 1, { color: 'blue' })],
    [...white(2), { id: 'blue', row: 0, column: 2, color: 'blue' }]);
  assert.deepEqual(plain(m.feedback().transportColors), []);
  m.selectStack('w');
  assert.deepEqual(plain(m.feedback().transportColors), ['white']);
  const moves = [m.dispatchOne(), m.dispatchOne()];
  assert.deepEqual(plain(m.feedback().transportColors), []);
  assert.equal(m.feedback().pendingDeliveries, 2);
  for (const events of moves) m.completeTransport(events.find(event => event.phase === 'MOVE').cellId);
  assert.deepEqual(plain(m.feedback().transportColors), []);
});

test('hidden mystery and locked groups expose neither content nor hidden linked size', () => {
  const m = model([group('front', 0), group('secret', 0, { depth: 1, mystery: true, color: 'blue', count: 2 }),
    group('locked', 1, { lockId: 'key' }), group('key', 2)],
    [...white(3), { id: 'blue-a', row: 1, column: 0, color: 'blue' }, { id: 'blue-b', row: 1, column: 1, color: 'blue', keyId: 'key' }]);
  assert.equal(m.snapshot().stacks.find(s => s.id === 'secret').revealed, undefined);
  assert.deepEqual(plain(m.feedback('secret').selection), { reason: 'covered' });
  assert.deepEqual(plain(m.feedback('locked').selection), { reason: 'locked' });
  assert.doesNotMatch(JSON.stringify(m.feedback('secret')), /blue|count|secret/);
  assert.equal(m.feedback('front').selection.requiredSlots, 1);
});

test('terminal failure reports no transport and no legal queue selection', () => {
  const cells = white(9).map(cell => cell.id === 'cell-4' ? { ...cell, keyId: 'key' } : cell);
  const blocked = model([group('locked', 0, { count: 9, lockId: 'key' })], cells);
  assert.equal(blocked.snapshot().result, 'FAIL');
  assert.equal(blocked.feedback().failureReason, 'blocked');
  assert.equal(blocked.feedback('locked').selection.reason, 'finished');
});

test('actual PlayState rejection reaches actual HUD label and toast without gameplay mutation', async () => {
  const { PlayState } = load('assets/Colony/scripts/presentation/pageStates/playState.ts');
  const { ColonyHudView } = load('assets/Colony/scripts/views/hudView.ts');
  const hud = Object.create(ColonyHudView.prototype); hud.feedbackLabel = { string: '' };
  const m = model([group('head', 0), group('covered', 0, { depth: 1 })], white(2));
  const page = new PlayState(); const messages = []; let shakes = 0;
  page.context = { app: { error: null }, play: m, destroyed: false, inputLocked: false, hudView: hud, toast: { show: message => messages.push(message) } };
  page.board = { shakeStack: () => shakes++ };
  const before = JSON.stringify(m.snapshot());
  await page.tapStack('covered');
  assert.match(hud.feedbackLabel.string, /前方/); assert.match(messages[0], /前方/);
  assert.equal(shakes, 1); assert.equal(JSON.stringify(m.snapshot()), before);
});

test('hidden linked member stays private even when its whole group is selectable', () => {
  const m = model([group('front', 0, { linkId: 'pair' }),
    group('secret', 0, { depth: 1, linkId: 'pair', mystery: true })], white(2));
  assert.equal(m.snapshot().stacks.find(stack => stack.id === 'front').accessible, true);
  assert.equal(m.snapshot().stacks.find(stack => stack.id === 'secret').revealed, undefined);
  assert.deepEqual(plain(m.feedback('front').selection), { reason: null });
  assert.deepEqual(plain(m.feedback('secret').selection), { reason: null });
  assert.doesNotMatch(JSON.stringify(m.feedback('front')), /requiredSlots|count|stackId/);
});

test('extra slot changes only normal command state; full slots reject silently', async () => {
  const groups = [0, 1, 2, 3, 4].map(i => group(`g-${i}`, i));
  groups.push(group('last', 0, { depth: 1 }));
  const m = model(groups, white(6));
  for (let i = 0; i < 5; i++) m.selectStack(`g-${i}`);
  assert.deepEqual(plain(m.feedback('last').selection), { reason: 'slots', requiredSlots: 1 });
  const { PlayState } = load('assets/Colony/scripts/presentation/pageStates/playState.ts');
  const { ColonyHudView } = load('assets/Colony/scripts/views/hudView.ts');
  const page = new PlayState(); const hud = Object.create(ColonyHudView.prototype); hud.feedbackLabel = { string: 'existing status' };
  const toasts = []; let shakes = 0, selections = 0;
  const select = m.selectStack.bind(m); m.selectStack = (...args) => { selections++; return select(...args); };
  page.context = { play: m, destroyed: false, inputLocked: false, hudView: hud, toast: { show(message) { toasts.push(message); } } };
  page.board = { shakeStack() { shakes++; } };
  const before = JSON.stringify(m.snapshot()); await page.tapStack('last');
  assert.equal(hud.feedbackLabel.string, 'existing status'); assert.deepEqual(toasts, []);
  assert.equal(shakes, 1); assert.equal(selections, 0);
  assert.equal(JSON.stringify(m.snapshot()), before);
  m.useExtraSlot();
  assert.equal(m.feedback().totalSlots, 6); assert.equal(m.feedback().emptySlots, 1);
  assert.equal(m.feedback('last').selection.reason, null);
  assert.deepEqual(plain(m.usedToolList()), ['slot']);
});

test('actual successful linked tap keeps transport feedback without a success toast or extra commands', async () => {
  const groups = [group('first', 0, { linkId: 'pair' }), group('second', 1, { linkId: 'pair' })];
  const m = model(groups, white(2)); const control = model(groups, white(2)); control.selectStack('first');
  const { PlayState } = load('assets/Colony/scripts/presentation/pageStates/playState.ts');
  const { ColonyHudView } = load('assets/Colony/scripts/views/hudView.ts');
  const hud = Object.create(ColonyHudView.prototype); hud.feedbackLabel = { string: '' };
  const page = new PlayState(); const messages = [];
  page.context = { app: { error: null }, generation: 1, play: m, destroyed: false, inputLocked: false,
    hudView: hud, toast: { show: text => messages.push(text) } };
  page.board = { markMoving() {}, applySelection() {}, moveStackToSlot: async () => {}, pulseSlot: async () => {} };
  page.playSound = async () => {}; page.runTransportLoop = async () => {}; page.checkFreeFinish = () => {};
  await page.tapStack('first');
  assert.deepEqual(messages, [], 'Successful selection must not enqueue a success toast');
  assert.match(hud.feedbackLabel.string, /槽位 2\/5.*可运 白/);
  assert.equal(JSON.stringify(m.snapshot()), JSON.stringify(control.snapshot()));
  assert.equal(m.suggestedStack(), null); assert.deepEqual(plain(m.usedToolList()), []);
});

test('failure text distinguishes insufficient linked slots and blocked queue', () => {
  const { GameplayFeedbackText } = load('assets/Colony/scripts/presentation/gameplayFeedback.ts');
  const cells = white(9).map(cell => cell.id === 'cell-4' ? { ...cell, color: 'blue' } : cell);
  const groups = [group('white-1', 0, { count: 4 }), group('white-2', 1, { count: 4 }), group('blue', 2, { color: 'blue' })];
  const m = model(groups, cells); m.selectStack('blue');
  assert.deepEqual(plain(m.feedback().transportColors), [], 'sealed center cannot be advertised');
  const blocked = model([group('locked', 0, { count: 9, lockId: 'key' })], white(9).map(cell => cell.id === 'cell-4' ? { ...cell, keyId: 'key' } : cell));
  assert.match(GameplayFeedbackText.status(blocked.feedback()), /无可取数字组.*无可运输颜色/);
  assert.match(GameplayFeedbackText.status({ totalSlots: 5, emptySlots: 1, transportColors: [], pendingDeliveries: 0, failureReason: 'slots' }), /空槽不足/);
});

test('real full-slot failure and result HUD explain the actual stalled board', async () => {
  const cells = Array.from({ length: 25 }, (_, i) => ({ id: `cell-${i}`, row: Math.floor(i / 5), column: i % 5,
    color: i % 5 > 0 && i % 5 < 4 && Math.floor(i / 5) > 0 && Math.floor(i / 5) < 4 ? 'white' : 'blue' }));
  const groups = [1, 2, 2, 2, 2].map((count, i) => group(`white-${i}`, i, { count }));
  groups.push(group('edge', 0, { depth: 1, color: 'blue', count: 16 }));
  const m = new ColonyFlowModel({ levels: [{ level: 1, sourceId: 'feedback-full-failure', shape: 'NIGHT_MARKET',
    rows: 5, columns: 5, cells, groups }] });
  for (let i = 0; i < 5; i++) m.selectStack(`white-${i}`);
  assert.equal(m.snapshot().result, 'FAIL'); assert.equal(m.feedback().failureReason, 'slots');
  assert.deepEqual(plain(m.feedback().transportColors), []);
  const { PlayState } = load('assets/Colony/scripts/presentation/pageStates/playState.ts');
  const { ColonyHudView } = load('assets/Colony/scripts/views/hudView.ts');
  const hud = Object.create(ColonyHudView.prototype); hud.feedbackLabel = { string: '' };
  const page = new PlayState(); page.context = { app: { error: null }, generation: 1, play: m, hudView: hud,
    destroyed: false, round: null, popupRoot: {} };
  page.playSound = async () => {}; page.closeResultPopups = async () => {};
  const before = JSON.stringify(m.snapshot()); await page.showResult(false);
  assert.match(hud.feedbackLabel.string, /槽位 5\/5.*空槽不足.*无可运输颜色/);
  assert.equal(JSON.stringify(m.snapshot()), before);
});

function failedBoard(linked) {
  if (!linked) return model([group('locked', 0, { count: 9, lockId: 'key' })],
    white(9).map(cell => cell.id === 'cell-4' ? { ...cell, keyId: 'key' } : cell));
  const cells = Array.from({ length: 25 }, (_, i) => ({ id: `cell-${i}`, row: Math.floor(i / 5), column: i % 5,
    color: i % 5 > 0 && i % 5 < 4 && Math.floor(i / 5) > 0 && Math.floor(i / 5) < 4 ? 'white' : 'blue' }));
  const groups = [2, 2, 2, 3].map((count, i) => group(`w-${i}`, i, { count }));
  groups.push(group('pair-a', 4, { color: 'blue', count: 8, linkId: 'pair' }),
    group('pair-b', 4, { depth: 1, color: 'blue', count: 8, linkId: 'pair' }));
  const m = new ColonyFlowModel({ levels: [{ level: 1, sourceId: 'linked-stall', shape: 'NIGHT_MARKET', rows: 5, columns: 5, cells, groups }] });
  for (let i = 0; i < 4; i++) m.selectStack(`w-${i}`);
  assert.equal(m.snapshot().result, 'FAIL'); assert.equal(m.feedback().emptySlots, 1);
  return m;
}
function popupView(View, data) {
  const view = new View(); view.event = { on() {}, emit() {} }; view.node = { children: [], isValid: true, activeInHierarchy: true };
  const button = () => ({ node: { isValid: true, activeInHierarchy: true, targetOff() {}, on() {},
    getChildByName: () => ({ getComponent: () => ({ string: '' }) }) } });
  view.titleLabel = { string: '' }; view.detailLabel = { string: '' }; view.primaryLabel = { string: '' };
  view.primaryButton = button(); view.homeButton = button();
  view.init(data); view.open(); return view;
}

test('actual failure Control and View show non-full linked shortage and blocked queue accurately', async () => {
  const { ResultFailControl } = load('assets/Colony/popups/resultFail/script/resultFailControl.ts');
  const { GameplayFeedbackText } = load('assets/Colony/scripts/presentation/gameplayFeedback.ts');
  let opened;
  openView = async (View, { init }) => opened = popupView(View, init);
  for (const linked of [true, false]) {
    const m = failedBoard(linked);
    const message = GameplayFeedbackText.status(m.feedback());
    let retries = 0, homes = 0;
    const control = new ResultFailControl({ level: 1, transported: 0, hasNextLevel: false, failureMessage: message }, {},
      { onContinue: () => retries++, onHome: () => homes++ });
    await control.open();
    assert.equal(opened.detailLabel.string, message);
    assert.match(message, linked ? /槽位 4\/5.*空槽不足/ : /槽位 0\/5.*无可取数字组/);
    assert.doesNotMatch(opened.detailLabel.string, /所有暂存槽都已占用/);
    assert.equal(opened.primaryLabel.string, '免费重试');
    await control.onPrimary(); assert.equal(retries, 1);
    control.finishing = false; await control.onHome(); assert.equal(homes, 1);
  }
});

test('old failure popup seed remains usable without falsely declaring every slot full', async () => {
  const { ResultFailControl } = load('assets/Colony/popups/resultFail/script/resultFailControl.ts');
  let opened;
  openView = async (View, { init }) => opened = popupView(View, init);
  const control = new ResultFailControl({ level: 1, transported: 0, hasNextLevel: false }, {}, { onContinue() {}, onHome() {} });
  await control.open();
  assert.match(opened.detailLabel.string, /受阻/);
  assert.doesNotMatch(opened.detailLabel.string, /所有暂存槽都已占用/);
});

// User explicitly requested permanent removal of successful-selection slot-count toasts.
test('ordinary successful selection never calls the toast queue and keeps its slot animation', async () => {
  const m = model([group('ordinary', 0)], white(1));
  const { PlayState } = load('assets/Colony/scripts/presentation/pageStates/playState.ts');
  const page = new PlayState(); const messages = []; const animations = [];
  page.context = { app: { error: null }, generation: 1, play: m, destroyed: false, inputLocked: false,
    hudView: { setFeedback() {} }, toast: { show: (...args) => messages.push(args) } };
  page.board = { markMoving() {}, applySelection() {}, moveStackToSlot: async (id, index) => animations.push([id, index]), pulseSlot: async () => {} };
  page.playSound = async () => {}; page.runTransportLoop = async () => {}; page.checkFreeFinish = () => {};
  await page.tapStack('ordinary');
  assert.deepEqual(messages, []); assert.deepEqual(animations, [['ordinary', 0]]);
  assert.equal(m.snapshot().slots[0].stackId, 'ordinary');
});

test('locked selection still gives its actual failure reason and changes no gameplay state', async () => {
  const cells = white(2).map((cell, index) => index === 0 ? { ...cell, keyId: 'key' } : cell);
  const m = model([group('free', 0), group('locked', 1, { lockId: 'key' })], cells);
  const { PlayState } = load('assets/Colony/scripts/presentation/pageStates/playState.ts');
  const page = new PlayState(); const messages = [];
  page.context = { play: m, destroyed: false, inputLocked: false, hudView: { setFeedback() {} }, toast: { show: message => messages.push(message) } };
  page.board = { shakeStack() {} }; const before = JSON.stringify(m.snapshot());
  await page.tapStack('locked');
  assert.deepEqual(messages, ['\u8fd9\u7ec4\u5c1a\u672a\u89e3\u9501']);
  assert.equal(JSON.stringify(m.snapshot()), before);
});

test('slot rejection text is absent for both known and hidden group sizes', () => {
  const { GameplayFeedbackText } = load('assets/Colony/scripts/presentation/gameplayFeedback.ts');
  const feedback = { totalSlots: 5, emptySlots: 0, transportColors: [], pendingDeliveries: 0, failureReason: null };
  assert.equal(GameplayFeedbackText.selection({ ...feedback, selection: { reason: 'slots', requiredSlots: 1 } }), '');
  assert.equal(GameplayFeedbackText.selection({ ...feedback, selection: { reason: 'slots' } }), '');
});
