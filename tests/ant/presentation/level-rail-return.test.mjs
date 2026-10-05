import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function fixture() {
  let now = 0, nextTimer = 0;
  const timers = new Map(), calls = [];
  class UITransform { setContentSize(width, height) { Object.assign(this, { width, height }); } }
  class Sprite { static SizeMode = { CUSTOM: 0 }; }
  class UIOpacity {}
  class Label {}
  class Graphics { clear() {} roundRect() {} fill() {} }
  class Node {
    static EventType = { TOUCH_START: 'touch-start', TOUCH_END: 'touch-end', TOUCH_CANCEL: 'touch-cancel' };
    children = []; components = new Map(); events = new Map(); isValid = true;
    constructor(name) { this.name = name; }
    set parent(value) { this.owner = value; value.children.push(this); }
    get parent() { return this.owner; }
    getChildByName(name) { return this.children.find(child => child.name === name); }
    addComponent(type) { const component = new type(); component.node = this; this.components.set(type, component); return component; }
    getComponent(type) { return this.components.get(type); }
    setPosition(x, y) { this.position = { x, y }; } setSiblingIndex() {}
    on(event, fn, owner) { const handlers = this.events.get(event) ?? []; handlers.push(() => fn.call(owner)); this.events.set(event, handlers); }
    emit(event) { for (const handler of this.events.get(event) ?? []) handler(); }
    targetOff() { this.events.clear(); }
    destroy() { this.isValid = false; if (this.owner) this.owner.children = this.owner.children.filter(child => child !== this); }
  }
  class ScrollView {
    isValid = true; offset = 0;
    stopAutoScroll() { this.stops = (this.stops ?? 0) + 1; timers.delete(this.endTimer); }
    getScrollOffset() { return { x: this.offset, y: 0 }; }
    scrollToOffset(offset, duration) {
      this.offset = offset.x; calls.push({ x: offset.x, duration, at: now }); this.node.emit('scrolling');
      if (!duration) this.node.emit('scroll-ended');
      else { this.endTimer = ++nextTimer; timers.set(this.endTimer, { fn: () => this.node.emit('scroll-ended'), at: now + duration * 1000 }); }
    }
  }
  const cc = { Node, UITransform, Sprite, UIOpacity, Label, Graphics, ScrollView,
    Color: class {}, Vec2: class { constructor(x, y) { Object.assign(this, { x, y }); } },
    Tween: { stopAllByTarget() {} }, tween: () => { const chain = { to: () => chain, call: () => chain, start: () => chain }; return chain; },
  };
  const source = readFileSync(new URL('../../assets/Colony/scripts/views/levelRailView.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, require: () => cc,
    setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, at: now + delay }); return id; }, clearTimeout: id => timers.delete(id),
  });
  function node(name, parent) { const result = new Node(name); result.addComponent(UITransform); if (parent) result.parent = parent; return result; }
  const root = node('Rail'), viewport = node('RailViewport', root), content = node('RailContent', viewport);
  viewport.getComponent(UITransform).setContentSize(562, 80);
  node('Levels', content); const strips = node('ThemeStrips', content);
  for (const theme of ['tropical-fruit', 'tropical-vegetable', 'orchard-fruit', 'root-vegetable', 'leafy-vegetable']) {
    for (const parent of [root, strips]) { const strip = node(`RailBackground-${theme}`, parent); strip.addComponent(Sprite); strip.addComponent(UIOpacity); }
  }
  const scroll = viewport.addComponent(ScrollView), rail = new exports.LevelRailView(root);
  function advance(ms) {
    const end = now + ms;
    while (true) {
      const entry = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      timers.delete(entry[0]); now = entry[1].at; entry[1].fn();
    }
    now = end;
  }
  function render(level) { rail.render(level, '水果', 'tropical-fruit', 100, 100); advance(0); calls.length = 0; }
  return { rail, viewport, content, scroll, calls, timers, advance, render, UITransform };
}

test('current level starts at the left edge including levels 1, 7 and 60', () => {
  for (const level of [1, 7, 60]) {
    const f = fixture(); f.render(level);
    const card = f.content.getChildByName('Levels')?.getChildByName(`Level${level}`) ?? f.content.getChildByName(`Level${level}`);
    assert.equal(f.scroll.offset, card.position.x - card.getComponent(f.UITransform).width / 2);
    assert.ok(f.content.getComponent(f.UITransform).width >= f.scroll.offset + f.viewport.getComponent(f.UITransform).width);
  }
});

test('release waits a full second then returns smoothly once; holding a stopped drag never returns', () => {
  const f = fixture(); f.render(7); const initial = f.scroll.offset;
  f.viewport.emit('touch-start'); f.scroll.offset += 200; f.viewport.emit('scrolling'); f.viewport.emit('scroll-ended');
  f.advance(1500); assert.equal(f.calls.length, 0);
  f.viewport.emit('touch-end'); f.advance(999); assert.equal(f.calls.length, 0);
  f.advance(1); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].x, initial); assert.equal(f.calls[0].duration, 0.3);
  f.advance(2000); assert.equal(f.calls.length, 1);
});

test('new scrolling restarts the delay and re-touch interrupts a return', () => {
  const f = fixture(); f.render(7); const initial = f.scroll.offset;
  f.scroll.offset += 150; f.viewport.emit('scroll-ended'); f.advance(700);
  f.viewport.emit('scrolling'); f.advance(1000); assert.equal(f.calls.length, 0);
  f.viewport.emit('scroll-ended'); f.advance(1000); assert.equal(f.calls[0].x, initial);
  assert.equal(f.rail.returning, true); const stops = f.scroll.stops;
  f.viewport.emit('touch-start'); assert.equal(f.rail.returning, false); assert.equal(f.scroll.stops, stops + 1);
  f.advance(400); assert.equal(f.timers.has(f.scroll.endTimer), false);
});

test('cancelled touch returns, but rerender and dispose cancel callbacks for the old level', () => {
  const f = fixture(); f.render(7);
  f.viewport.emit('touch-start'); f.scroll.offset += 200; f.viewport.emit('touch-cancel'); f.advance(1000); assert.equal(f.calls.length, 1);
  f.scroll.offset += 100; f.viewport.emit('scroll-ended'); f.render(60); f.advance(1100); assert.equal(f.calls.length, 0);
  f.scroll.offset -= 100; f.viewport.emit('scroll-ended'); f.rail.dispose(); f.advance(1100); assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0);
});

test('dispose cancels a return already in flight', () => {
  const f = fixture(); f.render(7); f.scroll.offset += 100;
  f.viewport.emit('scroll-ended'); f.advance(1000); assert.equal(f.rail.returning, true);
  f.rail.dispose(); assert.equal(f.timers.size, 0);
});
