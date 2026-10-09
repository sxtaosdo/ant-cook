import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
function load(file, modules) {
  const source = readFileSync(new URL(`../../assets/Colony/scripts/presentation/${file}.ts`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, require: name => modules[name] ?? {} });
  return exports;
}

test('slot counters retain tokens through COUNT, replace ownership on RELEASE and preserve expansion', () => {
  const Label = class {}, Color = class { static WHITE = {}; };
  let gets = 0, puts = 0;
  const free = [];
  const pool = { put(node) {
    assert.ok(!free.includes(node), 'no duplicate put'); puts++;
    node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; node.active = false; free.push(node);
  } };
  const { BoardPresentation } = load('boardPresentation', {
    cc: { Label, Color }, './colonyColors': { colonyColor: color => color },
    './nodeFactory': { NodeFactory: class {
      pool() { return pool; }
      acquire(_pool, name, _x, _y, _w, _h, parent) {
        gets++; const node = free.pop() ?? { isValid: true, label: null, getComponentInChildren() { return this.label; } };
        if (!node.label?.isValid) node.label = { isValid: true, string: '' };
        Object.assign(node, { name, parent, active: true }); parent.children.push(node); return node;
      }
      token(node, _color, frame) { node.frame = frame; }
    } },
  });
  const slots = Array.from({ length: 6 }, () => ({ children: [], position: { x: 0 }, scale: { x: 1.2 } }));
  const frame = {}, board = new BoardPresentation({}, {}, slots, frame, {}, {}, () => {});
  board.slotNodes = slots.slice(0, 5);
  board.displaySlots = [{ stackId: 'a', color: 'leaf', remaining: 3 }, { stackId: 'b', color: 'leaf', remaining: 3 }, null, null, null];
  board.renderSlots(); const a = slots[0].children[0], b = slots[1].children[0];
  board.renderSlots(); assert.equal(gets, 2); assert.equal(puts, 0);
  board.displaySlots[0].remaining = 0; board.renderSlots();
  assert.equal(slots[0].children[0], a); assert.equal(a.getComponentInChildren(Label).string, '0');
  assert.equal(slots[1].children[0], b); assert.equal(slots[0].scale.x, 1.2);
  board.slotNodes = slots; board.displaySlots.push({ stackId: 'c', color: 'gold', remaining: 4 }); board.renderSlots();
  assert.equal(slots[0].children[0], a); assert.equal(slots[1].children[0], b); assert.equal(gets, 3);
  board.displaySlots[0] = null; board.renderSlots(); assert.equal(slots[0].children.length, 0); assert.equal(puts, 1);
  board.displaySlots[0] = { stackId: 'd', color: 'leaf', remaining: 3 }; board.renderSlots();
  assert.equal(slots[0].children[0], a); assert.equal(gets, 4);
  assert.equal(board.slotTokens[0].stackId, 'd'); assert.equal(a.getComponentInChildren(Label).string, '3');
  assert.equal(a.parent, slots[0]); assert.equal(slots[0].children.length, 1);
  slots[0].children[0].getComponentInChildren(Label).isValid = false; board.renderSlots();
  assert.equal(gets, 5); assert.equal(puts, 2); assert.equal(slots[0].children.length, 1);
  const replacement = {}; board.stackTile = replacement; board.renderSlots(); assert.equal(gets, 8); assert.equal(puts, 5);
  for (const index of [0, 1, 5]) { assert.equal(slots[index].children.length, 1); assert.equal(slots[index].children[0].frame, replacement); }
  assert.equal(a.getComponentInChildren(Label).isValid, true);
});

