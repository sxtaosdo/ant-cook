import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Production presentation code runs here. Nodes, rendering and the Cocos clock are doubles.
function load(file, modules) {
  const source = readFileSync(new URL(`../../assets/Colony/scripts/presentation/${file}.ts`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => modules[name] ?? {} });
  return exports;
}

function fixture(count = 9) {
  const animations = [], nodes = [], recycled = [];
  class Vec3 {
    constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
    clone() { return new Vec3(this.x, this.y, this.z); }
    static ZERO = new Vec3(); static ONE = new Vec3(1, 1, 1);
  }
  class Node {
    isValid = true; children = []; components = new Map(); position = new Vec3(); scale = Vec3.ONE.clone(); angle = 0;
    constructor(name) { this.name = name; nodes.push(this); }
    set parent(node) { this.owner = node; node.children.push(this); }
    get parent() { return this.owner; }
    setPosition(x, y, z = 0) { this.position = typeof x === 'object' ? x.clone() : new Vec3(x, y, z); }
    setScale(x, y, z = 1) { this.scale = typeof x === 'object' ? x.clone() : new Vec3(x, y, z); }
    getComponent(Type) { return this.components.get(Type) ?? null; }
    addComponent(Type) { const component = new Type(); this.components.set(Type, component); return component; }
    setSiblingIndex(index) { const siblings = this.owner.children; siblings.splice(siblings.indexOf(this), 1); siblings.splice(index, 0, this); }
    destroy() { assert.ok(this.isValid, 'destroy once'); this.isValid = false; this.owner?.children.splice(this.owner.children.indexOf(this), 1); }
    targetOff() {}
  }
  class UIOpacity { isValid = true; opacity = 255; }
  class UITransform { setContentSize() {} }
  class Graphics { ellipses = 0; ellipse() { this.ellipses++; } fill() {} circle() {} stroke() {} }
  class Sprite { static SizeMode = { CUSTOM: 0 }; }
  const cc = { Sprite, Node, Vec3, UIOpacity, UITransform, Graphics, Color: class {},
    Tween: { stopAllByTarget(target) { for (const animation of animations) if (animation.target === target) animation.stopped = true; } },
    tween: target => {
      const animation = { target, to(duration, properties, options) { Object.assign(this, { duration, properties, options }); return this; },
        call(callback) { this.callback = callback; return this; }, start() { animations.push(this); return this; },
        advance(time) { if (this.stopped) return; target.time = time; this.options.onUpdate(); },
        complete() { if (this.stopped) return; this.advance(this.duration); this.callback(); } };
      return animation;
    },
  };
  const pool = { put(node) { recycled.push(node); }, destroy() {} };
  const { BoardPresentation } = load('boardPresentation', { cc, './nodeFactory': { NodeFactory: class { pool() { return pool; } dispose() {} } } });
  const root = new Node('board'), slots = new Node('slots'), stacks = new Node('stacks');
  const board = new BoardPresentation(root, slots, [], {}, {}, stacks, () => {});
  const span = Math.ceil(Math.sqrt(count));
  const cells = Array.from({ length: count }, (_, index) => {
    const node = new Node(`cell-${index}`); node.parent = root;
    node.setPosition(index % span * 18, Math.floor(index / span) * 18, index % 2);
    node.setScale(index % 2 ? 1.03 : 1, index % 2 ? 1.03 : 1, 1);
    board.cellNodes.set(node.name, node); return node;
  });
  board.geometryValue = { cellSize: 18, minRow: 0, maxRow: span - 1, minColumn: 0, maxColumn: span - 1,
    toPosition: (row, column) => ({ x: column * 18, y: row * 18 }) };
  const originals = cells.map(node => [node.position.clone(), node.scale.clone(), node.angle]);
  return { board, root, slots, stacks, cells, originals, animations, nodes, recycled, UIOpacity, Graphics };
}

