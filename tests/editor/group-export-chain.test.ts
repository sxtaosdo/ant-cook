import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { importBoard, documentFor } from '../../scripts/board-editor/core.js';
import { draftDocument, importDraft, initialDraft, rulesFor } from '../../scripts/board-editor/groupsCore.js';
import { colorStatistics, createLinkGroup, generateBlocks, linkGroupsFor, prepareDraft, toggleLinkMember } from '../../scripts/board-editor/groupsView.js';
import { LevelPipeline } from '../../scripts/board-editor/levelPipeline.ts';
import { compileThemeCsv, renderThemeData, themeIds } from '../../scripts/compileThemeCsv.mjs';
import { ColonyFlowModel } from '../../assets/Colony/scripts/gameModel.ts';
import { parseDevelopmentLevelCatalog, type QueueColumns } from '../../assets/Colony/scripts/application/levelCatalog.ts';

const runtimeUrl = process.env.ANT_EDITOR_CHAIN_URL;
if (runtimeUrl) assert.match(runtimeUrl, /^http:\/\/127\.0\.0\.1:\d+$/, 'Only an explicitly selected local editor is accepted');

for (const columns of [3, 4, 5] as const) {
  test(`whole grouped draft export reaches imported game data and real-model SUCCESS with ${columns} queue columns`, async () => {
    const work = mkdtempSync(join(tmpdir(), `ant-group-export-${columns}-`));
    const production = themeIds.map(id => `assets/Colony/config/themes/${id}/levels.csv`);
    const generated = 'assets/Colony/scripts/application/operationalThemeData.ts';
    const before = new Map([...production, generated].map(path => [path, LevelPipeline.fileHash(path)]));
    const initial = initialDraft(importBoard({ schema: 'colony-board-v1', rows: 1, columns: 5, boardCells: 'ABCLL' }));
    initial.queueColumns = columns satisfies QueueColumns;
    let draft = generateBlocks(initial);
    const first = createLinkGroup(draft), second = createLinkGroup(first.draft);
    draft = second.draft;
    for (const id of ['group-A', 'group-B']) draft = toggleLinkMember(draft, first.id, id);
    for (const id of ['group-C', 'group-L']) draft = toggleLinkMember(draft, second.id, id);
    draft.selectionOrder = draft.groups.map(group => group.id);
    draft = prepareDraft(draft);
    // This is the same whole-draft JSON boundary as Save/Open, not the board-only export.
    const jsonPath = join(work, 'whole-draft.json');
    writeFileSync(jsonPath, JSON.stringify(draftDocument(draft)) + '\n');
    const reopened = importDraft(JSON.parse(readFileSync(jsonPath, 'utf8')));
    assert.deepEqual(reopened, draft);
    assert.deepEqual(linkGroupsFor(reopened).map(group => [group.number, group.members.map(member => member.id)]),
      [[1, ['group-A', 'group-B']], [2, ['group-C', 'group-L']]]);
    assert.deepEqual(colorStatistics(reopened).filter(item => item.board > 0).map(item => [item.label, item.board, item.supplied, item.status]),
      [['A 莓红', 1, 1, 'equal'], ['B 柑橘', 1, 1, 'equal'], ['C 叶绿', 1, 1, 'equal'], ['L 深灰', 2, 2, 'equal']]);
    const rules = rulesFor(reopened);
    assert.equal('editorState' in rules, false);
    assert.deepEqual(rules.selectionOrder, [0, 1, 2, 3]);
    assert.match(rules.groups, /L:2:/);
    assert.deepEqual(Object.values(rules.groupRules).map(value => value.linkId), [first.id, first.id, second.id, second.id]);
    const mismatched = structuredClone(reopened);
    mismatched.groups = mismatched.groups.map(group => group.id === 'group-L' ? { ...group, count: 1 } : group);
    assert.throws(() => rulesFor(mismatched));

    let sandbox: string, candidate: string;
    if (runtimeUrl) {
      const post = (path: string, body: unknown) => fetch(runtimeUrl + path, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: runtimeUrl }, body: JSON.stringify(body) });
      const response = await post('/api/level/preview', { board: documentFor(reopened.board), rules, level: reopened.targetLevel });
      const result = await response.json() as { error?: string; id: string; confirmation: string; sandbox: string; outputRoot: string };
      assert.equal(response.status, 200, result.error);
      sandbox = result.sandbox; candidate = result.outputRoot;
      assert.equal((await post('/api/level/apply', { id: result.id, confirmation: 'unreviewed' })).status, 400);
      const applied = await post('/api/level/apply', { id: result.id, confirmation: result.confirmation });
      assert.equal(applied.status, 200);
      assert.deepEqual(await applied.json(), { imported: sandbox });
      assert.equal((await post('/api/level/apply', { id: result.id, confirmation: result.confirmation })).status, 400);
    } else {
      sandbox = LevelPipeline.createSandbox(join(work, 'sandbox')); candidate = join(work, 'candidate');
      const pipeline = new LevelPipeline(sandbox);
      const preview = pipeline.preview(documentFor(reopened.board), rules, reopened.targetLevel, candidate);
      assert.throws(() => pipeline.apply(preview.plan, 'unreviewed'), /Confirm/);
      pipeline.apply(preview.plan, preview.confirm);
    }
    const witness = JSON.parse(readFileSync(join(candidate, 'validation.json'), 'utf8'));
    assert.equal(witness.status, 'WITNESS_PASS_STABLE_BATCH');
    assert.equal(witness.transported, 5);
    assert.deepEqual(witness.trace.map((step: { members: string[] }) => step.members.length), [2, 2]);
    const compiled = compileThemeCsv({ inputRoot: join(sandbox, 'assets/Colony/config/themes') });
    assert.equal(readFileSync(join(sandbox, generated), 'utf8'), renderThemeData(compiled));
    const module = await import(pathToFileURL(join(sandbox, generated)).href);
    const data = module.OPERATIONAL_THEME_DATA ?? module.default?.OPERATIONAL_THEME_DATA;
    assert.deepEqual(data, compiled, 'Load the actual imported TS artifact, not the preview catalog alone');
    const catalog = parseDevelopmentLevelCatalog({ schema: 'food-hunt-development-level-catalog-v1', levels: data.levels });
    const config = catalog.levels[6]!;
    assert.equal(config.queueColumns ?? 5, columns); // Shared catalog normalizes the legacy five-column default.
    assert.deepEqual(config.groups.map(group => [group.color, group.count, group.linkId]),
      [['berry', 1, first.id], ['citrus', 1, first.id], ['leaf', 1, second.id], ['charcoal', 2, second.id]]);
    const model = new ColonyFlowModel(catalog);
    assert.equal(model.reset(7).queueColumns, columns);
    const completed = new Set<string>();
    for (const index of [0, 2]) {
      const events = model.selectStack(config.groups[index]!.id);
      assert.deepEqual(events.filter(event => event.phase === 'SLOT').map(event => event.stackId),
        config.groups.slice(index, index + 2).map(group => group.id));
      for (let tick = 0; tick < config.cells.length; tick++) {
        const batches = model.dispatchReady(); if (!batches.length) break;
        for (const batch of batches) {
          const move = batch.find(event => event.phase === 'MOVE'); assert.ok(move?.cellId);
          assert.equal(completed.has(move.cellId), false);
          assert.ok(model.completeTransport(move.cellId).some(event => event.phase === 'INTERACT'));
          completed.add(move.cellId);
        }
      }
    }
    assert.equal(model.snapshot().result, 'SUCCESS');
    assert.equal(model.snapshot().remainingCells, 0); assert.equal(completed.size, 5);
    assert.equal(model.snapshot().slots.every(slot => slot === null), true);
    for (const [path, hash] of before) assert.equal(LevelPipeline.fileHash(path), hash, `Production untouched: ${path}`);
  });
}