test('queue visibility never reactivates offscreen stacks and preserves moving/reflow behavior', () => {
  class Label {}
  class Color { static WHITE = {}; constructor(value) { this.value = value; } }
  class Sprite {}
  class Button { static Transition = { SCALE: 1, NONE: 0 }; }
  class Vec3 {
    static ONE = { x: 1, y: 1, z: 1 };
    constructor(x, y, z) { Object.assign(this, { x, y, z }); }
    static distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
  }
  const animations = [], stops = [];
  const geometry = load('boardGeometry', {});
  const { BoardPresentation } = load('boardPresentation', {
    cc: { Label, Color, Sprite, Button, Vec3, Tween: { stopAllByTarget: n => stops.push(n) }, tween: node => ({
      to(duration, properties, options) { animations.push({ node, duration, properties, options }); return this; },
      start() { return this; },
    }) },
    './boardGeometry': geometry,
    './colonyColors': { colonyColor: color => color },
    './nodeFactory': { NodeFactory: class { pool() { return {}; } } },
  });
  const board = new BoardPresentation({}, {}, [], {}, {}, {}, () => {});
  const label = { string: '' }, button = {}, sprite = {}, hint = { active: false }, transitions = [];
  let active = false;
  const node = {
    position: { x: 0, y: -416, z: 0 }, angle: 12,
    get active() { return active; },
    set active(value) { if (active !== value) transitions.push([active, value]); active = value; },
    getComponent(kind) { return kind === Button ? button : kind === Sprite ? sprite : null; },
    getComponentInChildren(kind) { return kind === Label ? label : null; },
    getChildByName(name) { return name === 'UnlockHint' ? hint : name === 'StackCountLabel' ? { getComponent: kind => kind === Label ? label : null } : null; },
    setPosition(value) { this.position = value; },
    setScale(value) { this.scale = value; },
  };
  const head = { id: 'head', pile: 0, depth: 0, selected: false, count: 3, color: 'leaf', accessible: true };
  const tail = { ...head, id: 'tail', depth: 4, accessible: false };
  const read = { snapshot: { stacks: [head, tail] } };
  board.stackTile = {}; board.stackNodes.set(tail.id, node);
  for (let i = 0; i < 4; i++) board.renderStacks(read);
  assert.equal(active, false); assert.deepEqual(transitions, []);
  assert.equal(node.position.y, -416); assert.equal(label.string, '3'); assert.equal(hint.active, true);
  for (const [offset, visible] of [[156, true], [156, true], [480, true], [481, false], [481, false]]) {
    board.queueOffset = offset; board.renderStacks(read); assert.equal(active, visible);
  }
  assert.deepEqual(transitions, [[false, true], [true, false]]);
  board.stackTile = null; transitions.length = 0;
  for (const [offset, visible] of [[304, true], [528, true], [529, false], [303, false]]) {
    board.queueOffset = offset; board.renderStacks(read); assert.equal(active, visible);
  }
  assert.deepEqual(transitions, [[false, true], [true, false]]);
  board.queueOffset = 0; board.stackTile = {}; tail.selected = true;
  node.active = true; transitions.length = 0; board.moving.add(tail.id);
  const positionBefore = node.position;
  board.renderStacks(read, true);
  assert.equal(active, true); assert.deepEqual(transitions, []);
  assert.equal(button.interactable, false); assert.equal(node.position, positionBefore); assert.equal(animations.length, 0);
  board.moving.delete(tail.id); board.renderStacks(read); board.renderStacks(read);
  assert.equal(active, false); assert.deepEqual(transitions, [[true, false]]);
  tail.selected = false; head.selected = true; transitions.length = 0;
  board.renderStacks(read, true);
  assert.equal(active, true); assert.deepEqual(transitions, [[false, true]]);
  assert.equal(animations.length, 1); assert.equal(animations[0].duration, 0.26);
  assert.equal(animations[0].properties.position.y, 0); assert.equal(animations[0].options.easing, 'quadOut');
  assert.equal(stops.length, 1); assert.equal(node.angle, 0); assert.equal(node.scale, Vec3.ONE);
  board.renderStacks(read); assert.equal(node.position.y, 0); assert.equal(animations.length, 1);
});
