import assert from 'node:assert/strict';
import test from 'node:test';
import { GAME_COLORS } from '../../assets/Colony/scripts/application/levelCatalog.js';
import { importBoard } from '../../scripts/board-editor/core.js';
import { DraftHistory, draftDocument, editorStateFor, importDraft, initialDraft, rulesFor } from '../../scripts/board-editor/groupsCore.js';
import { addBlock, basicExample, boardChangedSinceBlocks, changeBlock, clearBlocks, colorLabel, colorStatistics, createLinkGroup, dissolveLinkGroup, draftProblems, enterQueueConfiguration, generateBlocks, keyForBlock, linkGroupsFor, moveBlock, prepareDraft, removeBlock, toggleLinkMember } from '../../scripts/board-editor/groupsView.js';
import { DraftPlaytest } from '../../scripts/board-editor/playtest.js';

const board = (text: string) => importBoard({schema: 'colony-board-v1', rows: 1, columns: text.length, boardCells: text});
test('fixed letters and original names survive filtering, reordering and imports', () => {
  assert.deepEqual(GAME_COLORS.map(colorLabel), ['A 莓红', 'B 柑橘', 'C 叶绿', 'D 紫色', 'E 蓝色', 'F 棕色', 'G 金色', 'H 橙色', 'I 黄色', 'J 白色', 'K 奶油', 'L 深灰']);
  const generated = generateBlocks(initialDraft(board('BLL'))); generated.groups.reverse();
  const stats = colorStatistics(importDraft(draftDocument(generated))).filter(item => item.board > 0);
  assert.deepEqual(stats.map(item => [item.label, item.board, item.supplied, item.status]), [['B 柑橘', 1, 1, 'equal'], ['L 深灰', 2, 2, 'equal']]);
});
test('first explicit entry generates balanced candidates once; render preparation and painting do not fill', () => {
  const original = initialDraft(board('AAB')), snapshot = JSON.stringify(original);
  assert.equal(prepareDraft(original).groups.length, 0); assert.equal(editorStateFor(prepareDraft(original)).autoFillOnEnter, true);
  const generated = enterQueueConfiguration(original);
  assert.equal(JSON.stringify(original), snapshot); assert.equal(generated.groups.length, 2);
  assert.deepEqual(generated.groups.map(item => [item.color, item.count]), [['berry', 2], ['citrus', 1]]);
  assert.deepEqual(enterQueueConfiguration(generated), generated); assert.deepEqual(generateBlocks(generated), generated);
  assert.deepEqual(draftProblems(prepareDraft(generated)), []); assert.deepEqual(generated.selectionOrder, []);
  const session = new DraftPlaytest(prepareDraft(generated)); generated.groups.forEach(item => session.choose(item.id)); assert.equal(session.snapshot().result, 'SUCCESS');
  const all = generateBlocks(initialDraft(board('ABCDEFGHIJKL'))); assert.equal(all.groups.length, 12); rulesFor(prepareDraft(all));
});
test('board edits preserve manual counts, mystery, keys and links and require explicit replacement', () => {
  let draft = generateBlocks(initialDraft(board('AAB')));
  draft = changeBlock(draft, 'group-A', { count: 3, mystery: true }); draft = keyForBlock(draft, '0.0', 'group-B');
  const created = createLinkGroup(draft); draft = toggleLinkMember(created.draft, created.id, 'group-A'); draft = toggleLinkMember(draft, created.id, 'group-B');
  draft.board = board('AAAB'); const preserved = JSON.stringify(draft);
  assert.equal(boardChangedSinceBlocks(draft), true); assert.equal(JSON.stringify(enterQueueConfiguration(draft)), preserved);
  const replaced = generateBlocks(draft); assert.equal(boardChangedSinceBlocks(replaced), false); assert.deepEqual(replaced.cellKeys, {});
  assert.equal(replaced.groups.some(item => item.mystery || item.linkId || item.lockId), false); assert.deepEqual(linkGroupsFor(replaced), []);
  assert.equal(JSON.stringify(draft), preserved);
});
test('clear affects lower blocks and associations only, stays empty on entry and is undoable', () => {
  const generated = generateBlocks(initialDraft(board('AAB'))), history = new DraftHistory(generated);
  history.commit(clearBlocks(generated)); const cleared = history.current;
  assert.deepEqual(cleared.board, generated.board); assert.deepEqual(cleared.cellOrder, generated.cellOrder);
  assert.deepEqual(cleared.groups, []); assert.deepEqual(cleared.cellKeys, {}); assert.deepEqual(cleared.selectionOrder, []);
  assert.deepEqual(enterQueueConfiguration(cleared), cleared);
  history.undo(); assert.deepEqual(history.current, generated); history.redo(); assert.deepEqual(history.current, cleared);
  assert.deepEqual(enterQueueConfiguration(importDraft(draftDocument(cleared))), cleared);
  const manual = removeBlock(addBlock(initialDraft(board('A')), 0), 'group-1'); assert.equal(enterQueueConfiguration(manual).groups.length, 0);
});
test('multiple groups persist empty definitions, stable numbering and unique membership through history and import', () => {
  const first = createLinkGroup(basicExample()), second = createLinkGroup(first.draft);
  let draft = toggleLinkMember(second.draft, first.id, 'group-1');
  assert.match(draftProblems(draft).join(';'), /至少加入2块/); assert.throws(() => rulesFor(draft), /link/i);
  draft = toggleLinkMember(draft, first.id, 'group-2'); draft = toggleLinkMember(draft, second.id, 'group-3');
  const before = JSON.stringify(draft); assert.throws(() => toggleLinkMember(draft, second.id, 'group-1'), /先从原组移出/); assert.equal(JSON.stringify(draft), before);
  const history = new DraftHistory(draft); history.commit(toggleLinkMember(draft, second.id, 'group-3'));
  assert.deepEqual(linkGroupsFor(importDraft(draftDocument(history.current))).map(item => [item.number, item.members.length]), [[1, 2], [2, 0]]);
  history.undo(); assert.equal(linkGroupsFor(history.current)[1]!.members.length, 1); history.redo();
  const dissolved = dissolveLinkGroup(history.current, first.id); assert.deepEqual(linkGroupsFor(dissolved).map(item => item.number), [2]);
  assert.equal(dissolved.groups.some(item => item.linkId === first.id), false); assert.equal(createLinkGroup(dissolved).draft.editorState!.linkGroups.at(-1)!.number, 3);
});
test('same-column gaps and capacity reject atomically, while contiguous links replay through the real model', () => {
  let draft = basicExample(); draft = changeBlock(draft, 'group-2', {pile: 0}); draft = changeBlock(draft, 'group-3', {pile: 0});
  const made = createLinkGroup(draft); draft = toggleLinkMember(made.draft, made.id, 'group-1'); const before = JSON.stringify(draft);
  assert.throws(() => toggleLinkMember(draft, made.id, 'group-3'), /第1列不连续/); assert.equal(JSON.stringify(draft), before);
  draft = toggleLinkMember(draft, made.id, 'group-2'); const linked = JSON.stringify(draft);
  assert.throws(() => moveBlock(draft, 'group-2', 1), /不连续/); assert.equal(JSON.stringify(draft), linked);
  const session = new DraftPlaytest(draft); session.choose('group-1'); session.choose('group-3'); assert.equal(session.snapshot().result, 'SUCCESS');
  let six = basicExample(); while (six.groups.length < 6) six = addBlock(six, six.groups.length % 3);
  const group = createLinkGroup(six); six = group.draft;
  for (const member of six.groups.slice(0, 5)) six = toggleLinkMember(six, group.id, member.id);
  const capacity = JSON.stringify(six); assert.throws(() => toggleLinkMember(six, group.id, six.groups[5]!.id), /最多容纳5块/); assert.equal(JSON.stringify(six), capacity);
});
test('deleting one member keeps other links and shared keys; dangling singleton is explicit', () => {
  const created = createLinkGroup(basicExample()); let draft = toggleLinkMember(created.draft, created.id, 'group-1'); draft = toggleLinkMember(draft, created.id, 'group-2');
  draft = keyForBlock(draft, '0.0', 'group-1'); draft = keyForBlock(draft, '0.0', 'group-2');
  const removed = removeBlock(draft, 'group-1'); assert.equal(removed.groups.find(item => item.id === 'group-2')!.linkId, created.id);
  assert.ok(removed.cellKeys['0.0']); assert.match(draftProblems(removed).join(';'), /至少加入2块/);
  const last = removeBlock(removed, 'group-2'); assert.deepEqual(last.cellKeys, {}); assert.equal(linkGroupsFor(last)[0]!.members.length, 0);
});
test('draft-only metadata never reaches runtime rules; legacy and intentionally empty imports never auto-fill', () => {
  const saved = draftDocument(initialDraft(board('A'))), imported = importDraft(saved); assert.equal(enterQueueConfiguration(imported).groups.length, 0);
  const {editorState: _state, ...legacy} = saved; assert.equal(enterQueueConfiguration(importDraft(legacy)).groups.length, 0);
  assert.throws(() => importDraft({...saved, editorState: {...saved.editorState, linkGroups: [{id: 'g', number: 1}, {id: 'h', number: 1}]}}), /不能重复/);
  assert.throws(() => importDraft({...saved, editorState: {...saved.editorState, runtime: {}}}), /编辑状态/);
  assert.throws(() => importDraft({...saved, inFlight: []}), /初始草稿/);
  const rules = rulesFor(prepareDraft(generateBlocks(initialDraft(board('A'))))); assert.equal('editorState' in rules, false);
});