function assertRestored(f) {
  for (const [index, node] of f.cells.entries()) {
    assert.deepEqual(node.position, f.originals[index][0]); assert.deepEqual(node.scale, f.originals[index][1]);
    assert.equal(node.angle, f.originals[index][2]); assert.equal(node.getComponent(f.UIOpacity).opacity, 255);
  }
  assert.equal(f.slots.getComponent(f.UIOpacity).opacity, 255);
  assert.equal(f.stacks.getComponent(f.UIOpacity)?.opacity ?? 255, 255);
  assert.equal(f.nodes.filter(node => node.name.startsWith('BoardArrival') && node.isValid).length, 0);
}

test('new board rises in a center-out wave, falls and restores exact exposed-cell geometry', async () => {
  const f = fixture(), finished = f.board.animateEntrance();
  assert.equal(f.animations.length, 1); assert.equal(f.animations[0].duration, 1.18);
  assert.ok(f.cells.every(node => node.getComponent(f.UIOpacity).opacity === 0));
  const center = f.cells[4], corner = f.cells[0];
  f.animations[0].advance(0.20);
  assert.ok(center.position.y > f.originals[4][0].y + 25); assert.equal(corner.position.y, f.originals[0][0].y);
  f.animations[0].advance(0.56);
  assert.ok(center.position.y < f.originals[4][0].y + 30);
  assert.ok(corner.position.y > f.originals[0][0].y + 25);
  f.animations[0].advance(0.66);
  assert.ok(center.scale.x > center.scale.y, 'landing squash follows the fall');
  f.animations[0].complete(); await finished; assertRestored(f);
});

test('recycle cancels an unfinished entrance and settles its waiter before pooling cells', async () => {
  const f = fixture(), finished = f.board.animateEntrance();
  f.animations[0].advance(0.45); f.board.recycle(); await finished;
  assertRestored(f); assert.equal(f.recycled.length, 9); assert.equal(f.board.cellNodes.size, 0);
  assert.ok(f.animations[0].stopped); f.animations[0].advance(0.70); assertRestored(f);
});

test('replacement and disposal never retain an old clock, duplicate effects or hidden controls', async () => {
  const f = fixture(), first = f.board.animateEntrance();
  f.animations[0].advance(0.3);
  const second = f.board.animateEntrance(); await first;
  assert.equal(f.nodes.filter(node => node.name.startsWith('BoardArrival') && node.isValid).length, 2);
  assert.equal(f.animations.filter(animation => !animation.stopped).length, 1);
  f.board.dispose(); f.board.dispose(); await second; assertRestored(f);
  await f.board.animateEntrance(); assert.equal(f.animations.length, 2);
});

test('large boards still use one clock and only two temporary draw layers', async () => {
  const f = fixture(1444), finished = f.board.animateEntrance();
  assert.equal(f.animations.length, 1); assert.equal(f.nodes.length, 1449);
  const shadows = f.nodes.find(node => node.name === 'BoardArrivalShadows');
  assert.equal(shadows.getComponent(f.Graphics).ellipses, 1444);
  for (const time of [0.05, 0.38, 0.64, 0.89, 1.15]) {
    f.animations[0].advance(time);
    for (const node of f.cells) assert.ok(Number.isFinite(node.position.y) && node.scale.x > 0 && node.scale.y > 0);
  }
  f.animations[0].complete(); await finished; assertRestored(f);
});

test('empty boards complete immediately without allocating animation nodes', async () => {
  const f = fixture(0); await f.board.animateEntrance();
  assert.equal(f.animations.length, 0); assert.equal(f.nodes.length, 3);
});

