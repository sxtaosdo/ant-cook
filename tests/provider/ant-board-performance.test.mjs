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
