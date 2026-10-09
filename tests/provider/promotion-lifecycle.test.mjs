import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function subject(path, name, members, globals = {}) {
  const ast=ts.createSourceFile(path,readFileSync(new URL('../../'+path,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
  const cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text===name),printer=ts.createPrinter();
  const body=cls.members.filter(n=>members.includes(n.name?.getText(ast))).map(n=>printer.printNode(ts.EmitHint.Unspecified,n,ast)).join('\n');
  return vm.runInNewContext(ts.transpileModule('class Subject {'+body+'}; Subject',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,globals);
}
test('actual Ant qualification requires saved milestone, terminal guide and unobstructed home',()=>{
  const Subject=subject('assets/Colony/scripts/bootstrap/colonySceneBootstrap.ts','ColonySceneBootstrap',['promotionReady']);
  const c=new Subject();let status='pending';c.canLeave=()=> 'ready';c.homeView={node:{activeInHierarchy:true}};
  c.progress={readGuide:()=>({status}),promotionMilestoneReached:()=>true};assert.equal(c.promotionReady(),false);status='skipped';assert.equal(c.promotionReady(),true);
  for(const field of ['destroyed','navigating','inputLocked','progressPopup']){c[field]=true;assert.equal(c.promotionReady(),false);c[field]=false;}
  c.homeView.node.activeInHierarchy=false;assert.equal(c.promotionReady(),false);
});
test('actual Cook qualification excludes secondary pages, unsaved completion and closing',()=>{
  class MapState{};const Subject=subject('assets/bundles/game/GameRoot.ts','GameRoot',['promotionReady'],{MapState});
  const c=new Subject();let map=false;c.canLeave=()=> 'ready';c.bootstrap={StateMachine:{is:s=>map&&s===MapState}};c.application={firstRestaurantSaved:true};
  assert.equal(c.promotionReady(),false);map=true;assert.equal(c.promotionReady(),true);c.application.firstRestaurantSaved=false;assert.equal(c.promotionReady(),false);
  c.application.firstRestaurantSaved=true;c.closing=true;assert.equal(c.promotionReady(),false);
});
test('actual shell checks before page updates and retains save retry, input cover and lifecycle cancellation',()=>{
  class ShellRunningState{};let afterDraw,beforeUpdate,removed;
  const modes=[{id:'ant'},{id:'cook'}];const Subject=subject('assets/shell/productBootstrap.ts','ProductBootstrap',['checkPromotion','offerPromotion','continueCurrent','hideNavigation','onDestroy'],
    {BUILD_MODES:modes,ShellRunningState,director:{once:(event,fn)=>{if(event==='after')afterDraw=fn;else beforeUpdate=fn;},off:(_,fn)=>removed=fn},Director:{EVENT_AFTER_DRAW:'after',EVENT_BEFORE_UPDATE:'before'}});
  const c=new Subject();let offers=0,shown=0,fail=true,declines=0;c.isValid=c.enabledInHierarchy=true;c.navigationEpoch=0;c.StateMachine={is:()=>true};c.coordinator={promotionSource:'ant'};
  c.navigationRoot={activeInHierarchy:false,active:false,isValid:true};c.promotions={canOffer:()=>true,markShown:()=>shown++,decline:()=>{declines++;if(fail)throw Error('quota');}};
  c.navigationView={recommend:target=>{assert.equal(target,'cook');offers++;}};c.revealNavigation=()=>{c.navigationRoot.active=c.navigationRoot.activeInHierarchy=true;};c.setStatus=text=>c.status=text;
  c.checkPromotion();assert.equal(offers,0);beforeUpdate();c.checkPromotion();beforeUpdate();assert.equal(offers,1);assert.equal(shown,1);
  c.continueCurrent();assert.equal(c.navigationRoot.active,true);assert.match(c.status,/未保存/);assert.ok(c.promotion);
  fail=false;c.continueCurrent();assert.equal(declines,2);assert.equal(c.promotion,null);assert.equal(c.navigationRoot.active,true);afterDraw();assert.equal(c.navigationRoot.active,false);
  c.navigationRoot.activeInHierarchy=false;modes.pop();c.checkPromotion();beforeUpdate();assert.equal(offers,1);
  let cancelled=false;c.unschedule=fn=>cancelled=fn===c.checkPromotion;c.onDestroy();assert.equal(cancelled,true);assert.equal(removed,c.offerPromotion);
  c.isValid=false;beforeUpdate();assert.equal(offers,1);
});
