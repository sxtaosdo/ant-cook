import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { ColonyFlowModel } from '../../assets/Colony/scripts/gameModel.ts';
import { createOperationalCatalog } from '../../assets/Colony/scripts/application/operationalLevels.ts';

// Actual gameplay, exit/worker methods, transport, factory and Sync pool run here.
// cc nodes/tweens and page IO are doubles; this does not measure engine destruction or FPS.
const catalog = createOperationalCatalog(), tick = () => new Promise(resolve => setImmediate(resolve));
const compiled = new Map();
function real(path, modules) {
  if (!compiled.has(path)) compiled.set(path, ts.transpileModule(readFileSync(new URL('../../' + path, import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText);
  const exports = {};
  vm.runInNewContext(compiled.get(path), { exports, require: name => {
    assert.ok(name in modules, `Unexpected dependency: ${name}`); return modules[name];
  } });
  return exports;
}
function exitClass(globals) {
  const path = 'assets/Colony/scripts/presentation/pageStates/playState.ts';
  const source = ts.createSourceFile(path, readFileSync(new URL('../../' + path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'PlayState');
  const names = ['exit', 'closeResultPopups', 'launchWorker', 'read'];
  const members = declaration.members.filter(node => node.name && names.includes(node.name.getText(source)));
  assert.equal(members.length, names.length);
  const printer = ts.createPrinter();
  const code = ts.transpileModule(`class PlayState { ${members.map(node => printer.printNode(ts.EmitHint.Unspecified, node, source)).join('\n')} }; PlayState`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(code, globals);
}
function fixture() {
  const nodes = [], animations = [];
  class Vec3 {
    constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
    clone() { return new Vec3(this.x, this.y, this.z); }
    static ZERO = new Vec3(); static ONE = new Vec3(1, 1, 1);
    static distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
  }
  class Node {
    children = []; components = new Map(); isValid = true; position = new Vec3();
    constructor(name = '') { this.name = name; nodes.push(this); }
    get parent() { return this.owner ?? null; }
    set parent(owner) { this.removeFromParent(); this.owner = owner; owner?.children.push(this); }
    setParent(owner) { this.parent = owner; }
    removeFromParent() { if (this.owner) this.owner.children.splice(this.owner.children.indexOf(this), 1); this.owner = null; }
    destroy() { assert.equal(this.isValid, true, 'A node must be destroyed once'); this.isValid = false; for (const child of [...this.children]) child.destroy(); this.removeFromParent(); }
    getComponent(Type) { return this.components.get(Type) ?? null; }
    addComponent(Type) { const component = new Type(); component.node = this; this.components.set(Type, component); return component; }
    getChildByName(name) { return this.children.find(child => child.name === name) ?? null; }
    setPosition(x, y, z = 0) { this.position = typeof x === 'object' ? x.clone() : new Vec3(x, y, z); }
    setScale(x, y = x) { this.scale = typeof x === 'object' ? x : new Vec3(x, y, 1); }
    setRotationFromEuler() {} setSiblingIndex() {} targetOff() {}
  }
  class UITransform { setContentSize(width, height) { this.size = typeof width === 'object' ? width : { width, height }; } setAnchorPoint() {} convertToNodeSpaceAR(point) { return point; } convertToWorldSpaceAR(point) { return point; } }
  class Sprite { static SizeMode = { CUSTOM: 0 }; }
  class UIOpacity { opacity = 255; }
  const cc = { Node, Vec3, UITransform, Sprite, UIOpacity, Color: { WHITE: {} }, Layers: { Enum: { UI_2D: 1 } },
    Tween: { stopAllByTarget: target => animations.filter(a => a.target === target).forEach(a => { a.stopped = true; }) },
    tween: target => {
      const animation = { target, to(_duration, values) { this.values = values; return this; },
        call(callback) { this.callback = callback; return this; }, timeScale() { return this; },
        start() { animations.push(this); return this; }, finish() { this.done = true; Object.assign(target, this.values); this.callback(); } };
      return animation;
    }, view: { getVisibleSize: () => ({ width: 750, height: 1334 }) },
    _decorator: { ccclass: () => Type => Type, property: () => () => {} } };
  const ObjectPool = real('extensions/MKFramework/assets/MKFramework/Framework/MKObjectPool.ts',
    { './MKLogger': { mkLog: { warn() {} } }, './Task/MKStatusTask': { default: class {} } }).default;
  const { NodeFactory } = real('assets/Colony/scripts/presentation/nodeFactory.ts', { cc, mk: { default: { ObjectPool } } });
  const { TransportPresentation } = real('assets/Colony/scripts/presentation/transportPresentation.ts',
    { cc, './nodeFactory': { NodeFactory }, './colonyColors': { colonyColor: () => cc.Color.WHITE } });
  const root = new Node('TransportRoot'), boardRoot = new Node('BoardContent');
  const transport = new TransportPresentation(root, boardRoot, {}, {});
  transport.setBoardGeometry({ entryPosition: () => ({ x: 0, y: 300 }), toPosition: (row, column) => ({ x: column * 10, y: 200 - row * 10 }), cellSize: 28 });
  const pending = () => animations.find(a => !a.done && !a.stopped);
  return { cc, nodes, animations, root, boardRoot, transport, pending, async advanceUntil(predicate) {
    for (let step = 0; step < 20 && !predicate(); step++) { assert.ok(pending(), 'Expected an active animation'); pending().finish(); await tick(); }
    assert.ok(predicate(), 'Expected transport phase');
  } };
}
function firstMove(model) {
  const snapshot = model.snapshot(), colors = new Set(snapshot.board.filter(cell => snapshot.exposedCellIds.includes(cell.id)).map(cell => cell.color));
  const group = snapshot.stacks.find(stack => stack.accessible && !stack.selected && colors.has(stack.color));
  assert.ok(group); model.selectStack(group.id);
  const events = model.dispatchReady()[0]; assert.ok(events?.some(event => event.phase === 'MOVE')); return events;
}

for (const phase of ['movement', 'clear', 'fade']) test(`real PlayState exit cancels old ${phase} work across levels 1–7 without writing the next round`, { timeout: 10000 }, async () => {
  for (let level = 1; level <= 7; level++) {
    const f = fixture(), oldModel = new ColonyFlowModel(catalog); oldModel.reset(level);
    let releaseClear, clearStarted = false, projections = 0;
    const clearGate = phase === 'clear' ? new Promise(resolve => { releaseClear = resolve; }) : Promise.resolve();
    const playRoot = new f.cc.Node('PlayRoot'); f.root.parent = playRoot; f.boardRoot.parent = playRoot;
    const session = { generation: level, play: oldModel, catalog, app: { error: null }, guide: { cancel: async () => {} }, toast: { clear() {} }, playRoot };
    const { unmountPlay } = real('assets/Colony/scripts/presentation/pageNodes.ts', { cc: f.cc, mk: {}, '../colonyUtil': {},
      ...Object.fromEntries(['boardView', 'slotView', 'hudView', 'toolBarView', 'loadingView', 'constructionView'].map(name => [`../views/${name}`, {}])) });
    const Subject = exitClass({ unmountPlay, mk: { uiManage: { close: async () => {} } }, ColonyResultSuccessView: class {}, ColonyResultFailView: class {}, swallowMkInterrupt: value => value });
    const subject = new Subject();
    const board = { getSlotWorldPosition: () => f.cc.Vec3.ZERO, clearCell: () => { clearStarted = true; return clearGate; }, applyCounts: () => { projections++; }, dispose() {} };
    Object.assign(subject, { context: session, board, transport: f.transport, transportTasks: new Set(), waitingStacks: new Set(), hardNotice: { dispose() {} }, resultControl: null });
    subject.launchWorker(session, board, f.transport, firstMove(oldModel), session.generation);
    const task = [...subject.transportTasks][0]; assert.ok(task);
    if (phase === 'clear') await f.advanceUntil(() => clearStarted);
    if (phase === 'fade') await f.advanceUntil(() => f.pending()?.target instanceof f.cc.UIOpacity);
    await subject.exit();
    assert.equal(session.generation, level + 1); assert.equal(session.playRoot, null);
    for (const key of ['boardView', 'slotView', 'hudView', 'toolBarView', 'stackRoot', 'transportRoot']) assert.equal(session[key], null);
    assert.equal(subject.transportTasks.size, 0);
    // The state machine can reuse its PlayState instance: keep a new worker pending
    // on that same subject while old promises and queued callbacks finally settle.
    const next = fixture(), nextModel = session.play = new ColonyFlowModel(catalog); nextModel.reset(level === 7 ? 7 : level + 1);
    session.playRoot = new next.cc.Node('NextPlayRoot'); next.root.parent = session.playRoot; next.boardRoot.parent = session.playRoot;
    let freshWrites = 0;
    const nextBoard = { getSlotWorldPosition: () => next.cc.Vec3.ZERO, clearCell: async () => { freshWrites++; }, applyCounts: () => { freshWrites++; }, dispose() {} };
    subject.board = nextBoard; subject.transport = next.transport; subject.collectionFlight = { accept() { freshWrites++; }, dispose() {} };
    subject.launchWorker(session, nextBoard, next.transport, firstMove(nextModel), session.generation);
    const nextTask = [...subject.transportTasks][0], before = nextModel.snapshot(), abandoned = oldModel.snapshot(), writes = projections;
    releaseClear?.(); await task;
    for (const animation of f.animations) animation.callback?.(); // Simulate already-queued callbacks after stop.
    await tick();
    assert.deepEqual(nextModel.snapshot(), before); assert.deepEqual(oldModel.snapshot(), abandoned); assert.equal(projections, writes); assert.equal(freshWrites, 0);
    assert.equal(subject.board, nextBoard); assert.equal(subject.transport, next.transport); assert.equal(subject.transportTasks.size, 1); assert.ok(subject.transportTasks.has(nextTask));
    assert.equal(next.transport.waits.size, 1); assert.equal(next.transport.evidence.activeWorkers, 1); assert.ok(next.pending());
    assert.equal(f.transport.waits.size, 0); assert.equal(f.transport.movementTweens.size, 0);
    assert.equal(f.transport.evidence.activeWorkers, 0); assert.equal(f.root.children.length, 0); assert.equal(f.pending(), undefined);
    for (const pool of [f.transport.workerPool, f.transport.cargoPool]) { assert.equal(pool.isValid, false); assert.equal(pool._objectList.length, 0); }
    assert.ok(f.nodes.filter(node => node.name.startsWith('ant-') || node.name === 'carried-food').every(node => !node.isValid));
    await subject.exit(); await nextTask;
    assert.equal(subject.transportTasks.size, 0); assert.equal(next.transport.waits.size, 0); assert.equal(next.pending(), undefined); assert.equal(freshWrites, 0);
  }
});

test('actual catalog model clears levels 1–7 consecutively with fresh round state and no pending transport', { timeout: 10000 }, () => {
  const model = new ColonyFlowModel(catalog);
  for (let level = 1; level <= 7; level++) {
    const initial = model.reset(level); assert.equal(initial.transported, 0); assert.equal(initial.result, 'PLAYING'); assert.ok(initial.slots.every(slot => slot === null));
    // Use the catalog's already-proven order; an exposed-color-only greedy strategy
    // cannot uncover every later queue head and is not a general solver.
    for (const group of catalog.levels[level - 1].groups) {
      model.selectStack(group.id);
      for (let step = 0; step <= initial.board.length; step++) {
        const batches = model.dispatchReady(); if (!batches.length) break;
        for (const events of batches) {
          const move = events.find(event => event.phase === 'MOVE'); assert.ok(move?.cellId); model.completeTransport(move.cellId);
        }
      }
    }
    const completed = model.snapshot(); assert.equal(completed.result, 'SUCCESS', `Level ${level}`); assert.equal(completed.remainingCells, 0);
    assert.equal(completed.transported, initial.board.length); assert.ok(completed.slots.every(slot => slot === null)); assert.equal(model.dispatchReady().length, 0);
  }
});

test('legal failure in an isolated quantity-correct board resets to the original replay state', () => {
  const cells = Array.from({ length: 25 }, (_, index) => {
    const row = Math.floor(index / 5), column = index % 5;
    return { id: `cell-${index}`, row, column, color: row === 0 || row === 4 || column === 0 || column === 4 ? 'leaf' : 'berry' };
  });
  const groups = [1, 2, 2, 2, 2].map((count, pile) => ({ id: `blocked-${pile}`, pile, depth: 0, count, color: 'berry' }));
  groups.push({ id: 'outer-leaf', pile: 0, depth: 1, count: 16, color: 'leaf' });
  const model = new ColonyFlowModel({ levels: [{ level: 1, sourceId: 'isolated-replay-lifecycle', shape: 'NIGHT_MARKET', rows: 5, columns: 5, cells, groups }] });
  const initial = model.snapshot();
  for (const group of groups.slice(0, 5)) model.selectStack(group.id);
  assert.equal(model.snapshot().result, 'FAIL'); assert.equal(model.dispatchReady().length, 0);
  assert.deepEqual(model.reset(1), initial); assert.equal(model.lastEventList().length, 0); assert.equal(model.lastDispatchRoundList().length, 0);
});

test('saved background has no competing Widget and a fresh retry restores the same first-level frame at 750×1334', () => {
  const prefab = JSON.parse(readFileSync(new URL('../../assets/Colony/ui/board.prefab', import.meta.url), 'utf8'));
  const saved = prefab.find(item => item.__type__ === 'cc.Node' && item._name === 'BackgroundArt'); assert.ok(saved);
  assert.ok(saved._components.every(ref => prefab[ref.__id__].__type__ !== 'cc.Widget' || prefab[ref.__id__]._enabled === false));
  const frame = { originalSize: { width: 750, height: 1667 } };
  for (let retry = 0; retry < 3; retry++) {
    const f = fixture(), root = new f.cc.Node('Board'); root.setPosition(0, 146);
    for (const name of ['BackgroundArt', 'ThemeMid', 'ThemeNear', 'BoardFrame', 'Content', 'AntHole']) {
      const child = new f.cc.Node(name); child.parent = root; child.addComponent(f.cc.Sprite); child.addComponent(f.cc.UITransform);
    }
    const background = root.getChildByName('BackgroundArt'); background.setPosition(saved._lpos.x, saved._lpos.y);
    const { ColonyBoardView } = real('assets/Colony/scripts/views/boardView.ts', { cc: f.cc, mk: { default: { StaticViewBase: class {} } } });
    const board = new ColonyBoardView(); board.node = root; board.contentRoot = root.getChildByName('Content'); board.onLoad();
    board.setFirstLevelSkin(frame);
    assert.equal(background.getComponent(f.cc.Sprite).spriteFrame, frame); assert.equal(background.position.y + root.position.y, 0);
    assert.equal(background.getComponent(f.cc.UITransform).size.height, 1667); assert.ok(frame.originalSize.height >= 1334); assert.equal(background.active, true);
    root.destroy(); f.transport.dispose();
  }
});
