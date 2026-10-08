import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function fixture() {
  const animations = [], pooled = [];
  class Vec3 {
    constructor(x = 0, y = 0, z = 1) { Object.assign(this, { x, y, z }); }
    clone() { return new Vec3(this.x, this.y, this.z); }
    static ONE = new Vec3(1, 1, 1);
  }
  const pool = { put(node) { pooled.push(node); node.active = false; node.scale = Vec3.ONE.clone(); node.setParent(null); } };
  const exports = {};
  const source = readFileSync(new URL('../../assets/Colony/scripts/presentation/boardPresentation.ts', import.meta.url), 'utf8');
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: name => name === './nodeFactory' ? { NodeFactory: class { pool() { return pool; } dispose() {} } }
      : name === 'cc' ? { Vec3, Sprite: class {}, Tween: { stopAllByTarget() {} }, tween: node => {
        const animation = { steps: [], to(duration, values) { this.steps.push({ duration, values }); return this; },
          call(callback) { this.complete = callback; return this; }, start() { animations.push(this); return this; } };
        return animation;
      } } : {} });
  const slot = { position: new Vec3(), children: [], setScale() {}, setPosition() {}, getComponent: () => null };
  const root = { parent: null, targetOff() {}, children: [] };
  const board = new exports.BoardPresentation({}, root, [slot], {}, {}, root, () => {});
  board.slotNodes = [slot];
  const token = { isValid: true, active: true, scale: Vec3.ONE.clone(), parent: null,
    setParent(parent) { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = parent; parent?.children.push(this); } };
  token.setParent(slot);
  const label = { isValid: true, string: '1' };
  const bind = id => { board.displaySlots[0] = { stackId: id, remaining: 1, color: 'leaf' };
    board.slotTokens[0] = { node: token, label, stackId: id, color: 'leaf', remaining: 1 }; };
  bind('old');
  board.renderSlots = board.renderStacks = board.renderExposure = () => {};
  const release = id => board.applyCounts([{ phase: 'COUNT', slotIndex: 0, stackId: id, remaining: 0 },
    { phase: 'RELEASE', slotIndex: 0, stackId: id, remaining: 0 }], {});
  return { board, token, label, animations, pooled, slot, root, bind, release };
}

test('business slot is released immediately while only its zero view animates and returns once', () => {
  const f = fixture(); f.release('old');
  assert.equal(f.board.displaySlots[0], null); assert.equal(f.label.string, '0');
  assert.equal(f.token.parent, f.root); assert.equal(f.board.slotTokens[0], null);
  assert.equal(f.pooled.length, 0); assert.equal(f.board.zeroExits.size, 1);
  assert.equal(f.animations[0].steps[0].values.scale.x, 1.12);
  assert.equal(f.animations[0].steps[1].values.scale.x, 0);
  f.animations[0].complete(); f.animations[0].complete();
  assert.deepEqual(f.pooled, [f.token]); assert.equal(f.board.zeroExits.size, 0);
});

test('refilled slot and late release of an old stack cannot touch the new occupant', () => {
  const f = fixture(); f.release('old');
  const newToken = { isValid: true }; f.board.displaySlots[0] = { stackId: 'new', remaining: 8, color: 'gold' };
  f.board.slotTokens[0] = { node: newToken, stackId: 'new' };
  f.release('old'); f.animations[0].complete();
  assert.equal(f.board.displaySlots[0].remaining, 8); assert.equal(f.board.slotTokens[0].node, newToken);
  assert.deepEqual(f.pooled, [f.token]); assert.equal(f.animations.length, 1);
});

test('recycle cancels the visual lifetime and a stale completion cannot reclaim a reused node', () => {
  const f = fixture(); f.release('old'); const stale = f.animations[0].complete;
  f.board.recycle(); assert.deepEqual(f.pooled, [f.token]);
  f.token.active = true; f.token.setParent(f.slot); f.bind('new');
  stale(); assert.deepEqual(f.pooled, [f.token]); assert.equal(f.token.active, true);
  assert.equal(f.token.scale.x, 1); assert.equal(f.board.slotTokens[0].stackId, 'new');
  f.release('new'); stale(); assert.equal(f.board.zeroExits.size, 1);
  f.board.dispose(); f.animations[1].complete();
  assert.equal(f.pooled.length, 2); assert.equal(f.board.zeroExits.size, 0);
});
