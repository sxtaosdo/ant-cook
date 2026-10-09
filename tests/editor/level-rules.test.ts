import assert from 'node:assert/strict';
import test from 'node:test';
import { ColonyFlowModel } from '../../assets/Colony/scripts/gameModel.ts';
import { GAME_COLORS, validateDevelopmentLevel, type DevelopmentLevelConfig, type DevelopmentLevelGroup } from '../../assets/Colony/scripts/application/levelCatalog.ts';
import { stackPilePosition } from '../../assets/Colony/scripts/presentation/boardGeometry.ts';
import { DraftHistory, initialDraft, reflowGroups, rowMajorOrder, rulesFor, draftDocument, importDraft } from '../../scripts/board-editor/groupsCore.ts';
import { blank } from '../../scripts/board-editor/core.ts';
import { findStableBatchWitness, LevelPipeline } from '../../scripts/board-editor/levelPipeline.ts';
import { csvRows, columns, ruleColumns } from '../../scripts/compileThemeCsv.mjs';

const config = (groups: DevelopmentLevelGroup[], queueColumns: 3 | 4 | 5 = 5): DevelopmentLevelConfig => {
  const colors = groups.flatMap(group => Array<typeof group.color>(group.count).fill(group.color));
  return {level: 1, sourceId: 'accepted-rule-test', shape: 'NIGHT_MARKET', queueColumns, columns: Math.min(10, colors.length), rows: Math.ceil(colors.length / 10),
    cells: colors.map((color, index) => ({id: `cell-${index}`, row: Math.floor(index / 10), column: index % 10, color})), groups};
};
const group = (id: string, color: DevelopmentLevelGroup['color'], pile: number, depth = 0, count = 1): DevelopmentLevelGroup => ({id, color, count, pile, depth});
const move = (events: ReturnType<ColonyFlowModel['dispatchOne']>): string => events.find(event => event.phase === 'MOVE')!.cellId!;

