import assert from 'node:assert/strict';
import { linkSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { LevelPipeline } from '../../scripts/board-editor/levelPipeline.ts';
import { compileThemeCsv, csvRows, renderThemeData, themeIds } from '../../scripts/compileThemeCsv.mjs';
import { ColonyFlowModel } from '../../assets/Colony/scripts/gameModel.ts';
import { parseDevelopmentLevelCatalog } from '../../assets/Colony/scripts/application/levelCatalog.ts';

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), 'utf8')) as unknown;
const board = fixture('synthetic-board'), rules = fixture('synthetic-rules');
assert.ok(rules && typeof rules === 'object' && !Array.isArray(rules));
const ruleFields = rules as Record<string, unknown>;
const work = mkdtempSync(join(tmpdir(), 'ant-level-pipeline-test-'));
let sequence = 0;
const fresh = (name: string): string => join(work, `${++sequence}-${name}`);
const generated = 'assets/Colony/scripts/application/operationalThemeData.ts';
const targetCsv = 'assets/Colony/config/themes/tropical-fruit/levels.csv';
const sandbox = (): string => LevelPipeline.createSandbox(fresh('sandbox'));
const rootPipeline = new LevelPipeline();

test('migrated compiler reproduces the authoritative60-level TS byte-for-byte and current NIGHT_MARKET schema validates', () => {
  const data = compileThemeCsv();
  assert.equal(renderThemeData(data), readFileSync(generated, 'utf8'));
  const catalog = parseDevelopmentLevelCatalog({ schema: 'food-hunt-development-level-catalog-v1', levels: data.levels });
  assert.equal(catalog.levels.length, 60); assert.equal(data.themes.length, 5);
  assert.equal(data.themes.flatMap(theme => theme.items).length, 40);
  assert.equal(catalog.levels[6]?.shape, 'NIGHT_MARKET');
});

test('candidate preserves60-level identities and other CSV rows; explicit order and8-cell real-model witness are retained', () => {
  const candidate = rootPipeline.compile(board, rules, 7);
  const before = csvRows(readFileSync(targetCsv, 'utf8'));
  const after = csvRows(candidate.csv);
  for (let row = 0; row < before.length; row++) if (row !== 7) assert.deepEqual(after[row], before[row]);
  assert.equal(candidate.catalog.levels[6]?.sourceId, 'night-market-1/main/7');
  assert.equal(candidate.witness.status, 'WITNESS_PASS_STABLE_BATCH');
  assert.equal(candidate.witness.transported, 8); assert.equal(candidate.witness.initialSlots, 5);
  assert.deepEqual(candidate.catalog.levels[6]?.cells.map(cell => cell.id), ['cell-0-1','cell-0-2','cell-0-3','cell-0-4','cell-1-1','cell-1-2','cell-1-3','cell-1-4']);
  assert.equal(candidate.witness.trace.flatMap(step => step.batches.flat()).length, 8);
  const baseline = compileThemeCsv();
  for (let index = 0; index < 60; index++) if (index !== 6) {
    const level = candidate.catalog.levels[index];
    assert.deepEqual(level?.cells, baseline.levels[index]?.cells.map(cell => ({ id:cell.id,row:cell.row,column:cell.column,color:cell.color })));
    assert.deepEqual(level?.groups, baseline.levels[index]?.groups);
  }
});

test('target Runtime sixth-slot rule comes from existing MAIN_SUPPLY_LEVELS and cannot be overridden', () => {
  const input = { ...ruleFields, initialSlots: 6 };
  assert.equal(rootPipeline.compile(board, input, 8).witness.initialSlots, 6);
  assert.throws(() => rootPipeline.compile(board, rules, 8), /requires6 slots|requires 6 slots/);
  assert.throws(() => rootPipeline.compile(board, input, 7), /requires 5 slots/);
});

test('missing/duplicate/outside order and invalid group count, pile, depth or color balance are rejected', () => {
  for (const change of [
    { cellOrder:'0.1' }, { cellOrder:'0.1|0.1|0.3|0.4|1.1|1.2|1.3|1.4' },
    { cellOrder:'0.1|0.2|0.3|0.4|1.1|1.2|1.3|9.9' },
    { groups:'A:1:0:0|A:1:0:1|B:2:1:0|C:2:2:0|J:2:3:0' },
    { groups:'A:51:0:0|B:2:1:0|C:2:2:0|J:2:3:0' },
    { groups:'A:2:5:0|B:2:1:0|C:2:2:0|J:2:3:0' },
    { groups:'A:2:0:1|B:2:1:0|C:2:2:0|J:2:3:0' },
    { groups:'A:3:0:0|B:2:1:0|C:2:2:0|J:2:3:0' },
  ]) assert.throws(() => rootPipeline.compile(board, { ...ruleFields, ...change }, 7));
});

