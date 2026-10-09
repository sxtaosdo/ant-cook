import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { addBlock, basicExample, changeBlock, colorStatistics, configForDraft, draftProblems, friendlyError, keyForBlock, linkBlocks, moveBlock, prepareDraft, unlockBlock } from '../../scripts/board-editor/groupsView.js';
import { DraftPlaytest } from '../../scripts/board-editor/playtest.js';
import { draftDocument, importDraft, initialDraft } from '../../scripts/board-editor/groupsCore.js';

test('ordinary draft can be played to completion and reset without changing editor draft', () => {
  const draft = basicExample(), before = JSON.stringify(draft), session = new DraftPlaytest(draft);
  assert.deepEqual(draftProblems(draft), []);
  for (const group of draft.groups) session.choose(group.id);
  assert.equal(session.snapshot().result, 'SUCCESS');
  assert.equal(session.snapshot().transported, 3);
  assert.equal(JSON.stringify(draft), before);
  session.reset(); assert.equal(session.snapshot().remainingCells, 3); assert.equal(session.snapshot().result, 'PLAYING');
});
test('empty/add/property changes are private drafts and basic mode supplies food order', () => {
  const empty = initialDraft(); assert.match(draftProblems(empty)[0]!, /上方食物/);
  const added = addBlock(empty, 0); assert.equal(empty.groups.length, 0); assert.equal(added.groups.length, 1);
  const draft = basicExample(); draft.cellOrder = [];
  assert.deepEqual(prepareDraft(draft).cellOrder, ['0.0', '0.1', '0.2']); assert.deepEqual(draft.cellOrder, []);
  assert.deepEqual(prepareDraft(draft, true).cellOrder, []);
  const changed = changeBlock(draft, 'group-1', { color: 'citrus', count: 2 });
  assert.equal(draft.groups[0]!.color, 'berry'); assert.match(draftProblems(changed).join('；'), /统计卡/);
  const stats = colorStatistics(changed);
  assert.deepEqual([stats[0]!.label, stats[0]!.board, stats[0]!.supplied, stats[0]!.status], ['A 莓红', 2, 1, 'short']);
  assert.deepEqual([stats[1]!.label, stats[1]!.board, stats[1]!.supplied, stats[1]!.status], ['B 柑橘', 1, 3, 'extra']);
});
test('moving a block preserves stable identifiers and clears the outdated witness', () => {
  let draft = addBlock(basicExample(), 0); draft.selectionOrder = draft.groups.map(item => item.id);
  const moved = moveBlock(draft, draft.groups.at(-1)!.id, -1);
  assert.equal(moved.groups.filter(item => item.pile === 0)[0]!.id, 'group-4'); assert.deepEqual(moved.selectionOrder, []);
  assert.equal(draft.groups[0]!.id, 'group-1');
});
test('automatic linked/key identifiers support shared locks and isolated real model replay', () => {
  const sample = importDraft(JSON.parse(readFileSync(new URL('../../scripts/board-editor/examples/first-level-draft.json', import.meta.url), 'utf8')));
  const before = JSON.stringify(sample), session = new DraftPlaytest(prepareDraft(sample));
  assert.equal(session.snapshot().stacks.find(item => item.id === 'group-3')!.locked, true);
  session.choose('group-1');
  assert.equal(session.snapshot().stacks.find(item => item.id === 'group-3')!.locked, false);
  session.choose('group-3'); session.choose('group-4'); assert.equal(session.snapshot().result, 'SUCCESS'); assert.equal(JSON.stringify(sample), before);
  let draft = keyForBlock(basicExample(), '0.0', 'group-3');
  draft = keyForBlock(draft, '0.0', 'group-2');
  assert.equal(draft.groups[1]!.lockId, draft.groups[2]!.lockId);
  let unlocked = unlockBlock(draft, 'group-3'); assert.ok(unlocked.cellKeys['0.0']);
  unlocked = unlockBlock(unlocked, 'group-2'); assert.deepEqual(unlocked.cellKeys, {});
  assert.throws(() => keyForBlock(draft, '2.0', 'group-1'), /食物/);
  const linked = linkBlocks(basicExample(), ['group-1', 'group-2']);
  assert.ok(linked.groups[0]!.linkId); assert.equal(linked.groups[0]!.linkId, linked.groups[1]!.linkId);
  assert.throws(() => linkBlocks(linked, ['group-1', 'group-3']), /选齐原有组合/);
});
test('mystery follows real model head reveal and target-slot rules survive memory level remapping', () => {
  let draft = basicExample(); draft.groups = draft.groups.map(item => ({ ...item, mystery: true as const }));
  const session = new DraftPlaytest(draft); assert.ok(session.snapshot().stacks.every(item => item.revealed));
  draft.targetLevel = 8; assert.equal(configForDraft(draft).initialSlots, 6); assert.equal(configForDraft(draft).level, 1);
  draft.targetLevel = 7; assert.equal(configForDraft(draft).initialSlots, 5);
  const roundtrip = importDraft(draftDocument(draft)); assert.deepEqual(roundtrip, draft);
  assert.match(friendlyError(new Error('UNKNOWN: budget exhausted')), /暂时无法判断，仍需试玩/);
  assert.throws(() => importDraft({ ...draftDocument(draft), acquiredKeys: [] }), /初始草稿/);
});
