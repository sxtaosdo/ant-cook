import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
function load(path,require){const exports={};const source=readFileSync(new URL('../../'+path,import.meta.url),'utf8');runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,useDefineForClassFields:false}}).outputText,{exports,require,console,Error});return exports;}
function fixture(){
 const state={used:[],effects:0,coins:77,inventory:{trowel:3,compass:2},controls:[],feedback:[],flushes:0,recorded:0,result:'PLAYING',target:true};
 const snapshot=()=>({level:1,result:state.result,slots:state.slots,stacks:[],transported:0});state.slots=Array(5).fill(null);
 const apply=tool=>{if(state.used.includes(tool)||!state.target)throw Error('not available');state.effects++;state.used.push(tool);if(tool==='slot')state.slots.push(null);};
 const play={snapshot,usedToolList:()=>state.used.slice(),canUseTool:tool=>state.result==='PLAYING'&&state.target&&!state.used.includes(tool)&&(tool!=='slot'||state.slots.length<6),
 useExtraSlot:()=>apply('slot'),useTrowel:()=>apply('trowel'),useCompass:()=>apply('compass'),lastEventList:()=>[],lastDispatchRoundList:()=>[],suggestedStack:()=>null,selectableQueueExhausted:false,
 feedback:()=>({emptySlots:state.slots.filter(x=>x===null).length,totalSlots:state.slots.length,transportColors:[],pendingDeliveries:0,failureReason:null})};
 const context={generation:1,round:{id:'round-1'},play,destroyed:false,navigating:false,inputLocked:false,progressPopup:null,popupRoot:{},
 app:{error:null,setError(error){this.error=error;}},hudView:{hideRailBackground(){},setFeedback:v=>state.feedback.push(v)},toolBarView:{setUsed(){}},toast:{show(){}},
 dailyActivity:{flush(){state.flushes++;if(state.failFlush)throw Error('isolated save failed');},tool(){state.recorded++;if(state.failRecord)throw Error('isolated record save failed');}},
 guide:{async cancel(){if(state.guideWait)await state.guideWait;}},
 progress:{snapshot:()=>({coins:state.coins,diamonds:11,clearedLevels:[],streak:0,toolInventory:{...state.inventory},supplyTokens:0,rounds:{'round-1':{extraSupply:false}}}),availability:()=>({}),readToolSupply:()=>({inventory:{...state.inventory},extraAvailable:true})}};
 const progressHolder={};const {PlayState}=load('assets/Colony/scripts/presentation/pageStates/playState.ts',id=>id.endsWith('/hardLevelNotice')?{HardLevelNotice:class{}}:id.endsWith('/progressPresentation')?progressHolder:id.endsWith('/gameplayFeedback')?{GameplayFeedbackText:{status:()=>''}}:{});
 const page=new PlayState();page.context=context;context.StateMachine={current:page};page.board={addExtraSlot(){},applyCounts(){}};page.playSound=async()=>{};
 class ConfirmView{}class ToolView{}
 class Control{constructor(_root,nav,viewType){this.nav=nav;this.viewType=viewType;this.isClosing=false;this.busy=false;state.controls.push(this);}async whenOpened(){this.projection=this.nav.read();if(state.openWait)await state.openWait;}async close(){this.isClosing=true;if(state.closeWait)await state.closeWait;if(state.failClose)throw Error('isolated close failed');}async forceClose(){this.nav.closing?.();await this.close();this.nav.closed();}async click(action){if(this.isClosing||this.busy)return;this.busy=true;try{return await this.nav.act(action);}finally{this.busy=false;}}}
 class ToolControl extends Control{}
 const {ProgressPresentation}=load('assets/Colony/scripts/presentation/progressPresentation.ts',id=>id.endsWith('/playState')?{PlayState}:id.endsWith('/progressControl')?{ProgressControl:Control}:id.endsWith('/toolControl')?{ToolControl}:id.endsWith('/confirmView')?{ColonyConfirmView:ConfirmView}:id.endsWith('/toolView')?{ColonyToolView:ToolView}:id.endsWith('/resultPopupNav')?{swallowMkInterrupt:p=>p}:{});progressHolder.ProgressPresentation=ProgressPresentation;
 return {state,context,page,ProgressPresentation,ConfirmView,ToolControl,hold(which){state[which+'Wait']=new Promise(resolve=>state['release'+which]=()=>{state[which+'Wait']=null;resolve();});}};
}
for(const tool of ['slot','trowel','compass'])test(`${tool}: toolbar opens existing confirmation, cancel is free, confirm applies exactly once`,async()=>{
 const f=fixture();await f.page.tapTool(tool);assert.equal(f.state.effects,0);assert.equal(f.state.controls.length,1);
 const first=f.state.controls[0];assert.equal(first.viewType,f.ConfirmView);assert.equal(first.projection.layout,'confirm');
 assert.match(first.projection.rows[0].detail,/免费|0金币|0 金币/);assert.match(first.projection.rows[0].detail,/77/);
 if(tool!=='slot')assert.match(first.projection.rows[0].detail,new RegExp(String(f.state.inventory[tool])));
 await first.click('cancel-tool');assert.equal(f.state.effects,0);assert.deepEqual(f.state.inventory,{trowel:3,compass:2});assert.equal(f.state.coins,77);
 await f.page.tapTool(tool);const confirm=f.state.controls.at(-1);await Promise.all([confirm.click(`confirm-free-tool:${tool}`),confirm.click(`confirm-free-tool:${tool}`)]);
 assert.equal(f.state.effects,1);assert.deepEqual(f.state.used,[tool]);assert.equal(f.state.coins,77);assert.deepEqual(f.state.inventory,{trowel:3,compass:2});
});
test('rapid taps awaiting guide cleanup open one confirmation and zero effects',async()=>{
 const f=fixture();f.hold('guide');const a=f.page.tapTool('trowel'),b=f.page.tapTool('trowel');f.state.releaseguide();await Promise.all([a,b]);assert.equal(f.state.controls.length,1);assert.equal(f.state.effects,0);
});
for(const change of ['generation','round','play','page','terminal','destroyed'])test(`${change} invalidates a shown confirmation without consuming`,async()=>{
 const f=fixture();await f.page.tapTool('trowel');const control=f.state.controls[0];
 if(change==='generation')f.context.generation++;if(change==='round')f.context.round={id:'round-2'};if(change==='play')f.context.play={...f.context.play};if(change==='page')f.context.StateMachine.current={};if(change==='terminal')f.state.result='FAIL';if(change==='destroyed')f.context.destroyed=true;
 await control.click('confirm-free-tool:trowel');assert.equal(f.state.effects,0);assert.equal(f.state.coins,77);
});
test('a target disappearing before confirmation is rejected and no other tool can be forged',async()=>{
 const f=fixture();await f.page.tapTool('trowel');const control=f.state.controls[0];await control.click('confirm-free-tool:slot');assert.equal(f.state.effects,0);f.state.target=false;await control.click('confirm-free-tool:trowel');assert.equal(f.state.effects,0);
});
test('late close completion cannot apply to another round and a failed close never applies',async()=>{
 const f=fixture();await f.page.tapTool('slot');f.hold('close');const wait=f.state.controls[0].click('confirm-free-tool:slot');f.context.generation++;f.context.round={id:'round-2'};f.state.releaseclose();await wait;assert.equal(f.state.effects,0);assert.equal(f.context.inputLocked,true);
 const bad=fixture();await bad.page.tapTool('slot');bad.state.failClose=true;await assert.rejects(bad.state.controls[0].click('confirm-free-tool:slot'),/close failed/);assert.equal(bad.state.effects,0);
});
test('save failure before opening leaves tools untouched; post-effect recording failure never replays the effect',async()=>{
 const f=fixture();f.state.failFlush=true;await f.page.tapTool('slot');assert.equal(f.state.effects,0);assert.equal(f.state.controls.length,0);assert.ok(f.state.feedback.length>0);
 f.state.failFlush=false;await f.page.tapTool('slot');f.state.failRecord=true;const control=f.state.controls[0];await assert.rejects(control.click('confirm-free-tool:slot'),/record save failed/);await control.click('confirm-free-tool:slot');assert.equal(f.state.effects,1);assert.deepEqual(f.state.used,['slot']);
});
test('six-slot relief round disables expansion and used-tool acquisition keeps the original tool popup',async()=>{
 const f=fixture();f.state.slots.push(null);await f.page.tapTool('slot');assert.equal(f.state.controls[0].projection.rows[0].enabled,false);await f.state.controls[0].click('confirm-free-tool:slot');assert.equal(f.state.effects,0);
 const used=fixture();used.state.used.push('trowel');used.state.inventory.trowel=0;await used.page.tapTool('trowel');assert.ok(used.state.controls[0] instanceof used.ToolControl);assert.equal(used.state.effects,0);
});

test('the existing free offer also routes to confirmation while a pending video reward keeps its original gate',async()=>{
 const f=fixture();await f.ProgressPresentation.open(f.context,'tool-trowel');const offer=f.state.controls[0];await offer.click('free-tool:trowel');
 const confirm=f.state.controls.at(-1);assert.equal(confirm.viewType,f.ConfirmView);assert.equal(f.state.effects,0);await confirm.click('cancel-tool');assert.equal(f.state.effects,0);
 await f.page.tapTool('compass');f.context.ads={hasPendingReward:()=>true};await f.state.controls.at(-1).click('confirm-free-tool:compass');assert.equal(f.state.effects,0);assert.ok(f.context.progressPopup);
});
