import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function fixture(){
 class Events{listeners=[];on(type,fn,owner){this.listeners.push({type,fn,owner});}off(type,fn,owner){this.listeners=this.listeners.filter(l=>l.type!==type||l.fn!==fn||l.owner!==owner);}targetOff(owner){this.listeners=this.listeners.filter(l=>l.owner!==owner);}emit(type,event){for(const l of [...this.listeners].filter(l=>l.type===type))l.fn.call(l.owner,event);}}
 class Vec2{constructor(x=0,y=0){this.x=x;this.y=y;}static distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}}
 class Vec3{constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}set(v){Object.assign(this,v);}}
 class Transform{width=88;height=78;convertToNodeSpaceAR(v){return new Vec3((v.x-100)/2,(v.y-60)/2,v.z);}}
 class Component{}
 class Node extends Events{static EventType={TOUCH_START:'start',TOUCH_MOVE:'move',TOUCH_END:'end',TOUCH_CANCEL:'cancel'};position=new Vec3(323,-75);scale=new Vec3(1,1,1);active=true;parent={getComponent:()=>new Transform()};get activeInHierarchy(){return this.active;}getComponent(){return new Transform();}setPosition(x,y,z){this.position=new Vec3(x,y,z);}}
 const game=new Events(),Game={EVENT_HIDE:'hide'},cc={Component,Node,EventTouch:class{},UITransform:Transform,Vec2,Vec3,game,Game,sys:{getSafeAreaRect:()=>({x:20,y:30,width:710,height:1274})},_decorator:{ccclass:()=>Class=>Class}};
 const source=ts.transpileModule(readFileSync(new URL('../../assets/Colony/scripts/views/gmButtonView.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,useDefineForClassFields:false}}).outputText;
 const module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports,require:n=>{assert.equal(n,'cc');return cc;},Math},{filename:'actual-gmButtonView.ts'});
 const button=new module.exports.ColonyGmButtonView();button.node=new Node();let opens=0;button.onLoad();button.bind(true,()=>{opens++;});
 const touch=(type,x,y,id=1)=>button.node.emit(type,{getID:()=>id,getUILocation:()=>new Vec2(x,y)});
 return{button,game,Game,touch,get opens(){return opens;}};
}
test('GM gesture opens once only for its own small completed touch and repeated binding has four listeners',()=>{
 const f=fixture();f.button.bind(true,()=>{});f.button.bind(true,()=>{f.count=(f.count??0)+1;});assert.equal(f.button.node.listeners.length,4);
 f.touch('start',600,200,1);f.touch('start',300,300,2);f.touch('end',300,300,2);assert.equal(f.count,undefined);f.touch('end',606,203,1);assert.equal(f.count,1);f.touch('end',606,203,1);assert.equal(f.count,1);f.button.onDestroy();assert.equal(f.game.listeners.length,0);
});
test('GM does not mistake a displaced END without MOVE, a return drag, CANCEL or background interruption for a click',()=>{
 const f=fixture();f.touch('start',600,200);f.touch('end',630,200);assert.equal(f.opens,0);
 f.touch('start',600,200);f.touch('move',650,250);f.touch('move',600,200);f.touch('end',600,200);assert.equal(f.opens,0);
 f.touch('start',600,200);f.touch('cancel',600,200);f.touch('end',600,200);assert.equal(f.opens,0);
 f.touch('start',600,200);f.game.emit(f.Game.EVENT_HIDE);f.touch('end',600,200);assert.equal(f.opens,0);
});
test('GM clamps the whole button inside safe UI bounds after parent conversion and clears disable/destroy listeners',()=>{
 const f=fixture();f.touch('start',600,200);f.touch('move',5000,5000);const p=f.button.node.position;assert.equal(p.x,265);assert.equal(p.y,577);
 f.button.onDisable();assert.equal(f.button.node.listeners.length,0);f.button.onEnable();assert.equal(f.button.node.listeners.length,4);
 f.button.bind(false,()=>{throw Error('release build gate leaked');});assert.equal(f.button.node.active,false);assert.equal(f.button.node.listeners.length,0);f.button.onDestroy();assert.equal(f.game.listeners.length,0);
});
