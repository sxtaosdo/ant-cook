import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { PlayerProgress, PROGRESS_SAVE_KEY, PROGRESS_CALENDAR_START } from '../../assets/Colony/scripts/application/playerProgress.ts';
import { leaderboardTestConfig, socialTestConfig } from '../ant/support/leaderboardTestConfig.ts';

function actualMethods(file, className, names, globals) {
  const source = ts.createSourceFile(file, readFileSync(new URL('../../' + file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === className);
  const members = declaration.members.filter(node => node.name && names.includes(node.name.getText(source)));
  assert.equal(members.length, names.length);
  const printer = ts.createPrinter();
  const body = members.map(node => printer.printNode(ts.EmitHint.Unspecified, node, source)).join('\n');
  const code = ts.transpileModule(`class ${className} {${body}}; ${className}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(code, { ...globals, Error, Promise });
}

test('production goHome settlement retry delivers the persisted partner notice once on the safe home page', async () => {
  const values = new Map(); let fail = false;
  const progress = new PlayerProgress({ read: key => values.get(key) ?? null, write(key, value) {
    if (fail && key === PROGRESS_SAVE_KEY) throw Error('disk full'); values.set(key, value);
  } }, { now: () => PROGRESS_CALENDAR_START }, leaderboardTestConfig, socialTestConfig);
  for (let level = 1; level <= 2; ++level) { const round = progress.startRound(level); progress.settleRound(round.id, 'SUCCESS', 1); }
  const round = progress.startRound(3), messages = [];
  const Presentation = actualMethods('assets/Colony/scripts/presentation/progressPresentation.ts', 'ProgressPresentation', ['notifyPartnerUnlock'], {});
  const Home = actualMethods('assets/Colony/scripts/presentation/pageStates/homeState.ts', 'HomeState', ['enter'], { ProgressPresentation: Presentation });
  const Play = actualMethods('assets/Colony/scripts/presentation/pageStates/playState.ts', 'PlayState', ['settleCurrent', 'current', 'goHome'], { HomeState: Home });
  const context = { destroyed: false, navigating: false, generation: 1, progress, round, catalog: null,
    play: { snapshot: () => ({ result: context.round ? 'SUCCESS' : 'PLAYING', transported: 1 }), usedToolList: () => [], reset() {} },
    toast: { show: message => messages.push(message) }, hudView: { setFeedback() {}, hideLevelRail() {} },
    homeView: { setVisible() {}, refresh() {}, bind() {} }, refreshProfile() {},
    app: { error: null, setError(error) { this.error = error; }, clearError() { this.error = null; } },
    StateMachine: { current: null, async changeState(Type) { const state = new Type(); state.context = context; state.enter(); } } };
  fail = true; await Play.goHome(context);
  assert.equal(context.round, round); assert.equal(progress.socialAvailable(), false); assert.deepEqual(messages, []);
  fail = false; await Play.goHome(context);
  assert.equal(context.round, null); assert.equal(progress.socialAvailable(), true); assert.equal(messages.length, 1);
  assert.match(messages[0], /伙伴已解锁/); assert.equal(progress.takePartnerUnlockNotice(), null);
  await Play.goHome(context); assert.equal(messages.length, 1);
  assert.equal(progress.wallet().coins, 120);
});