test('queue columns3/4/5 remain independent of five work slots and old five-column coordinates', () => {
  for (const queues of [3, 4, 5] as const) {
    const model = new ColonyFlowModel({levels: [config([group('front','berry',0), group('next','citrus',0,1), group('other','leaf',queues-1)], queues)]});
    assert.equal(model.snapshot().slots.length, 5); assert.equal(model.snapshot().queueColumns, queues);
    model.selectStack('front'); assert.equal(model.snapshot().stacks[1]!.accessible, true); assert.equal(model.snapshot().stacks[2]!.accessible, true);
    const snapshot = model.snapshot(), stack = snapshot.stacks[2]!;
    assert.equal(stackPilePosition(stack, snapshot.stacks, undefined, queues).x, queues === 5 ? 203 : (queues-1)*102/2);
  }
});
test('positive quantities1/60/70/78 are valid and direct model input cannot bypass shared structural guards', () => {
  for (const count of [1,60,70,78]) assert.equal(new ColonyFlowModel({levels:[config([group('large','berry',0,0,count)])]}).snapshot().stacks[0]!.count,count);
  const base = config([group('a','berry',0)]);
  for (const changed of [ {...base, queueColumns:2}, {...base, columns:65}, {...base, groups:[{...base.groups[0], count:0}]},
    {...base, groups:[{...base.groups[0], count:4097}]}, {...base, groups:[{...base.groups[0], count:Number.MAX_SAFE_INTEGER+1}]},
    {...base, groups:[{...base.groups[0], pile:5}]}, {...base, groups:[{...base.groups[0], depth:1}]}]) {
    assert.throws(() => new ColonyFlowModel({levels:[changed as DevelopmentLevelConfig]}));
  }
});
test('mystery reveals only at queue head; same-column consecutive linked members select atomically in configuration order', () => {
  const initial = config([{...group('a','berry',0), linkId:'pair'}, {...group('b','citrus',0,1), linkId:'pair', mystery:true}, group('c','leaf',0,2)]);
  const model = new ColonyFlowModel({levels:[initial]}), before = model.snapshot();
  assert.equal(before.stacks[1]!.revealed, undefined);
  const slots = model.selectStack('b').filter(event => event.phase === 'SLOT');
  assert.deepEqual(slots.map(event => [event.stackId,event.slotIndex]), [['a',0],['b',1]]);
  assert.equal(model.snapshot().stacks[1]!.revealed,true); assert.equal(model.snapshot().stacks[2]!.accessible,true);
  assert.deepEqual(model.reset(), before);
});
test('insufficient linked capacity is a zero-change rejection; nonadjacent empties use stable leftmost assignment', () => {
  const initial = config([group('a','berry',0),group('b','citrus',1),group('c','leaf',2),group('d','plum',3),
    {...group('e','blue',0,1),linkId:'pair'}, {...group('f','gold',1,1),linkId:'pair'}]);
  const model = new ColonyFlowModel({levels:[initial]}); for (const id of ['a','b','c','d']) model.selectStack(id);
  const before = model.snapshot(), events = model.lastEventList(); assert.throws(() => model.selectStack('e'), /enough empty/);
  assert.deepEqual(model.snapshot(),before); assert.deepEqual(model.lastEventList(),events);
  const round = model.dispatchReady().flat();
  for (const id of ['b','d']) model.completeTransport(round.find(event => event.phase === 'MOVE' && event.stackId === id)!.cellId!);
  assert.deepEqual(model.selectStack('f').filter(event => event.phase === 'SLOT').map(event => event.slotIndex),[1,3]);
});
test('ordinary and linked slots release only after all their out-of-order arrivals; duplicate completion cannot clear replacement', () => {
  for (const linked of [false,true]) {
    const initial = config([{...group('a','berry',0,0,2), ...(linked?{linkId:'pair'}:{})}, {...group('b','citrus',1), ...(linked?{linkId:'pair'}:{})},group('c','leaf',2)]);
    const model = new ColonyFlowModel({levels:[initial]}); model.selectStack('a'); if (!linked) model.selectStack('b');
    const first = model.dispatchReady().flat(), second = model.dispatchReady().flat();
    assert.equal(second.some(event => event.phase === 'RELEASE'),false); assert.equal(model.snapshot().slots[0]!.remaining,0);
    const a1 = first.find(event => event.phase === 'MOVE' && event.stackId === 'a')!.cellId!, a2 = move(second), b = first.find(event => event.phase === 'MOVE' && event.stackId === 'b')!.cellId!;
    assert.equal(model.completeTransport(b).some(event => event.phase === 'RELEASE'),true); assert.equal(model.snapshot().slots[1],null);
    assert.equal(model.completeTransport(a2).some(event => event.phase === 'RELEASE'),false); assert.equal(model.snapshot().slots[0]!.stackId,'a');
    assert.equal(model.completeTransport(a1).some(event => event.phase === 'RELEASE'),true);
    model.selectStack('c'); assert.equal(model.snapshot().slots[0]!.stackId,'c'); assert.deepEqual(model.completeTransport(a1),[]); assert.equal(model.snapshot().slots[0]!.stackId,'c');
  }
});
test('key acquisition happens at actual clear, unlock is idempotent, and reset discards all runtime key/reveal state', () => {
  const base = config([group('key-food','berry',0), {...group('locked','citrus',1),lockId:'door',mystery:true}]);
  const initial = {...base,cells:base.cells.map((cell,index)=>index===0?{...cell,keyId:'door'}:cell)};
  const model = new ColonyFlowModel({levels:[initial]}), before=model.snapshot(); model.selectStack('key-food');
  const id=move(model.dispatchOne()); assert.equal(model.snapshot().stacks[1]!.locked,true); assert.deepEqual(model.snapshot().acquiredKeys,[]);
  assert.equal(model.completeTransport(id).filter(event=>event.phase==='UNLOCK').length,1); assert.equal(model.snapshot().stacks[1]!.locked,false);
  assert.deepEqual(model.completeTransport(id),[]); assert.deepEqual(model.reset(),before);
});
test('actual trowel key clear is a legal pending unlock; inaccessible cyclic keys do not keep deadlock alive', () => {
  const base = config([{...group('locked','berry',0,0,2),lockId:'door'}]);
  const initial = {...base,cells:base.cells.map((cell,index)=>index===0?{...cell,keyId:'door'}:cell)};
  const model = new ColonyFlowModel({levels:[initial]}); assert.equal(model.snapshot().result,'PLAYING');
  assert.equal(model.useTrowel().filter(event=>event.phase==='UNLOCK').length,1); model.selectStack('locked'); model.completeTransport(move(model.dispatchOne())); assert.equal(model.snapshot().result,'SUCCESS');
  const blocked={...base,cells:base.cells.map((cell,index)=>index===1?{...cell,keyId:'door'}:cell)};
  assert.equal(new ColonyFlowModel({levels:[blocked]}).snapshot().result,'FAIL');
});
test('all five slots may remain occupied with remaining0 and in-flight reservations without false failure', () => {
  const model=new ColonyFlowModel({levels:[config(GAME_COLORS.slice(0,5).map((color,pile)=>group(`g${pile}`,color,pile)))]});
  for (let index=0;index<5;index++)model.selectStack(`g${index}`);
  const moves=model.dispatchReady().flat().filter(event=>event.phase==='MOVE'); assert.equal(model.snapshot().slots.filter(Boolean).length,5); assert.equal(model.snapshot().result,'PLAYING');
  for(const event of [...moves].reverse())model.completeTransport(event.cellId!); assert.equal(model.snapshot().result,'SUCCESS');
});
test('linked gaps, missing key-lock references, unknown nodes and unsupported capacity are rejected',()=>{
  const a=config([{...group('a','berry',0),linkId:'pair'},group('middle','leaf',0,1),{...group('b','citrus',0,2),linkId:'pair'}]); assert.throws(()=>validateDevelopmentLevel(a,1),/consecutive/);
  assert.throws(()=>validateDevelopmentLevel(config([{...group('locked','berry',0),lockId:'missing'}]),1),/reference/);
  const six=config(GAME_COLORS.slice(0,6).map((color,index)=>({...group(`g${index}`,color,index%5,index===5?1:0),linkId:'six'})));
  assert.throws(()=>validateDevelopmentLevel(six,1),/initialSlots/); assert.doesNotThrow(()=>validateDevelopmentLevel({...six,initialSlots:6},1));
});
test('draft history deep-copies board and initial rules; stable-ID witness remaps after reorder',()=>{
  const board=blank(1,2);board.pixels=['A','B']; const draft={...initialDraft(board),queueColumns:3 as const,groups:[group('a','berry',0),group('b','citrus',1)],cellOrder:rowMajorOrder(board),selectionOrder:['a','b']};
  const history=new DraftHistory(draft),changed=history.current;changed.board.pixels[0]='C';changed.groups=[{...changed.groups[0]!,color:'leaf'},changed.groups[1]!];history.commit(changed);
  changed.groups[0]={...changed.groups[0]!,count:99};history.undo();assert.deepEqual(history.current,draft);history.redo();assert.equal(history.current.groups[0]!.count,1);
  const reorder={...draft,groups:reflowGroups([...draft.groups].reverse())};assert.deepEqual(rulesFor(reorder).selectionOrder,[1,0]);assert.deepEqual(importDraft(draftDocument(draft)),draft);
  assert.throws(()=>importDraft({...draftDocument(draft),slots:[]}),/format|格式/);assert.throws(()=>rulesFor({...draft,board:changed.board}),/match/);
  const unfinished={...draft,groups:[{...draft.groups[0]!,count:2},draft.groups[1]!]};
  assert.deepEqual(importDraft(draftDocument(unfinished)),unfinished);assert.throws(()=>rulesFor(unfinished),/match/);
  assert.throws(()=>importDraft({...draftDocument(draft),groups:[{...draft.groups[0],selected:true},draft.groups[1]]}),/runtime/);
  assert.throws(()=>importDraft({...draftDocument(draft),groups:[{...draft.groups[0],pile:3},draft.groups[1]]}),/pile/);
  assert.throws(()=>importDraft({...draftDocument(draft),groups:[draft.groups[0],{...draft.groups[1],id:'a'}]}),/unique/);
});
test('new CSV metadata preserves other levels and real-model linked/key witness; empty witness invokes bounded search',()=>{
  const board={schema:'colony-board-v1',rows:1,columns:3,boardCells:'ABC'},rules={schema:'colony-level-rules-v2',queueColumns:3,cellOrder:'0.0|0.1|0.2',groups:'A:1:0:0|B:1:1:0|C:1:2:0',groupRules:{'0':{linkId:'pair'},'1':{linkId:'pair',mystery:true},'2':{lockId:'door'}},cellKeys:{'0.0':'door'},selectionOrder:[0,1,2]};
  const candidate=new LevelPipeline().compile(board,rules,7),table=csvRows(candidate.csv);
  assert.deepEqual(table[0],ruleColumns);assert.equal(table.length,13);assert.ok(table.every(row=>row.length===ruleColumns.length));assert.deepEqual(table[1]!.slice(columns.length),['5','{}','{}']);
  assert.equal(candidate.catalog.levels[6]!.queueColumns,3);assert.deepEqual(candidate.witness.trace[0]!.members,['delivery-0','delivery-1']);assert.equal(candidate.witness.transported,3);
  assert.equal(new LevelPipeline().compile(board,{...rules,selectionOrder:[]},7).witness.status,'WITNESS_PASS_STABLE_BATCH');
  const search=findStableBatchWitness(candidate.catalog.levels[6]!,{states:0,milliseconds:0});assert.deepEqual(search,{status:'UNKNOWN',states:0});
});