test('board/rules schemas, unknown fields and incomplete/duplicate solution permutations do not produce false PASS', () => {
  assert.throws(() => rootPipeline.compile({ schema:'colony-board-v1',rows:1,columns:1,boardCells:'.' }, rules, 7), /棋盘为空/);
  for (const change of [{ schema:'bad' }, { sourceId:'replacement' }, { selectionOrder:[] },
    { selectionOrder:[0,0,2,3] }, { selectionOrder:[0,1,2,4] }, { selectionOrder:[-1,1,2,3] }]) {
    assert.throws(() => rootPipeline.compile(board, { ...ruleFields, ...change }, 7));
  }
  assert.throws(() => rootPipeline.compile(board, rules, 61));
});

test('sealed interior/count-correct board rejects the declared deadlock but accepts another explicit5-slot solution; this is no global solver', () => {
  const pattern = 'AAAAAA/ABBBBA/ACCCDA/ADDEEA/AEFFFA/AAAAAA';
  const ring = { schema:'colony-board-v1',rows:6,columns:6,boardCells:pattern };
  const order = pattern.split('/').flatMap((line,row) => [...line].map((_,column) => `${row}.${column}`)).join('|');
  const blocked = { schema:'colony-level-rules-v1',cellOrder:order,
    groups:'B:4:0:0|C:3:1:0|D:3:2:0|E:3:3:0|F:3:4:0|A:20:0:1',selectionOrder:[0,1,2,3,4,5] };
  assert.throws(() => rootPipeline.compile(ring, blocked, 7), /deadlocked/);
  const valid = rootPipeline.compile(ring, { ...blocked,selectionOrder:[0,5,1,2,3,4] }, 7);
  assert.equal(valid.witness.transported, 36);
  assert.equal(rootPipeline.compile(ring, blocked, 8).witness.initialSlots, 6);
});

test('preview on actual source is read-only and production-tree apply is always rejected', () => {
  const before = LevelPipeline.fileHash(generated), csvBefore = LevelPipeline.fileHash(targetCsv);
  const staged = rootPipeline.preview(board, rules, 7, fresh('candidate'));
  const diff = readFileSync(join(staged.plan, '..', 'preview.diff'), 'utf8');
  assert.ok(diff.includes('diff --git') && diff.includes('.AABB/.CCJJ/.....'));
  assert.throws(() => rootPipeline.apply(staged.plan, staged.confirm), /Actual product tree is read-only/);
  assert.equal(LevelPipeline.fileHash(generated), before); assert.equal(LevelPipeline.fileHash(targetCsv), csvBefore);
});

test('explicit marked-sandbox import updates CSV and deterministic runtime TS; actual model loads the imported catalog', () => {
  const root = sandbox(), pipeline = new LevelPipeline(root);
  const staged = pipeline.preview(board, rules, 7, fresh('candidate'));
  pipeline.apply(staged.plan, staged.confirm);
  const data = compileThemeCsv({ inputRoot:join(root,'assets/Colony/config/themes') });
  assert.equal(renderThemeData(data), readFileSync(join(root,generated),'utf8'));
  assert.equal(data.levels[6]?.cells.length, 8);
  const model = new ColonyFlowModel(parseDevelopmentLevelCatalog({ schema:'food-hunt-development-level-catalog-v1',levels:data.levels }));
  assert.equal(model.reset(7).board.length, 8);
  assert.throws(() => pipeline.apply(staged.plan, staged.confirm), /Stale source/);
});

test('stale source and staged tampering reject import before any target write', () => {
  for (const kind of ['source','stage','diff']) {
    const root = sandbox(), pipeline = new LevelPipeline(root);
    const staged = pipeline.preview(board, rules, 7, fresh('candidate'));
    if (kind === 'source') writeFileSync(join(root,generated),readFileSync(join(root,generated),'utf8')+'\n');
    else writeFileSync(join(staged.plan,'..',kind === 'diff' ? 'preview.diff' : 'levels.csv'),'tampered');
    const before = LevelPipeline.fileHash(join(root,generated)), csvBefore = LevelPipeline.fileHash(join(root,targetCsv));
    assert.throws(() => pipeline.apply(staged.plan, staged.confirm), /Stale source|Staged candidate changed/);
    assert.equal(LevelPipeline.fileHash(join(root,generated)),before); assert.equal(LevelPipeline.fileHash(join(root,targetCsv)),csvBefore);
  }
});

