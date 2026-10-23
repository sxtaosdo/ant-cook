import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ColonyFlowModel } from '../../assets/Colony/scripts/gameModel.ts';

function fixture() {
  class Vec3 {
    static ZERO = new Vec3(); static ONE = new Vec3(1, 1, 1);
    constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
    static distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
  }
  class Color { static WHITE = new Color('white'); constructor(value) { this.value = value; } static fromHEX(color, hex) { color.value = hex; return color; } }
  class Button { static EventType = { CLICK: 'click' }; static Transition = { NONE: 0, SCALE: 1 }; interactable = true; }
  class Label { static Overflow = { SHRINK: 0 }; static HorizontalAlign = { CENTER: 0 }; static VerticalAlign = { CENTER: 0 }; }
  class Sprite { static SizeMode = { CUSTOM: 0 }; }
  class UIOpacity {}
  class UITransform { setContentSize() {} setAnchorPoint() {} }
  class Node {
    static EventType = { TOUCH_START: 'start', TOUCH_MOVE: 'move', TOUCH_END: 'end', TOUCH_CANCEL: 'cancel' };
    children = []; components = new Map(); handlers = new Map(); position = new Vec3(); scale = Vec3.ONE; active = true; isValid = true;
    constructor(name) { this.name = name; }
    setParent(parent) { this.parent = parent; parent.children.push(this); }
    getChildByName(name) { return this.children.find(child => child.name === name); }
    setPosition(x, y, z = 0) { this.position = typeof x === 'object' ? x : new Vec3(x, y, z); }
    setScale(value) { this.scale = value; } setSiblingIndex() {}
    getComponent(Type) { return this.components.get(Type) ?? null; }
    addComponent(Type) { const value = new Type(); value.node = this; this.components.set(Type, value); return value; }
    targetOff(owner) { for (const [event, handlers] of this.handlers) this.handlers.set(event, handlers.filter(item => item.owner !== owner)); }
    on(event, action, owner) { const handlers = this.handlers.get(event) ?? []; handlers.push({ action, owner }); this.handlers.set(event, handlers); }
    emit(event, value) { for (const handler of this.handlers.get(event) ?? []) handler.action.call(handler.owner, value); }
  }
  const cc = { Vec3, Color, Button, Label, Sprite, Node, UITransform, UIOpacity,
    Layers: { Enum: { UI_2D: 1 } }, Tween: { stopAllByTarget() {} },
    _decorator: { ccclass: () => Type => Type, property: () => () => {} } };
  const mk = { default: { StaticViewBase: class {}, ObjectPool: { Sync: class { constructor(config) { this.config = config; } get() { return this.config.createFunc(); } } } } };
  function actual(path, modules = {}) {
    const source = readFileSync(new URL(`../../assets/Colony/scripts/${path}.ts`, import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, experimentalDecorators: true, useDefineForClassFields: false } }).outputText;
    const exports = {};
    runInNewContext(compiled, { exports, require: name => name === 'cc' ? cc : name === 'mk' ? mk : modules[name] ?? {} });
    return exports;
  }
  const feedback = actual('presentation/gameplayFeedback');
  const { PlayState } = actual('presentation/pageStates/playState', {
    '../hardLevelNotice': { HardLevelNotice: class {} }, '../gameplayFeedback': feedback,
  });
  const { ColonyHudView } = actual('views/hudView');
  const { BoardPresentation } = actual('presentation/boardPresentation', {
    './nodeFactory': actual('presentation/nodeFactory'), './boardGeometry': actual('presentation/boardGeometry'),
    './colonyColors': actual('presentation/colonyColors'),
  });
  const group = (id, pile, extra = {}) => ({ id, pile, depth: 0, color: 'white', count: 1, ...extra });
  const model = new ColonyFlowModel({ levels: [{ level: 1, sourceId: 'normal-board-button-feedback', shape: 'NIGHT_MARKET', rows: 2, columns: 3,
    groups: [group('head', 0), group('secret', 0, { depth: 1, mystery: true, color: 'blue', count: 2 }), group('locked', 1, { lockId: 'key' }), group('open', 2)],
    cells: [{ id: 'w1', row: 0, column: 0, color: 'white' }, { id: 'w2', row: 0, column: 1, color: 'white' },
      { id: 'w3', row: 0, column: 2, color: 'white' }, { id: 'b1', row: 1, column: 0, color: 'blue', keyId: 'key' }, { id: 'b2', row: 1, column: 1, color: 'blue' }],
  }] });
  const hud = new ColonyHudView(); hud.feedbackLabel = { string: '' };
  const page = new PlayState(), toasts = [], shakes = [], commands = []; let pending;
  const read = () => ({ snapshot: model.snapshot() });
  const stackRoot = new Node('stack-root');
  const board = new BoardPresentation(new Node('board'), new Node('slots'), [], {}, {}, stackRoot,
    id => { commands.push(id); pending = page.tapStack(id); });
  page.context = { app: { error: null }, play: model, destroyed: false, inputLocked: false, generation: 1,
    hudView: hud, toast: { show: message => toasts.push(message) } };
  page.board = board;
  // Movement and audio are engine boundaries; button binding and command/refusal handling remain real.
  board.applySelection = () => {}; board.moveStackToSlot = async () => {}; board.pulseSlot = async () => {};
  page.playSound = async () => {}; page.runTransportLoop = async () => {}; page.checkFreeFinish = () => {};
  board.shakeStack = id => shakes.push(id);
  board.createStacks(read());
  const click = async id => {
    pending = null;
    const node = board.stackNodes.get(id); assert.ok(node?.active);
    assert.equal(node.getComponent(Button).interactable, true);
    node.emit(Button.EventType.CLICK); await pending;
  };
  return { board, model, page, hud, toasts, shakes, commands, click, stackRoot, Node, Label, read };
}

