import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../../assets/Colony/scripts/presentation/progressPresentation.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function presentation(settings, inRound = false) {
  const exports = {};
  runInNewContext(compiled, { exports, require: name => name === './pageStates/playState' ? { PlayState: { current: () => inRound ? {} : null } }
    : name === '../application/buildInfo' ? { COLONY_BUILD_VERSION: 'fixture' } : {} });
  const context = { settings, round: inRound ? { id: 'round' } : null,
    progress: { snapshot: () => ({ clearedLevels: [], streak: 0 }), availability: () => ({}) },
    applyAudioSettings: () => { context.audioApplied++; }, audioApplied: 0,
    openSettingsLink: kind => { context.opened = kind; return '尚未开放'; } };
  return { context, popup: new exports.ProgressPresentation(context, 'settings') };
}

test('settings projects an icon layout and only offers round controls during play', () => {
  for (const inRound of [false, true]) {
    const { popup } = presentation({ snapshot: () => ({ soundEnabled: false, musicEnabled: true }) }, inRound);
    const page = popup.read();
    assert.equal(page.layout, 'settings'); assert.equal(page.rows.length, 0);
    assert.equal(page.summary, ''); assert.equal(page.settings.inRound, inRound);
    assert.equal(page.settings.soundEnabled, false); assert.equal(page.settings.musicEnabled, true);
  }
});

test('audio switches apply saved preference without success text and failed writes do not apply', async () => {
  const state = { soundEnabled: true, musicEnabled: true };
  const { context, popup } = presentation({ snapshot: () => state,
    toggleSound: () => { state.soundEnabled = !state.soundEnabled; },
    toggleMusic: () => { throw Error('disk full'); } });
  assert.equal(await popup.act('toggle-sound'), '');
  assert.equal(state.soundEnabled, false); assert.equal(context.audioApplied, 1);
  await assert.rejects(popup.act('toggle-music'), /disk full/);
  assert.equal(state.musicEnabled, true); assert.equal(context.audioApplied, 1);
});

test('support buttons invoke only their configured destination and preserve pending reward guard', async () => {
  const { context, popup } = presentation({ snapshot: () => ({}) });
  for (const kind of ['feedback', 'agreement', 'privacy']) {
    assert.equal(await popup.act(`settings-link:${kind}`), '尚未开放'); assert.equal(context.opened, kind);
  }
  context.ads = { hasPendingReward: () => true };
  assert.match(await popup.act('settings-link:feedback'), /奖励待保存/);
  assert.equal(context.opened, 'privacy');
});


test('configured support links open the matching HTTPS destination; unavailable links do not open', () => {
  const source = readFileSync(new URL('../../assets/Colony/scripts/bootstrap/colonySceneBootstrap.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const exports = {}, opened = [];
  const cc = { Component: class {}, _decorator: { ccclass: () => target => target, property: (...args) => args.length > 1 ? undefined : () => {} }, sys: { openURL: url => opened.push(url) } };
  runInNewContext(output, { exports, URL, require: name => name === 'cc' ? cc : {} });
  const context = Object.create(exports.ColonySceneBootstrap.prototype);
  context.feedbackUrl = ''; context.userAgreementUrl = ''; context.privacyPolicyUrl = '';
  for (const kind of ['feedback', 'agreement', 'privacy']) assert.match(context.openSettingsLink(kind), /暂未/);
  for (const url of ['bad url', 'http://example.com', 'javascript:alert(1)']) {
    context.feedbackUrl = url; assert.equal(context.openSettingsLink('feedback'), '链接暂不可用');
  }
  assert.equal(opened.length, 0);
  for (const [kind, field] of [['feedback', 'feedbackUrl'], ['agreement', 'userAgreementUrl'], ['privacy', 'privacyPolicyUrl']]) {
    context[field] = 'https://example.com/' + kind;
    assert.equal(context.openSettingsLink(kind), ''); assert.equal(opened.at(-1), context[field]);
  }
  assert.equal(opened.length, 3);
});
