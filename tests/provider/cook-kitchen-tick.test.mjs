import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { StateMachine } from '../../extensions/shidai3/assets/runtime/stateMachine.ts';
import { CocosAdapter, CocosComponentLifecycleHost } from '../../extensions/shidai3/assets/adapters/cocos/cocosAdapter.ts';
import { P10CookApplication } from '../../assets/bundles/game/application/P10CookApplication.ts';
import { ModuleEntryGate } from '../../assets/shell/contracts.ts';
import { ProductStorage } from '../../assets/shell/productStorage.ts';

// Actual Host, lifecycle adapter, StateMachine, Application and Presentation; only Creator/asset IO is doubled.
class Transform {
  contentSize={width:750,height:1334};
  setContentSize(width,height){this.contentSize={width,height};}
  getBoundingBoxToWorld(){return {contains:point=>point.target===this.node};}
}
class Sprite {spriteFrame=null;}
Sprite.Type={SIMPLE:0};Sprite.SizeMode={CUSTOM:0};
class Label {string='';}
Label.Overflow={SHRINK:2};
class Node {
  constructor(name=''){this.name=name;this.children=[];this.components=new Map();this.active=true;this.isValid=true;this.layer=33554432;}
  get activeInHierarchy(){return this.active&&(!this.parent||this.parent.activeInHierarchy);}
  addChild(node){node.parent=this;this.children.push(node);}
  addComponent(Type){const c=new Type();c.node=this;this.components.set(Type,c);return c;}
  getComponent(Type){return this.components.get(Type)??null;}
  setPosition(x,y,z=0){this.position=typeof x==='object'?{...x}:{x,y,z};}
  setSiblingIndex(){}
  destroy(){this.isValid=false;for(const c of [...this.children])c.destroy();if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}
}
class Component {enabled=true;}
const frame={originalSize:{width:720,height:1280},isValid:true};
const cc={Component,Node,Label,Sprite,SpriteFrame:class{},JsonAsset:class{},UITransform:Transform,UIOpacity:class{opacity=255;},
  _decorator:{ccclass:()=>Class=>Class,property:()=>()=>{}},Director:{EVENT_AFTER_DRAW:'draw'},director:{once(_,cb){queueMicrotask(cb);}},
  Color:class{constructor(r,g,b,a){Object.assign(this,{r,g,b,a});}},Vec3:class{constructor(x,y,z){Object.assign(this,{x,y,z});}},
  HorizontalTextAlignment:{LEFT:0,CENTER:1,RIGHT:2},VerticalTextAlignment:{CENTER:1},
  input:{on(){},off(){}},Input:{EventType:{TOUCH_END:'touch-end'}},isValid:v=>!!v&&v.isValid!==false&&v.node?.isValid!==false};
