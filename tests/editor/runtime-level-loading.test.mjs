import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { RuntimeLevelCatalog } from '../../assets/Colony/scripts/application/runtimeLevelCatalog.ts';
import { ColonyFlowModel } from '../../assets/Colony/scripts/gameModel.ts';
import { createOperationalCatalog } from '../../assets/Colony/scripts/application/operationalLevels.ts';
import { configForDraft, basicExample, prepareDraft } from '../../scripts/board-editor/groupsView.ts';

const seeded = JSON.parse(readFileSync(new URL('../../assets/Colony/config/runtime-levels.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../../assets/Colony/scripts/presentation/pageStates/loadingState.ts', import.meta.url), 'utf8');
function fixture({ preview = true, missing = false, downloadError = null } = {}) {
  let current = structuredClone(seeded); const calls = [], optionsSeen = [];
  class JsonAsset { constructor(json) { this.json = json; this.uuid = 'runtime-levels-test'; } }
  const stale = new JsonAsset(seeded);
  const modules = {
    mk: { default: { asset: { get: async (path) => { calls.push(path); return missing ? null : stale; } } } },
    cc: { JsonAsset, assetManager: { loadAny(request, options, callback) { optionsSeen.push({request, options}); callback(downloadError, new JsonAsset(current)); } } },
    'cc/env': { PREVIEW: preview },
    '../../application/runtimeLevelCatalog': { RuntimeLevelCatalog }, '../../gameModel': { ColonyFlowModel },
  };
  const exports = {};
  const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(compiled, {exports, require: name => modules[name] ?? {}});
  const state = new exports.LoadingState(), session = { destroyed: false, node: {}, catalog: null, play: null };
  return { state, session, calls, optionsSeen, setCurrent: value => {current = value;} };
}

test('initial JSON is gameplay-equivalent to all existing sixty levels', () => {
  assert.deepEqual(RuntimeLevelCatalog.parse(seeded), RuntimeLevelCatalog.parse({schema: seeded.schema, levels: createOperationalCatalog().levels}));
});
test('preview reload reads new JSON rather than cached JsonAsset or static TS', async () => {
  const f = fixture(); await f.state.loadLevelCatalog(f.session);
  const before = f.session.catalog.levels[6].cells.length, changed = structuredClone(seeded);
  const draft = prepareDraft(basicExample(), false), gameplay = configForDraft(draft);
  changed.levels[6] = {...changed.levels[6], ...gameplay, level: 7, sourceId: changed.levels[6].sourceId};
  f.setCurrent(changed); await f.state.loadLevelCatalog(f.session);
  assert.notEqual(f.session.catalog.levels[6].cells.length, before);
  assert.equal(f.session.catalog.levels[6].cells.length, gameplay.cells.length);
  assert.ok(f.session.play instanceof ColonyFlowModel);
  assert.equal(f.calls[0], 'db://assets/Colony/config/runtime-levels.json');
  for (const {options} of f.optionsSeen) {assert.equal(options.reloadAsset,true); assert.equal(options.cacheAsset,false); assert.equal(options.xhrHeader['Cache-Control'],'no-cache');}
});
test('invalid, missing and failed JSON stop loading with a visible error source and no fallback', async () => {
  for (const flags of [{missing:true},{downloadError:new Error('offline')},{}]) {
    const f = fixture(flags); f.setCurrent({schema:seeded.schema,levels:[]});
    await assert.rejects(f.state.loadLevelCatalog(f.session), /关卡JSON/);
    assert.equal(f.session.catalog,null); assert.equal(f.session.play,null);
  }
  assert.match(source, /message\.startsWith\('关卡JSON'\)/);
  assert.doesNotMatch(source,/createOperationalCatalog/);
});
test('build consumes packaged JSON and destroyed sessions never receive a new model', async () => {
  const f = fixture({preview:false}); await f.state.loadLevelCatalog(f.session); assert.equal(f.optionsSeen.length,0);
  const dead = fixture(); dead.session.destroyed = true; await dead.state.loadLevelCatalog(dead.session); assert.equal(dead.session.play,null); assert.equal(dead.optionsSeen.length,0);
});