test('actual BoardPresentation and NodeFactory button click routes locked rejection to actual HUD and toast', async () => {
  const f = fixture(), before = JSON.stringify(f.model.snapshot());
  await f.click('locked');
  assert.deepEqual(f.commands, ['locked']); assert.match(f.hud.feedbackLabel.string, /尚未解锁/);
  assert.match(f.toasts[0], /尚未解锁/); assert.deepEqual(f.shakes, ['locked']);
  assert.equal(JSON.stringify(f.model.snapshot()), before);
});

test('actual covered mystery button preserves question mark and never discloses contents', async () => {
  const f = fixture(), before = JSON.stringify(f.model.snapshot());
  const label = f.board.stackNodes.get('secret').getChildByName('StackCountLabel').getComponent(f.Label);
  assert.equal(label.string, '?');
  await f.click('secret');
  assert.deepEqual(f.commands, ['secret']); assert.match(f.hud.feedbackLabel.string, /前方/);
  assert.doesNotMatch(f.hud.feedbackLabel.string, /blue|蓝|2|secret/); assert.equal(label.string, '?');
  assert.equal(JSON.stringify(f.model.snapshot()), before);
});

test('real bound callback keeps drag suppression and moving protections before dispatching', async () => {
  const f = fixture(), before = JSON.stringify(f.model.snapshot());
  f.stackRoot.emit(f.Node.EventType.TOUCH_START, { getUILocation: () => ({ y: 10 }) });
  f.stackRoot.emit(f.Node.EventType.TOUCH_MOVE, { getUILocation: () => ({ y: 20 }) });
  f.stackRoot.emit(f.Node.EventType.TOUCH_END);
  await f.click('locked'); assert.deepEqual(f.commands, []); assert.equal(f.toasts.length, 0);
  f.board.suppressQueueClickUntil = 0;
  f.board.markMoving('head', true); await f.click('head');
  assert.deepEqual(f.commands, []); assert.equal(f.hud.feedbackLabel.string, '');
  assert.equal(JSON.stringify(f.model.snapshot()), before);
});

test('actual accessible button still selects exactly once after the feedback routing change', async () => {
  const f = fixture();
  f.board.applySelection = () => {}; f.board.moveStackToSlot = async () => {}; f.board.pulseSlot = async () => {};
  f.page.playSound = async () => {}; f.page.runTransportLoop = async () => {}; f.page.checkFreeFinish = () => {};
  await f.click('head');
  assert.deepEqual(f.commands, ['head']); assert.equal(f.model.snapshot().stacks.find(s => s.id === 'head').selected, true);
  assert.match(f.toasts[0], /本次占 1 槽/); assert.match(f.hud.feedbackLabel.string, /槽位 1\/5/);
});
