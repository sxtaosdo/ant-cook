import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute selected real class methods, without loading a Creator scene or replacing
// their cleanup logic. The surrounding engine/platform owners are fault-injection IO.
function methods(file, className, names, globals) {
  const source = ts.createSourceFile(file, readFileSync(new URL('../../' + file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === className);
  const printer = ts.createPrinter();
  const members = declaration.members.filter(node => node.name && names.includes(node.name.getText(source)))
    .map(node => printer.printNode(ts.EmitHint.Unspecified, node, source)).join('\n');
  assert.equal(declaration.members.filter(node => node.name && names.includes(node.name.getText(source))).length, names.length);
  const code = ts.transpileModule(`class Subject { ${members} }; Subject`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(code, { ...globals, Promise, Map, AggregateError });
}

test('actual Ant close publishes its task before reentry, orders teardown and retries only failed owners', async () => {
  const calls = []; let root, fail = true, reentry;
  class Success {} class Fail {} class Progress {} class Community {} class Settings {} class Confirm {} class Shop {} class Tools {}
  const Subject = methods('assets/Colony/scripts/bootstrap/colonySceneBootstrap.ts', 'ColonySceneBootstrap', ['close', 'closeModule'], {
    game: { off() { calls.push('off'); } }, Game: { EVENT_HIDE: 'hide', EVENT_SHOW: 'show' },
    mk: { uiManage: { async unregis(Class, owner) { assert.equal(owner, root.popupRoot); calls.push(Class.name); if (Class === Tools && fail) throw Error('pool destroy'); } } },
    ColonyResultSuccessView: Success, ColonyResultFailView: Fail, ColonyProgressView: Progress, ColonyCommunityView: Community,
    ColonySettingsView: Settings, ColonyConfirmView: Confirm, ColonyShopView: Shop, ColonyToolView: Tools,
    ColonyTestBridge: { clear() { calls.push('bridge'); } },
  });
  root = new Subject(); Object.assign(root, { closePromise: null, cleanupSteps: null, generation: 0, popupRoot: {},
    dailyActivity: { dispose() { calls.push('daily'); reentry = root.close('recovery'); } },
    unschedule() {}, ads: { dispose() { calls.push('ads'); } }, progressPopup: { forceClose() { calls.push('popup'); } },
    StateMachine: { releaseAllStates() { calls.push('states'); } } });
  const close = root.close('switch'); assert.equal(close, root.close('recovery'));
  await assert.rejects(close, /cleanup did not complete/); assert.equal(reentry, close);
  assert.equal(root.destroyed, true); assert.equal(root.inputLocked, true);
  assert.ok(calls.indexOf('popup') < calls.indexOf('Success')); assert.equal(root.cleanupSteps.size, 1);
  const before = [...calls]; fail = false; await root.close('recovery');
  assert.deepEqual(calls.slice(before.length), ['Tools']); assert.equal(root.cleanupSteps.size, 0);
  await root.close('recovery'); assert.equal(calls.length, before.length + 1);
});

test('actual Ant cleanup stops before unregister when an active popup close fails', async () => {
  let unregister = 0, attempts = 0, fail = true;
  const Subject = methods('assets/Colony/scripts/bootstrap/colonySceneBootstrap.ts', 'ColonySceneBootstrap', ['close', 'closeModule'], {
    game: { off() {} }, Game: {}, mk: { uiManage: { unregis() { unregister++; } } },
    ColonyResultSuccessView: class {}, ColonyResultFailView: class {}, ColonyProgressView: class {}, ColonyCommunityView: class {},
    ColonySettingsView: class {}, ColonyConfirmView: class {}, ColonyShopView: class {}, ColonyToolView: class {}, ColonyTestBridge: { clear() {} },
  });
  const root = new Subject(); Object.assign(root, { closePromise: null, cleanupSteps: null, generation: 0, popupRoot: {}, unschedule() {},
    progressPopup: { forceClose() { attempts++; if (fail) throw Error('popup close'); } }, StateMachine: { releaseAllStates() {} } });
  await assert.rejects(root.close('switch'), /cleanup did not complete/); assert.equal(unregister, 0);
  fail = false; await root.close('switch'); assert.equal(attempts, 2); assert.equal(unregister, 8);
});

test('actual popup closed callback preserves destroyed input fence and never clears a newer control', () => {
  let navigation, refreshed = 0, callback = 0;
  class Control { constructor(_, nav) { navigation = nav; } }
  const Subject = methods('assets/Colony/scripts/presentation/progressPresentation.ts', 'ProgressPresentation', ['createControl', 'progressViewType'], {
    ProgressControl: Control, ToolControl: Control, CommunityControl: Control, ColonyProgressView: class {}, ColonyCommunityView: class {}, ColonySettingsView: class {},
  });
  const context = { destroyed: true, popupRoot: {}, ads: {}, inputLocked: true,
    play: { snapshot: () => ({ result: 'PLAYING' }) }, homeView: { refresh() { refreshed++; } },
    constructionView: { refreshSocialNotice() { refreshed++; } }, progress: { readSocial: () => ({ unread: 0 }) } };
  const popup = new Subject(); Object.assign(popup, { context, section: 'daily', onClosed() { callback++; } });
  popup.control = popup.createControl(); context.progressPopup = popup.control;
  navigation.closed(); assert.equal(context.progressPopup, null); assert.equal(context.inputLocked, true);
  assert.equal(refreshed, 0); assert.equal(callback, 0);
  const fresh = {}; context.progressPopup = fresh; navigation.closed(); assert.equal(context.progressPopup, fresh);
});

test('actual popup replacement is cancelled while its old close is pending', async () => {
  let instances = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  class Control {
    constructor(_, navigation, viewType) { instances++; this.navigation = navigation; this.viewType = viewType; }
    close() { return gate; }
  }
  const Subject = methods('assets/Colony/scripts/presentation/progressPresentation.ts', 'ProgressPresentation',
    ['createControl', 'progressViewType', 'switchControl'], {
      ProgressControl: Control, ToolControl: Control, CommunityControl: Control, ColonyProgressView: class {}, ColonyCommunityView: class {}, ColonySettingsView: class {},
      swallowMkInterrupt: async value => { await value; },
    });
  const context = { generation: 4, destroyed: false, popupRoot: {}, progressPopup: null };
  const popup = new Subject(); Object.assign(popup, { context, section: 'leaderboard', cancelled: false });
  const old = popup.createControl(); popup.control = old; context.progressPopup = old;
  popup.section = 'settings';
  const switching = popup.switchControl();
  old.navigation.closing();
  release(); await switching;
  assert.equal(instances, 1); assert.equal(popup.control, old); assert.equal(context.progressPopup, old);
  // A late notification from the cancelled owner cannot clear a fresh session's popup.
  const fresh = {}; popup.control = fresh; context.progressPopup = fresh;
  old.navigation.closed(); assert.equal(popup.control, fresh); assert.equal(context.progressPopup, fresh);
});

test('outer partner tab resets a visited profile to its list and preserves the unlock gate', async () => {
  const Social = methods('assets/Colony/scripts/presentation/social/socialPresentation.ts', 'SocialPresentation', ['isProfile', 'act'], {});
  const social = new Social(); social.tab = 'profile';
  const Subject = methods('assets/Colony/scripts/presentation/progressPresentation.ts', 'ProgressPresentation', ['act'], {});
  const popup = new Subject(); let available = true, advances = 0;
  Object.assign(popup, { context: { progress: { socialAvailable: () => available, advanceSocial() { advances++; } } },
    section: 'leaderboard', returnSection: 'leaderboard', socialPresentation: () => social });
  await popup.act('community-tab:social');
  assert.equal(social.tab, 'partners'); assert.equal(popup.section, 'social'); assert.equal(popup.returnSection, null); assert.equal(advances, 1);
  social.tab = 'profile'; await popup.act('community-tab:leaderboard');
  assert.equal(social.tab, 'profile'); assert.equal(popup.section, 'leaderboard');
  available = false; const feedback = await popup.act('community-tab:social');
  assert.ok(feedback.includes('第3关')); assert.equal(social.tab, 'profile'); assert.equal(popup.section, 'leaderboard'); assert.equal(advances, 1);
});
