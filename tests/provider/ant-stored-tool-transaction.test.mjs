import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
import {PlayerProgress,PROGRESS_SAVE_KEY,PROGRESS_CALENDAR_START} from '../../assets/Colony/scripts/application/playerProgress.ts';
import {ColonyFlowModel} from '../../assets/Colony/scripts/gameModel.ts';
import {createOperationalCatalog} from '../../assets/Colony/scripts/application/operationalLevels.ts';
import {leaderboardTestConfig,socialTestConfig} from '../ant/support/leaderboardTestConfig.ts';
function playMethods(){
 const path='assets/Colony/scripts/presentation/pageStates/playState.ts',s=ts.createSourceFile(path,readFileSync(new URL('../../'+path,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
 const c=s.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='PlayState'),names=['current','read','refreshToolCounts','commitStoredSupply','finishStoredSupplyPresentation'];
 const members=c.members.filter(n=>n.name&&names.includes(n.name.getText(s)));assert.equal(members.length,names.length);const p=ts.createPrinter();
 return vm.runInNewContext(ts.transpileModule(`class PlayState {${members.map(n=>p.printNode(ts.EmitHint.Unspecified,n,s)).join('\n')}};PlayState`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{Error});
}
test('production stored-supply boundary saves before applying and failed saves leave the actual Model untouched',()=>{
 const values=new Map();let fail=false;const progress=new PlayerProgress({testOnly:true,read:k=>values.get(k)??null,write(k,v){if(fail&&k===PROGRESS_SAVE_KEY)throw Error('disk full');values.set(k,v);}}, {now:()=>PROGRESS_CALENDAR_START},leaderboardTestConfig,socialTestConfig);
 progress.applyTestResources('coins');progress.buyStoredTool('trowel','purchase-a');const round=progress.startRound(1);
 const play=new ColonyFlowModel(createOperationalCatalog());play.reset(1);const State=playMethods(),state=new State(),badges=[];
 state.context={play,progress,round,destroyed:false,app:{error:null},StateMachine:{current:state},toolBarView:{setUsed(...v){badges.push(v);}}};
 assert.throws(()=>state.commitStoredSupply('trowel'),/目标/);assert.equal(progress.snapshot().toolInventory.trowel,1);
 play.useTrowel();const before=play.snapshot();fail=true;assert.throws(()=>state.commitStoredSupply('trowel'),/disk full/);
 assert.deepEqual(play.snapshot(),before);assert.equal(progress.snapshot().toolInventory.trowel,1);assert.equal(progress.snapshot().rounds[round.id].extraSupply,false);
 fail=false;assert.equal(state.commitStoredSupply('trowel'),true);const after=play.snapshot();assert.equal(after.transported,before.transported+1);
 assert.equal(state.commitStoredSupply('trowel'),false);assert.deepEqual(play.snapshot(),after);assert.equal(progress.snapshot().toolInventory.trowel,0);
 assert.equal(badges.at(-1)[2].trowel,0);assert.equal(badges.at(-1)[2].compass,1);
 state.context.StateMachine.current=null;assert.throws(()=>state.commitStoredSupply('trowel'),/对局已变化/);
});
test('toolbar counts only one round-eligible stored tool while total stock remains persisted',()=>{
 const values=new Map();const p=new PlayerProgress({testOnly:true,read:k=>values.get(k)??null,write:(k,v)=>values.set(k,v)}, {now:()=>PROGRESS_CALENDAR_START},leaderboardTestConfig,socialTestConfig);
 p.applyTestResources('coins');for(let n=0;n<5;n++)p.buyStoredTool('trowel','purchase-'+n);const r=p.startRound(1),play=new ColonyFlowModel(createOperationalCatalog());play.reset(1);
 const State=playMethods(),state=new State();let counts;state.context={play,progress:p,round:r,destroyed:false,app:{error:null},StateMachine:{current:state},toolBarView:{setUsed(_used,_slots,v){counts=v;}}};
 state.refreshToolCounts();assert.equal(counts.trowel,2);assert.equal(p.snapshot().toolInventory.trowel,5);
 play.useTrowel();state.refreshToolCounts();assert.equal(counts.trowel,1);state.commitStoredSupply('trowel');assert.equal(counts.trowel,0);assert.equal(p.snapshot().toolInventory.trowel,4);
});
test('production popup close failure retains the committed effect and recovery presents it once',async()=>{
 const values=new Map(),p=new PlayerProgress({testOnly:true,read:k=>values.get(k)??null,write:(k,v)=>values.set(k,v)}, {now:()=>PROGRESS_CALENDAR_START},leaderboardTestConfig,socialTestConfig);
 p.applyTestResources('coins');p.buyStoredTool('trowel','purchase-a');const round=p.startRound(1),game=new ColonyFlowModel(createOperationalCatalog());game.reset(1);game.useTrowel();
 const State=playMethods(),state=new State();let presented=0,closes=0;state.board={};state.presentExtraSupply=async(_tool,read)=>{presented++;assert.ok(read.lastEvents.some(e=>e.phase==='INTERACT'));};
 const context={progress:p,play:game,round,generation:1,destroyed:false,app:{error:null},StateMachine:{current:state},toolBarView:{setUsed(){}}};state.context=context;
 const path='assets/Colony/scripts/presentation/progressPresentation.ts',source=ts.createSourceFile(path,readFileSync(new URL('../../'+path,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true),declaration=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='ProgressPresentation');
 const members=declaration.members.filter(n=>n.name&&['act','close'].includes(n.name.getText(source)));assert.equal(members.length,2);const printer=ts.createPrinter();
 const Presentation=vm.runInNewContext(ts.transpileModule(`class ProgressPresentation {${members.map(n=>printer.printNode(ts.EmitHint.Unspecified,n,source)).join('\n')}};ProgressPresentation`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{PlayState:State,ToolControl:class {},swallowMkInterrupt:promise=>promise,Error,Promise});
 const presentation=new Presentation(),control={async close(){if(++closes<=2)throw Error('close failed');}};presentation.context=context;presentation.control=control;context.progressPopup=control;
 await assert.rejects(presentation.act('stored-supply:trowel'),/close failed/);assert.equal(presented,0);assert.equal(p.snapshot().toolInventory.trowel,0);assert.equal(game.snapshot().transported,2);
 await presentation.act('stored-supply:trowel');assert.equal(presented,1);assert.equal(game.snapshot().transported,2);assert.equal(context.progressPopup,null);
 await presentation.act('stored-supply:trowel');assert.equal(presented,1);assert.equal(Object.keys(p.snapshot().toolTransactions).length,2);
});

test('actual ToolControl/MVC keeps a cleanup-only retry reachable after terminal command cancellation',async()=>{
 const lifecycle=readFileSync(new URL('./lifecycle.test.mjs',import.meta.url),'utf8');
 const fixture=lifecycle.slice(lifecycle.indexOf('function provider('),lifecycle.indexOf('\nconst lazy =')).replace('return { state, ui,','return { load, mocks, state, ui,').replaceAll('import.meta.url',JSON.stringify(new URL('./lifecycle.test.mjs',import.meta.url).href));
 const {dirname,resolve}=await import('node:path');const {fileURLToPath}=await import('node:url');
 const provider=vm.runInNewContext(fixture+';provider',{readFileSync,ts,vm,dirname,resolve,fileURLToPath,URL,framework:fileURLToPath(new URL('../../extensions/MKFramework/assets/MKFramework/Framework/',import.meta.url)),setTimeout,clearTimeout,AggregateError,console});
 const f=provider();let attempts=0,actions=0,closed=0,retry;
 class ToolView extends f.PopupView { showCleanupRetry(callback){retry=callback;return true;} }
 f.mocks.toolView={ColonyToolView:ToolView};f.mocks.toolModel={ToolModel:{async new(){return {page:null,async close(){if(++attempts<=2)throw Error('close failed');}};}}};
 const {ToolControl}=f.load(fileURLToPath(new URL('../../assets/Colony/popups/tool/script/toolControl.ts',import.meta.url)));
 await f.ui.regis(ToolView,'tool',new f.Node(),{poolInitFillNum:0,poolMinHoldNum:0,poolMaxHoldNum:0,parent:f.scene});
 const control=new ToolControl(f.scene,{read:()=>({}),act(){actions++;},closed(){closed++;}});await control.whenOpened();
 await assert.rejects(control.forceClose(),/close failed/);await assert.rejects(control.forceClose(),/close failed/);
 assert.equal(control.isClosing,true);await control.act('stored-supply:trowel');await control.dismiss();assert.equal(actions,0);assert.equal(closed,0);assert.equal(typeof retry,'function');
 await retry();assert.equal(attempts,3);assert.equal(closed,1);assert.equal(control.isClosing,true);
});
