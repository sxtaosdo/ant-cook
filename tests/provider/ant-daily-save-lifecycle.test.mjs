import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { DailyActivityBuffer } from '../../assets/Colony/scripts/application/dailyActivity.ts';

function fixture() {
  let monotonic = 0, wall = Date.parse('2026-10-06T12:00:00+08:00'), fail = true;
  const listeners = new Map(), calls = [], messages = [], warnings = [];
  const emitter = {
    on(name, callback) { listeners.set(name, callback); },
    off(name) { listeners.delete(name); },
  };
  class ProgressControl { refresh() { throw Error('closed view'); } }
  const file = 'assets/Colony/scripts/presentation/dailyActivityPresentation.ts';
  const source = ts.createSourceFile(file, readFileSync(new URL('../../' + file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'DailyActivityPresentation');
  const code = ts.transpileModule(ts.createPrinter().printNode(ts.EmitHint.Unspecified, declaration, source)
    .replace('export class', 'class') + '\nDailyActivityPresentation;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const Subject = vm.runInNewContext(code, {
    DailyActivityBuffer, ProgressControl, director: emitter, Director: { EVENT_AFTER_UPDATE: 'update' },
    game: emitter, Game: { EVENT_HIDE: 'hide', EVENT_SHOW: 'show' },
    performance: { now: () => monotonic }, Date: class extends Date { static now() { return wall; } },
    console: { warn(...args) { warnings.push(args); } },
  });
  const context = {
    homeView: { isValid: true, node: { isValid: true, activeInHierarchy: true }, setFeedback(message) { messages.push(message); } },
    progress: {
      snapshot: () => ({ daily: { tasks: { timeReceipt: 0 } } }),
      recordDailyTime(receipt) { calls.push({ kind: 'time', receipt: { ...receipt } }); if (fail) throw Error('disk'); },
      recordDailyTool(roundId, tool, occurredAt) { calls.push({ kind: 'tool', roundId, tool, occurredAt }); if (fail) throw Error('disk'); },
    },
  };
  const subject = new Subject(context);
  return { subject, context, ProgressControl, calls, messages, warnings, listeners,
    advance(ms) { monotonic += ms; wall += ms; }, fail(value) { fail = value; },
    emit(name) { listeners.get(name)?.(); } };
}

test('actual task autosave retries at a bounded rate, reports home failure and forces the hide tail', () => {
  const f = fixture(); f.advance(31000); f.emit('update');
  assert.equal(f.calls.length, 1); assert.match(f.messages.at(-1), /待保存/);
  for (let i = 0; i < 30; i++) { f.advance(16); f.emit('update'); }
  assert.equal(f.calls.length, 1, 'failed storage is not retried every frame');
  f.advance(520); f.emit('update'); assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].receipt.sequence, f.calls[1].receipt.sequence);
  f.fail(false); f.emit('hide');
  assert.deepEqual(f.calls.slice(2).map(c => c.receipt.sequence), [1, 2]);
  assert.equal(f.calls.slice(2).reduce((total, c) => total + c.receipt.onlineMs, 0), 32000);
  assert.match(f.messages.at(-1), /已保存/);
  const count = f.calls.length; f.advance(60000); f.emit('update'); assert.equal(f.calls.length, count);
  f.subject.dispose(false); assert.equal(f.listeners.size, 0);
});

test('actual tool queue retains the failed event and UI refresh cannot turn a durable success into save failure', () => {
  const f = fixture(); f.subject.tool('round-1', 'slot');
  assert.equal(f.calls.length, 1); assert.match(f.messages.at(-1), /待保存/);
  f.context.progressPopup = new f.ProgressControl(); f.fail(false);
  assert.doesNotThrow(() => f.subject.flushForExit());
  assert.deepEqual(f.calls.map(c => c.kind), ['tool', 'tool']);
  assert.equal(f.warnings.length, 1); assert.match(f.messages.at(-1), /已保存/);
  f.subject.flushForExit(); assert.equal(f.calls.length, 2, 'successful tool leaves the pending queue');
  f.subject.dispose(false); assert.equal(f.listeners.size, 0);
});
test('a stale feedback setter cannot escape lifecycle callbacks or change durable save success', () => {
  const f = fixture(); f.context.homeView.setFeedback = () => { throw Error('stale feedback'); };
  assert.doesNotThrow(() => f.subject.tool('round-1', 'slot'));
  assert.equal(f.subject.pendingSave, true);
  f.fail(false); assert.doesNotThrow(() => f.subject.flushForExit());
  assert.equal(f.subject.pendingSave, false); assert.equal(f.subject.retryAt, 0);
  const count = f.calls.length; f.advance(1000); f.emit('update'); assert.equal(f.calls.length, count);
  assert.equal(f.warnings.length, 2); f.subject.dispose(false);
});