test('an edit during recompilation is rejected at the final freshness check with zero target writes', () => {
  const root = sandbox(); let writes = 0;
  class ConcurrentEditPipeline extends LevelPipeline {
    public changeDuringCompile = false;
    public override compile(boardValue: unknown, rulesValue: unknown, level: number): ReturnType<LevelPipeline['compile']> {
      const candidate = super.compile(boardValue, rulesValue, level);
      if (this.changeDuringCompile) writeFileSync(join(root,targetCsv),readFileSync(join(root,targetCsv),'utf8')+'\n');
      return candidate;
    }
  }
  const pipeline = new ConcurrentEditPipeline(root,(path,data) => { writes++; writeFileSync(path,data); });
  const staged = pipeline.preview(board,rules,7,fresh('candidate'));
  const csvBefore = readFileSync(join(root,targetCsv),'utf8'), outputBefore = LevelPipeline.fileHash(join(root,generated));
  pipeline.changeDuringCompile = true;
  assert.throws(() => pipeline.apply(staged.plan,staged.confirm),/Stale source/);
  assert.equal(writes,0);
  assert.equal(readFileSync(join(root,targetCsv),'utf8'),csvBefore+'\n');
  assert.equal(LevelPipeline.fileHash(join(root,generated)),outputBefore);
});

test('unreviewed confirmation and modified code fingerprint are rejected', () => {
  const root = sandbox(), pipeline = new LevelPipeline(root);
  const staged = pipeline.preview(board, rules, 7, fresh('candidate'));
  assert.throws(() => pipeline.apply(staged.plan,'0'.repeat(64)),/Confirm/);
  const plan = LevelPipeline.readJson(staged.plan) as Record<string, unknown>;
  plan.dependencyHashes = { 'assets/Colony/scripts/gameModel.ts': '0'.repeat(64) };
  writeFileSync(staged.plan,JSON.stringify(plan,null,2)+'\n');
  assert.throws(() => pipeline.apply(staged.plan,LevelPipeline.fileHash(staged.plan)),/Stale source/);
});

test('hard-linked sandbox destinations are rejected when the host permits link creation', context => {
  const root = sandbox(), pipeline = new LevelPipeline(root);
  const staged = pipeline.preview(board, rules, 7, fresh('candidate'));
  try { linkSync(join(root,targetCsv),fresh('same-inode.csv')); }
  catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code === 'EPERM' || code === 'EACCES') { context.skip('Host sandbox prohibits hard-link creation; alias check remains unverified here'); return; }
    throw error;
  }
  assert.throws(() => pipeline.apply(staged.plan,staged.confirm),/unaliased regular file/);
});

test('failed second sandbox write rolls both target files back to their original bytes', () => {
  const root = sandbox(); let writes = 0;
  const pipeline = new LevelPipeline(root,(path,data) => { if (++writes === 2) throw Error('simulated disk failure'); writeFileSync(path,data); });
  const staged = pipeline.preview(board, rules, 7, fresh('candidate'));
  const before = LevelPipeline.fileHash(join(root,generated)), csvBefore = LevelPipeline.fileHash(join(root,targetCsv));
  assert.throws(() => pipeline.apply(staged.plan,staged.confirm),/simulated disk failure/);
  assert.equal(LevelPipeline.fileHash(join(root,generated)),before); assert.equal(LevelPipeline.fileHash(join(root,targetCsv)),csvBefore);
});

test('CLI uses explicit sandbox→preview→confirmed apply; invalid options and legacy compiler default never write production', () => {
  const root = fresh('cli-sandbox'), out = fresh('cli-candidate');
  const cli = (args:string[]) => spawnSync(process.execPath,['--import','tsx','scripts/board-editor/compile-level.ts',...args],{ encoding:'utf8' });
  assert.equal(cli(['sandbox','--out',root]).status,0);
  const result = cli(['preview','--project',root,'--board','tests/editor/fixtures/synthetic-board.json','--rules','tests/editor/fixtures/synthetic-rules.json','--level','7','--out',out]);
  assert.equal(result.status,0,result.stderr);
  const ready = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(typeof ready.plan,'string'); assert.equal(typeof ready.confirm,'string');
  assert.equal(cli(['apply','--project',root,'--plan',String(ready.plan),'--confirm',String(ready.confirm)]).status,0);
  assert.equal(cli(['preview','--unknown','x']).status,1);
  const before = LevelPipeline.fileHash(generated);
  const check = spawnSync(process.execPath,['--import','tsx','scripts/compileThemeCsv.mjs'],{ encoding:'utf8' });
  assert.equal(check.status,0,check.stderr); assert.equal(LevelPipeline.fileHash(generated),before);
  assert.equal(themeIds.length,5);
});
