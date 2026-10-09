import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function subject(path, globals) {
  const ast = ts.createSourceFile(path, readFileSync(new URL('../../' + path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const cls = ast.statements.find(ts.isClassDeclaration);
  const printed = ts.createPrinter().printNode(ts.EmitHint.Unspecified, cls, ast).replace(/export class \w+/, 'class Subject');
  const code = ts.transpileModule(printed + '; Subject', { compilerOptions: { target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  return vm.runInNewContext(code, { ccclass: () => v => v, property: () => () => {}, Promise, Error, console, ...globals });
}

test('actual guide keeps an eligible segment visible until its Continue callback', async () => {
  let scheduled, next, writes = 0;
  const step = { ready: true, unload() {} };
  const view = { node: { active: false }, steps: [step], feedback: {}, next: {}, stop() {}, validate() {},
    show(...args) { next = args[6]; }, refreshHole() {}, schedule(fn) { scheduled = fn; } };
  const node = { getComponent: () => view, setPosition() {}, destroy() {} };
  view.node = node;
  class GuideManage { regis(steps) { this.steps = steps; } async run() { this.steps[0].activate(); } }
  const Subject = subject('assets/Colony/scripts/presentation/guidePresentation.ts', { Prefab: class {}, Node: class {}, ColonyGuideView: class {}, instantiate: () => node,
    ColonyUtil: { applyUiLayer() {} }, mk: { GuideManage, asset: { get: async () => ({}) }, Release: { followRelease() {} } } });
  const context = { generation: 1, destroyed: false, popupRoot: {}, playRoot: { activeInHierarchy: true }, round: { mode: 'main', id: 'r' },
    stackRoot: { getChildByName: () => ({}) }, play: { snapshot: () => ({ transported: 1, stacks: [{ accessible: true, id: 1 }] }) },
    progress: { socialAvailable: () => false, readGuide: () => ({ status: 'pending', segment: 0 }), canAdvanceGuide: () => true, advanceGuide() { writes++; } } };
  const guide = new Subject(context); guide.open('play'); await guide.mounting;
  for (let i = 0; i < 40; i++) scheduled();
  assert.equal(writes, 0); assert.equal(node.active, true); assert.equal(view.next.interactable, true);
  next(); await guide.closing; assert.equal(writes, 1); assert.equal(node.active, false);
});

test('actual tool count binds a separate popup route, retaining icon use across rebinds', () => {
  class Button { static EventType = { CLICK: 'click' }; }
  const Subject = subject('assets/Colony/scripts/views/toolBarView.ts', { Button, Label: class {}, mk: { StaticViewBase: class {} } });
  const view = new Subject(), events = [];
  const node = () => ({ handlers: [], targetOff() { this.handlers = []; }, on(_, fn) { this.handlers.push(fn); }, click() { this.handlers.forEach(fn => fn()); } });
  for (const tool of ['trowel', 'slot', 'compass']) { view[tool + 'Button'] = { node: node() }; view[tool + 'Count'] = { node: node() }; }
  const bind = () => view.bind(tool => events.push('use:' + tool), tool => events.push('popup:' + tool));
  bind(); bind();
  for (const tool of ['trowel', 'slot', 'compass']) { view[tool + 'Count'].node.click(); view[tool + 'Button'].node.click(); }
  assert.deepEqual(events, ['popup:trowel', 'use:trowel', 'popup:slot', 'use:slot', 'popup:compass', 'use:compass']);
  view.onDestroy(); view.trowelCount.node.click(); assert.equal(events.length, 6);
});

test('actual currency entrance starts on visibility edges, survives switch holds and cancels on hide', () => {
  let business = false, started = 0, stopped = 0, animation;
  class Vec3 { constructor(x, y, z) { Object.assign(this, { x, y, z }); } clone() { return new Vec3(this.x, this.y, this.z); } }
  class Button { static EventType = { CLICK: 'click' }; }
  class Widget {} class UITransform {}
  const Subject = subject('assets/Colony/scripts/views/currencyOverlayView.ts', { Node: class {}, Label: class {}, Button, Vec3,
    Widget, UITransform, sys: { getSafeAreaRect: () => ({ y: 0, height: 1334 }) }, view: { on() {}, off() {} },
    mk: { StaticViewBase: class {} }, Tween: { stopAllByTarget() { stopped++; } },
    tween: target => ({ to(duration, props) { animation = { target, duration, props }; return this; },
      call(complete) { animation.complete = complete; return this; }, start() { started++; } }) });
  const view = new Subject();
  view.node = { getComponent: type => type === Widget ? { updateAlignment() {} } : { height: 1334, anchorY: 0.5,
    convertToWorldSpaceAR: p => new Vec3(p.x, p.y + 667, p.z), convertToNodeSpaceAR: p => new Vec3(p.x, p.y - 667, p.z) } };
  const barsWidget = { top: 0, enabled: true, isValid: true, updateAlignment() { view.bars.setPosition(0, 634.5 - this.top, 0); } };
  view.bars = { isValid: true, active: true, scale: new Vec3(0.65, 0.65, 1), getComponent: type => type === Widget ? barsWidget : { height: 100 },
    position: new Vec3(0, 548, 0), setPosition(x, y, z) { this.position = typeof x === 'object' ? x.clone() : new Vec3(x, y, z); } };
  view.profileStrip = { getComponent: () => ({ updateAlignment() {} }) };
  view.coins = {}; view.diamonds = {}; view.diamondButton = view.plusButton = { node: { isValid: true, targetOff() {}, on() {} } };
  view.hasBusinessPopup = () => business; view.bind({}, () => ({ coins: 40, diamonds: 30 }), () => {});
  view.lateUpdate(); assert.equal(started, 0);
  business = true; view.lateUpdate(); assert.equal(view.bars.position.y, 734.5); assert.equal(animation.props.position.y, 634.5);
  assert.equal(barsWidget.enabled, false);
  // Simulate WidgetManager's AFTER_UPDATE pass before the tween samples its start.
  if (barsWidget.enabled) barsWidget.updateAlignment();
  assert.equal(view.bars.position.y, 734.5);
  view.bars.setPosition(animation.props.position); animation.complete();
  assert.equal(barsWidget.enabled, true);
  for (let i = 0; i < 20; i++) view.lateUpdate(); assert.equal(started, 1);
  const release = view.holdDuringSwitch(); business = false; view.lateUpdate(); assert.equal(view.bars.active, true); assert.equal(started, 1);
  release(); view.lateUpdate(); assert.equal(view.bars.active, false); assert.equal(view.bars.position.y, 634.5);
  assert.equal(barsWidget.enabled, true);
  business = true; view.lateUpdate(); assert.equal(barsWidget.enabled, false);
  business = false; view.lateUpdate(); assert.equal(barsWidget.enabled, true);
  business = true; view.lateUpdate(); assert.equal(started, 3); view.onDestroy(); assert.ok(stopped >= 4);
  // MK may clear the referenced component node before the view's destroy callback.
  view.diamondButton = { node: null }; view.plusButton = null; view.bars = null;
  assert.doesNotThrow(() => view.onDestroy());
});
