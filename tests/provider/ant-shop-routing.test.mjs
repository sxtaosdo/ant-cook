import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
function load(path, modules) {
 const exports = {}; const code=ts.transpileModule(readFileSync(new URL('../../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,useDefineForClassFields:false}}).outputText;
 runInNewContext(code,{exports,require:name=>modules[name]??{}});return exports;
}

test('shop requests wait for cold opening, then use the existing controller busy guard', async () => {
 let ready, finish, calls=0; const opened=new Promise(resolve=>{ready=resolve;});
 const Control=load('assets/Colony/popups/progress/script/progressControl.ts',{mk:{default:{MVCControlBase:class{isClosing=false;whenOpened(){return opened;}}}}}).ProgressControl;
 const control=new Control({}, {read:()=>({title:'shop'}),act:async action=>{assert.equal(action,'section:shop');calls++;await new Promise(resolve=>{finish=resolve;});}});
 const first=control.navigateToShop(), second=control.navigateToShop(); assert.equal(calls,0);
 control._model={feedback:'',page:{}};control._view={isAvailable:()=>true,render(){}}; ready();
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);finish();await Promise.all([first,second]);
 control.isClosing=true;await control.navigateToShop();assert.equal(calls,1);
});

test('failed profile binding is destroyed before publication, and the next mount retries', async () => {
 let loads=0,destroyed=0,followed=0,fail=true; const nodes=[];
 const Overlay=class{};
 const module=load('assets/Colony/scripts/presentation/currencyOverlay.ts',{
  cc:{Prefab:class{},instantiate(){const overlay={bind(){},setProfile(){if(fail){fail=false;throw Error('profile binding');}}};const node={destroy(){destroyed++;},setPosition(){},getComponent:()=>overlay};nodes.push(node);return node;}},
  mk:{default:{asset:{get:async()=>{loads++;return{};}},Release:{followRelease(){followed++;},release:async()=>{}}}},
  '../views/currencyOverlayView':{ColonyCurrencyOverlayView:Overlay},'../colonyUtil':{ColonyUtil:{applyUiLayer(){}}},'../application/buildInfo':{COLONY_BUILD_VERSION:'test'},
 });
 const canvas={isValid:true};
 const session={currencyView:null,destroyed:false,node:{parent:canvas},popupRoot:{},profile:{snapshot:()=>({nickname:'name'})},progress:{wallet:()=>({coins:0,diamonds:0})}};
 await assert.rejects(module.mountCurrencyOverlay(session),/profile binding/);assert.equal(session.currencyView,null);assert.equal(destroyed,1);
 await module.mountCurrencyOverlay(session);assert.equal(loads,2);assert.equal(followed,2);assert.equal(destroyed,1);assert.ok(session.currencyView);assert.equal(nodes[1].parent,canvas);
 await module.mountCurrencyOverlay(session);assert.equal(loads,2);
});
