import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
function subject(globals) {
  const path='assets/Colony/scripts/presentation/guidePresentation.ts',ast=ts.createSourceFile(path,readFileSync(new URL('../../'+path,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
  const cls=ast.statements.find(n=>ts.isClassDeclaration(n));
  const printed=ts.createPrinter().printNode(ts.EmitHint.Unspecified,cls,ast).replace('export class GuidePresentation','class Subject');
  return vm.runInNewContext(ts.transpileModule(printed+'; Subject',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{...globals,Promise,Error,console});
}
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
test('actual Guide late prefab is released after exit; no mask or owner is created',async()=>{
  let resolve,released=0,instantiated=0;const gate=new Promise(r=>resolve=r);
  const Subject=subject({Prefab:class{},Node:class{},mk:{asset:{get:()=>gate},Release:{release:async()=>released++}},instantiate:()=>{instantiated++;},ColonyGuideView:class{},ColonyUtil:{}});
  const context={generation:1,destroyed:false,homeView:{node:{activeInHierarchy:true,getChildByName:()=>({})}},progress:{readGuide:()=>({status:'pending',segment:0})}};
  const guide=new Subject(context);guide.open('home');await tick();const closed=guide.cancel();context.generation++;resolve({});await closed;
  assert.equal(released,1);assert.equal(instantiated,0);assert.equal(guide.active,null);
});
test('actual cancel synchronously removes input, drains captured run and unloads all old steps',async()=>{
  let release;const running=new Promise(r=>release=r),events=[];
  const Subject=subject({});const guide=new Subject({});const node={active:true,destroy:()=>events.push('destroy')};
  const old={running,view:{node,stop:()=>events.push('stop'),steps:[{unload:()=>events.push('unload')}]}};guide.active=old;
  const closing=guide.cancel();assert.equal(node.active,false);assert.equal(guide.active,null);assert.deepEqual(events,['stop']);
  const fresh={view:{node:{active:true}}};guide.active=fresh;release();await closing;
  assert.equal(guide.active,fresh);assert.equal(fresh.view.node.active,true);assert.deepEqual(events,['stop','unload','destroy']);
});
test('actual Guide view destroy uses cached component owners after engine child traversal is unavailable',()=>{
 const path='assets/Colony/ui/guide/guideView.ts',ast=ts.createSourceFile(path,readFileSync(new URL('../../'+path,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
 const cls=ast.statements.find(n=>ts.isClassDeclaration(n)),printed=ts.createPrinter().printNode(ts.EmitHint.Unspecified,cls,ast).replace('export class ColonyGuideView','class Subject');
 const code=ts.transpileModule(printed+'; Subject',{compilerOptions:{target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText;
 const list=[{stepNum:0,polygon:{isValid:true,unscheduleAllCallbacks(){}}}];let reads=0,invalid=false;
 class Component{getComponentsInChildren(){reads++;if(invalid)throw Error('engine children destroyed');return list;}unscheduleAllCallbacks(){}}
 const Subject=vm.runInNewContext(code,{Component,ccclass:()=>v=>v,property:()=>()=>undefined,ColonyGuideStep:class{},Label:class{},Button:class{},Mask:class{},Node:class{},Vec3:class{}});
 const view=new Subject();view.stop();invalid=true;list[0].polygon.isValid=false;view.onDestroy();assert.equal(reads,1);
});
