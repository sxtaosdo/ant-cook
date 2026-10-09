import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function layout(level, single = false) {
  class UITransform { setContentSize(width, height) { Object.assign(this, { width, height }); } }
  class Graphics {}
  class Label {}
  class Node {
    children = []; transform = new UITransform(); isValid = true;
    constructor(name) { this.name = name; }
    set parent(node) { node.children.push(this); }
    setPosition(x, y) { this.position = { x, y }; }
    getChildByName(name) { return this.children.find(node => node.name === name); }
    getComponent() { return this.transform; }
    addComponent(type) { return type === UITransform ? this.transform : new type(); }
  }
  const cc = { Node, UITransform, Graphics, Label, Color: class {}, Vec2: class { constructor(x, y) { Object.assign(this, { x, y }); } } };
  const exports = {}, timers = [];
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../../assets/Colony/scripts/views/levelRailView.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: () => cc, setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {} });
  const rail = Object.create(exports.LevelRailView.prototype);
  const content = new Node('RailContent'), strips = new Node('ThemeStrips'); strips.parent = content;
  Object.assign(rail, { content, levels: new Node('Levels'), items: [], fillState: {}, disposed: false,
    backgrounds: new Map(['tropical-fruit', 'tropical-vegetable', 'orchard-fruit', 'root-vegetable', 'leafy-vegetable'].map(theme => [theme, { node: new Node(theme) }])),
    scroll: { isValid: true, stopAutoScroll() {}, scrollToOffset(value) { this.offset = value.x; } },
    cancelReturn() {}, stopProgress() {}, clearCards() { this.items.length = 0; }, setBackground() {}, drawProgress() {}, refreshVisibleCards() {},
    createCard(item) { const node = new Node(`Level${item.index}`); item.node = node; return node; },
  });
  rail.render(level, 'Food', 'tropical-fruit', 100, 100, single); timers.forEach(fn => fn());
  return rail;
}

test('theme rail has readable gaps and keeps the current card reachable at both ends', () => {
  for (const level of [1, 7, 12, 13, 60]) {
    const rail = layout(level);
    assert.equal(rail.items.length, 60);
    for (let index = 1; index < rail.items.length; index++) {
      const previous = rail.items[index - 1], current = rail.items[index];
      assert.equal(current.left - previous.left - previous.width, 20);
    }
    assert.equal(rail.scroll.offset, rail.items[level - 1].left);
    assert.ok(rail.content.transform.width >= rail.scroll.offset + 340);
  }
});

test('single-level daily rail retains its one wide progress card', () => {
  const rail = layout(1, true);
  assert.equal(rail.items.length, 1); assert.equal(rail.items[0].width, 328); assert.equal(rail.scroll.offset, 0);
});