function themeFixture() {
  let releaseEntrance, owns = true;
  const node = { isValid: true }, component = () => ({ isValid: true, node });
  const board = { geometry: {}, reset() {}, setSquareTile() {}, setStackTile() {}, setStackChain() {},
    setQueueInputAllowed() {}, playBottomBlockEntrance: async () => {},
    animateEntrance: () => new Promise(resolve => { releaseEntrance = resolve; }) };
  const hud = { ...component(), clearTheme() {}, async showLevelRail() {}, setFirstLevelSkin() {}, setResources() {}, setFeedback() {}, setThemeCollected() {} };
  const session = { generation: 1, destroyed: false, isValid: true, node, round: { mode: 'main' }, inputLocked: true,
    boardView: { ...component(), setFirstLevelSkin() {} }, hudView: hud,
    slotView: { ...component(), setFirstLevelSkin() {} }, toolBarView: { ...component(), setFirstLevelSkin() {} },
    playRoot: node, stackRoot: node, transportRoot: node };
  const { prepareThemePresentation } = load('themePresentation', { mk: { default: { asset: { get: async () => ({}) } } } });
  return { session, board, prepareThemePresentation,
    read: { currentLevel: 2, snapshot: { board: [{}], remainingCells: 1 } },
    transport: { setSquareTile() {}, setBoardGeometry() {} }, owns: () => owns,
    replace() { owns = false; session.generation++; }, release() { releaseEntrance(); },
    async waitUntilAnimating() { for (let i = 0; i < 12 && !releaseEntrance; i++) await Promise.resolve(); assert.ok(releaseEntrance); } };
}

test('theme projection keeps input locked through the entire entrance before allowing selection', async () => {
  const f = themeFixture();
  const pending = f.prepareThemePresentation(f.session, f.board, f.transport, f.read, null, f.owns);
  await f.waitUntilAnimating(); assert.equal(f.session.inputLocked, true);
  f.release(); await pending; assert.equal(f.session.inputLocked, false);
});

test('a cancelled old level never unlocks the replacement page after its entrance finishes', async () => {
  const f = themeFixture();
  const pending = f.prepareThemePresentation(f.session, f.board, f.transport, f.read, null, f.owns);
  await f.waitUntilAnimating(); f.replace(); f.release(); await pending;
  assert.equal(f.session.inputLocked, true);
});

for (const [level, frame, expected] of [[1, {}, 0.24], [2, {}, 0.51], [2, null, 0.24]]) {
  test(`bottom entrance level ${level}, ant ${Boolean(frame)} restores visible nodes only`, async () => {
    const f = fixture();
    const visible = f.cells.slice(0, 3);
    visible.forEach((node, index) => {
      node.active = index < 2; node.setPosition(index * 100, 0, 2);
      f.board.stackNodes.set(node.name, node);
    });
    const pending = f.board.playBottomBlockEntrance(level, frame);
    assert.ok(Math.abs(f.animations[0].duration - expected) < 1e-9);
    assert.equal(visible[2].position.y, 0, 'hidden queue is untouched');
    assert.equal(visible[0].position.y, level === 2 && frame ? -70 : -30);
    f.animations[0].advance(0.10);
    assert.ok(visible[0].position.y > visible[1].position.y, 'left column leads');
    f.animations[0].complete(); await pending;
    for (const node of visible.slice(0, 2)) {
      assert.equal(node.position.y, 0); assert.equal(node.position.z, 2);
      assert.equal(node.getComponent(f.UIOpacity).opacity, 255);
    }
    assert.equal(f.nodes.filter(node => node.name === 'BottomArrivalAnt' && node.isValid).length, 0);
  });
}
test('bottom cancellation restores before reuse and stale clock cannot move nodes', async () => {
  const f = fixture(); const node = f.cells[0]; node.active = true;
  f.board.stackNodes.set('first', node);
  const pending = f.board.playBottomBlockEntrance(2, {});
  f.animations[0].advance(0.12); f.board.cancelBottomEntrance(); await pending;
  assert.equal(node.position.y, 0);
  node.setPosition(300, 400); f.animations[0].advance(0.25);
  assert.equal(node.position.y, 400);
  assert.equal(f.nodes.filter(node => node.name === 'BottomArrivalAnt' && node.isValid).length, 0);
});
