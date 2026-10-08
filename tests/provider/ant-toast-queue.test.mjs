import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const source = readFileSync(new URL('../../assets/Colony/scripts/presentation/toastQueue.ts', import.meta.url), 'utf8');
const exports = {};
runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports });
const { ToastQueue } = exports;
const message = text => ({ type: 'notice', object: 'social', text });
function fixture() {
  const shown = [], callbacks = []; let cancels = 0;
  const queue = new ToastQueue((item, done) => { shown.push(item.text); callbacks.push(done); }, () => cancels++);
  return { queue, shown, callbacks, cancelled: () => cancels };
}
test('one visible toast, three waiting; overflow drops oldest waiting item', () => {
  const f = fixture(); for (const text of ['a','b','c','d','e']) f.queue.show(message(text));
  assert.deepEqual(f.shown, ['a']);
  f.callbacks[0](); f.callbacks[1](); f.callbacks[2](); f.callbacks[3]();
  assert.deepEqual(f.shown, ['a','c','d','e']);
});
test('deduplicate by type, object and text across current and waiting', () => {
  const f = fixture(); f.queue.show(message('a')); f.queue.show(message('a'));
  f.queue.show(message('b')); f.queue.show(message('b'));
  f.queue.show({ ...message('b'), object: 'other' });
  f.callbacks[0](); f.callbacks[1](); f.callbacks[2]();
  assert.deepEqual(f.shown, ['a','b','b']);
});
test('page cancellation clears pending and stale completion cannot advance a reused queue', () => {
  const f = fixture(); f.queue.show(message('old')); f.queue.show(message('waiting'));
  const old = f.callbacks[0]; f.queue.clear(); f.queue.show(message('new')); f.queue.show(message('next'));
  old(); assert.deepEqual(f.shown, ['old','new']);
  f.callbacks[1](); old(); assert.deepEqual(f.shown, ['old','new','next']); assert.equal(f.cancelled(),1);
});
test('duplicate completion and blank messages do not create another display', () => {
  const f = fixture(); f.queue.show(message(' ')); f.queue.show(message('a')); f.queue.show(message('b'));
  f.callbacks[0](); f.callbacks[0](); assert.deepEqual(f.shown,['a','b']);
});

test('late MK load is closed before a new page can open another toast', async () => {
  const opens = [], closes = [], displays = [];
  class View { cancel() {} animate(text, done) { displays.push({ text, done }); } }
  const mk = { uiManage: { open: () => new Promise(resolve => opens.push(resolve)),
    close: item => { closes.push(item); return Promise.resolve(); } } };
  const presenterExports = {};
  const presenterSource = readFileSync(new URL('../../assets/Colony/scripts/presentation/toastPresentation.ts', import.meta.url), 'utf8');
  runInNewContext(ts.transpileModule(presenterSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports: presenterExports, console, require: name => name === 'mk' ? { default: mk }
      : name === './toastQueue' ? exports : name.endsWith('/toastView') ? { ColonyToastView: View }
      : { ColonyUtil: { applyUiLayer() {} } } });
  const context = { destroyed: false, generation: 1, popupRoot: { isValid: true } };
  const presenter = new presenterExports.ToastPresentation(context);
  const flush = async () => { for (let i=0;i<12;i++) await Promise.resolve(); };
  presenter.show('old'); await flush(); assert.equal(opens.length,1);
  presenter.clear(); context.generation++; presenter.show('new'); await flush(); assert.equal(opens.length,1);
  const old = new View(); opens[0](old); await flush(); assert.deepEqual(closes,[old]); assert.equal(opens.length,2);
  opens[1](new View()); await flush(); assert.deepEqual(displays.map(x=>x.text),['new']);
  const stale = displays[0].done; presenter.clear(); presenter.show('next'); await flush(); opens[2](new View()); await flush();
  stale(); await flush(); assert.deepEqual(displays.map(x=>x.text),['new','next']); assert.equal(opens.length,3);
});

function closeFailureFixture() {
  const opens = [], live = new Set(), displays = [], errors = [];
  let failClose = false;
  class View { cancel() {} animate(text, done) { displays.push({ text, done }); } }
  const mk = { uiManage: {
    open: () => new Promise(resolve => opens.push(view => { live.add(view); resolve(view); })),
    close: async view => { if (failClose) throw Error('close failed'); live.delete(view); },
  } };
  const presenterExports = {};
  const presenterSource = readFileSync(new URL('../../assets/Colony/scripts/presentation/toastPresentation.ts', import.meta.url), 'utf8');
  runInNewContext(ts.transpileModule(presenterSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports: presenterExports, console: { error: (...args) => errors.push(args) }, require: name => name === 'mk' ? { default: mk }
      : name === './toastQueue' ? exports : name.endsWith('/toastView') ? { ColonyToastView: View }
      : { ColonyUtil: { applyUiLayer() {} } } });
  const context = { destroyed: false, generation: 1, popupRoot: { isValid: true } };
  const presenter = new presenterExports.ToastPresentation(context);
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  return { presenter, context, opens, displays, errors, live, View, flush, fail: value => { failClose = value; } };
}

test('failed close retains its owner and blocks new opens until a successful retry', async () => {
  const f = closeFailureFixture(); f.presenter.show('old'); await f.flush();
  const old = new f.View(); f.opens[0](old); await f.flush();
  f.fail(true); f.presenter.clear(); await f.flush();
  await assert.rejects(f.presenter.flush(), /close failed/);
  f.presenter.show('blocked'); await f.flush();
  assert.equal(f.opens.length, 1); assert.equal(f.live.size, 1);
  assert.equal(f.presenter.closingOwners.has(old), true);
  f.fail(false); f.presenter.show('restored'); await f.flush();
  assert.equal(f.opens.length, 2); assert.equal(f.live.size, 0);
  f.opens[1](new f.View()); await f.flush();
  f.displays[0].done(); await f.flush();
  assert.equal(f.live.size, 1); assert.equal(f.displays.at(-1).text, 'restored');
  f.presenter.clear(); await f.presenter.flush(); assert.equal(f.live.size, 0);
});

test('late loaded owner survives failed cancellation close and can be drained on module exit', async () => {
  const f = closeFailureFixture(); f.presenter.show('late'); await f.flush();
  f.presenter.clear(); f.context.generation++; f.fail(true);
  const old = new f.View(); f.opens[0](old); await f.flush();
  assert.equal(f.displays.length, 0); assert.equal(f.presenter.closingOwners.has(old), true);
  await assert.rejects(f.presenter.flush(), /close failed/);
  f.fail(false); await f.presenter.flush();
  assert.equal(f.live.size, 0); assert.equal(f.presenter.closingOwners.size, 0);
});