cc.Color.WHITE=new cc.Color(255,255,255,255);
const base=fileURLToPath(new URL('../../assets/bundles/game/',import.meta.url));
const rules=JSON.parse(readFileSync(resolve(base,'resources/config/kitchen-rules.json'),'utf8'));
const viewport={width:750,height:1334,topY:643,bottomY:-643};
function fixture(){
  const values=new Map();let current=true;
  ModuleEntryGate.bind({mode:'cook',transactionId:'tick-test',generation:1,source:'launch',
    storage:new ProductStorage({getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},'cook'),
    isCurrent:()=>current,attach(){},ready(){},saveBlocked(){},fail(e){throw e;}});
  const mk={ViewBase:class{},Release:{release(){},followRelease(){}},asset:{async get(path){return path.includes('kitchen-rules')?{json:rules}:frame;}},
    uiManage:{async open(Type){const page=new Type();page.node=new Node('Page');page.node.addComponent(Transform);return page;},async close(){},async unregis(){}}};
  const cache=new Map();
  const mocks={cc,mk:{default:mk},'db://shidai3/index':{StateMachine,CocosAdapter,CocosComponentLifecycleHost},
    P10CookApplication:{P10CookApplication},ViewportLayout:{applyViewportLayout:()=>viewport},
    ScreenArtManifest:{artPathFor:s=>s,SCREEN_ART_MANIFEST:Object.fromEntries(['map','kitchen','pause','result'].map(s=>[s,{overlayAlpha:40}]))}};
  function load(path){
    if(cache.has(path))return cache.get(path).exports;
    const module={exports:{}};cache.set(path,module);
    const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,useDefineForClassFields:false}}).outputText;
    const require=name=>{
      if(mocks[name])return mocks[name];const key=name.split('/').at(-1);
      if(mocks[key])return mocks[key];if(name.endsWith('shell/contracts'))return {ModuleEntryGate};
      const target=name.endsWith('/pageStates')?resolve(dirname(path),name,'index.ts'):resolve(dirname(path),name+'.ts');return load(target);
    };
    vm.runInNewContext(code,{module,exports:module.exports,require,console,queueMicrotask,AggregateError},{filename:path});return module.exports;
  }
  const RealPresentation=load(resolve(base,'presentation/P10CookPresentation.ts')).P10CookPresentation;
  class Presentation extends RealPresentation {
    async initializeResources(){Object.assign(this,{active:true,panelFrame:frame,viewport});}
    showMap(){} // Map visual IO is outside this production tick regression.
    async shutdown(){this.active=false;}
  }
  mocks.P10CookPresentation={P10CookPresentation:Presentation};
  const {GameRoot}=load(resolve(base,'GameRoot.ts'));const root=new GameRoot();root.node=new Node('Module');
  return {root,retire:()=>{current=false;}};
}
const walk=n=>[n,...n.children.flatMap(walk)];
async function settle(root){await root.pageStateTask;await Promise.resolve();await root.presentation.settleRender();}
async function start(){const f=fixture();await f.root.boot();await f.root.routeIntent({type:'p10.start-level',payload:{levelIndex:0}});await settle(f.root);return f;}

test('actual GameRoot tick updates Ready slots and independent patience through KitchenState without another input and reuses nodes',async()=>{
 const {root}=await start();await root.routeIntent({type:'p10.start-cooking',payload:{dishId:'jianbing'}});await settle(root);
 const before=root.presentation.readModel.kitchen.production;const nodes=walk(root.presentation.pageView.node),targets=root.presentation.tapTargets.length;
 assert.equal(before.slots.filter(s=>s.state==='Cooking').length,1);
 root.update(3);await settle(root);
 const model=root.presentation.readModel.kitchen.production;
 assert.equal(model.slots.filter(s=>s.state==='Ready').length,1);
 assert.equal(model.customers[0].patienceRemaining,before.customers[0].patienceRemaining-3);
 assert.equal(model.customers[2].patienceRemaining,before.customers[2].patienceRemaining);
 assert.deepEqual(walk(root.presentation.pageView.node),nodes);assert.equal(root.presentation.tapTargets.length,targets);
 const ready=model.slots.find(s=>s.state==='Ready');assert.match(root.presentation.productionSlotViews.get(ready.id).label.string,/可上菜/);
 await root.close('recovery');
});

test('actual tick preserves pause freeze, completed navigation and closed-host guards',async()=>{
 const {root}=await start();await root.routeIntent({type:'p10.start-cooking',payload:{dishId:'jianbing'}});await settle(root);
 await root.routeIntent({type:'p10.pause',payload:{}});await settle(root);const paused=JSON.stringify(root.presentation.readModel.kitchen);
 root.update(5);await settle(root);assert.equal(JSON.stringify(root.presentation.readModel.kitchen),paused);assert.equal(root.presentation.readModel.screen,'pause');
 await root.routeIntent({type:'p10.resume',payload:{}});await settle(root);root.update(31);await settle(root);
 assert.equal(root.presentation.readModel.screen,'result');const result=root.presentation.readModel.result;
 root.update(1);await settle(root);assert.equal(root.presentation.readModel.result,result);
 await root.close('recovery');assert.doesNotThrow(()=>root.update(3));assert.equal(root.presentation,null);
});