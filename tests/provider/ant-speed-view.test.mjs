import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function fixture() {
  class Button { static EventType = { CLICK: 'click' }; }
  class Node {
    static EventType = { TOUCH_START: 'start', TOUCH_MOVE: 'move' };
    isValid = true; active = true; handlers = new Map(); button = new Button();
    get activeInHierarchy() { return this.active; }
    getComponent() { return this.button; }
    targetOff(owner) { for (const [key, rows] of this.handlers) this.handlers.set(key, rows.filter(row => row.owner !== owner)); }
    on(key, fn, owner) { const rows = this.handlers.get(key) ?? []; rows.push({ fn, owner }); this.handlers.set(key, rows); }
    emit(key) { for (const row of this.handlers.get(key) ?? []) row.fn.call(row.owner); }
  }
  class View { valid = true; emitted = []; event = { emit: (...args) => this.emitted.push(args), off() {} }; }
  const cc = { Node, Button, Color: class {}, Label: class {}, _decorator: {
    ccclass: () => Class => Class, property: (_target, key) => typeof key === 'string' ? undefined : () => {},
  } };
  function load(relative, imports = {}) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL(relative, import.meta.url), 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, useDefineForClassFields: false,
    } }).outputText, { exports, require: name => name === 'cc' ? cc : name === 'mk' ? { default: { MVCViewBase: View } } : imports[name] ?? {} });
    return exports;
  }
  const popup = load('../../assets/Colony/popups/progress/script/popupView.ts');
  const { ColonySpeedView } = load('../../assets/Colony/popups/speed/script/speedView.ts', { '../../progress/script/popupView': popup });
  const view = new ColonySpeedView(); view.node = new Node();
  for (const key of ['titleLabel', 'summaryLabel', 'durationLabel', 'remainingLabel', 'offerDetailLabel', 'actionLabel', 'feedbackLabel']) view[key] = { string: '', node: new Node() };
  view.actionButton = new Node(); view.dismissButton = new Node();
  const page = { layout: 'speed', title: 'Speed', summary: 'Daily 3 minutes', speed: { durationText: '2 minutes', remainingText: '0:00' },
    rows: [{ action: 'ad-speed', detail: 'Rewarded video', button: 'Watch video', enabled: true }] };
  const model = { page, feedback: '' }; view.init(model); view.open(); view.render();
  return { view, model, page };
}

test('dedicated speed view projects its offer once, disables unavailable ads, and preserves retry feedback', () => {
  const { view, model, page } = fixture();
  view.render(); assert.equal(view.actionButton.handlers.get('click').length, 1);
  view.actionButton.emit('click'); assert.deepEqual(Array.from(view.emitted[0]), ['action', 'ad-speed']);
  model.page = { ...page, rows: [{ ...page.rows[0], enabled: false, button: 'Unavailable' }] };
  model.feedback = 'Retry saving'; view.render();
  assert.equal(view.durationLabel.string, '2 minutes'); assert.equal(view.remainingLabel.string, '0:00');
  assert.equal(view.actionButton.button.interactable, false); assert.equal(view.actionLabel.string, 'Unavailable');
  assert.equal(view.feedbackLabel.string, 'Retry saving'); assert.equal(view.feedbackLabel.node.active, true);
  view.dismissButton.emit('click'); assert.equal(view.emitted.at(-1)[0], 'close');
});

test('closing, suspension and disable remove the old speed actions; missing fixed bindings fail closed', () => {
  const { view } = fixture();
  view.close(); view.actionButton.emit('click'); view.dismissButton.emit('click'); assert.equal(view.emitted.length, 0);
  view.open(); view.suspend(); view.actionButton.emit('click'); assert.equal(view.emitted.length, 0);
  view.node.active = true; view.open(); view.onDisable(); view.onDestroy();
  assert.equal(view.actionButton.handlers.get('click').length, 0);
  view.actionButton = null; assert.throws(() => view.render(), /Speed popup binding/);
});
