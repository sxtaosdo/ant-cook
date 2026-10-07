import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function fixture({shellGate=Promise.resolve(),hold=true}={}){
 class Community{} class Leader{} class Social{}
 const host={name:'mount',isValid:true},log=[],requests=[],registrations=new Map();let page={layout:'leaderboard'},notified=0,failUnregis=false;
 class Control{
  isClosing=false;model;_model;_view;opening;
  constructor(parent,navigation,type){
   this.parent=parent;this.navigation=navigation;this.type=type;this._model=this.model={page:navigation.read(),feedback:''};
   if(type===Community){this._view={contentParent:()=>host,setContentState:(loading,failure='')=>{this.displayState={loading,failure};},render:()=>{}};this.opening=shellGate;}
   else {const io=deferred();requests.push({io,type,control:this});this.opening=io.promise;if(!hold)io.resolve();}
   // The real Provider settles startup failures before close; this port models that boundary.
   this.settled=this.opening.catch(()=>{});
  }
  whenOpened(){return this.opening;}
  refresh(){if(!this.isClosing)this.model.page=this.navigation.read();}
  suspend(){this.suspended=true;}
  async close(){this.isClosing=true;await this.settled;log.push(['close',this.type]);}
 }
 const ui={async regis(type,source,owner){assert.equal(registrations.size,0);registrations.set(type,owner);log.push(['regis',type,source]);},async unregis(type,owner){assert.equal(registrations.get(type),owner);if(failUnregis)throw Error('controlled cleanup failure');registrations.delete(type);log.push(['unregis',type]);}};
 const mocks={mk:{__esModule:true,default:{uiManage:ui}},'./progressControl':{ProgressControl:Control},'./communityView':{ColonyCommunityView:Community},'../../leaderboard/script/leaderboardView':{ColonyLeaderboardView:Leader},'../../social/script/socialPopupView':{ColonySocialPopupView:Social},'../../resultPopupNav':{swallowMkInterrupt:async p=>p}};
 const source=ts.transpileModule(readFileSync(new URL('../../assets/Colony/popups/progress/script/communityControl.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports,require:n=>{assert(n in mocks,n);return mocks[n];},Promise,Error},{filename:'actual-communityControl.ts'});
 const Subject=module.exports.CommunityControl,navigation={read:()=>page,act:action=>{if(action.startsWith('community-tab:'))page={layout:action.split(':')[1]};return '';},closed:()=>{notified++;}};
 const control=new Subject({},navigation);
 return{control,requests,registrations,log,Community,Leader,Social,get notified(){return notified;},set failUnregis(v){failUnregis=v;}};
}
// Actual feature coordinator source; MK controls, registration and asset IO are boundary doubles.
// Creator Preview/artifact acceptance separately proves the engine lifecycle and physical assets.
test('superseded child rejection loads the latest tab and fences the old navigation',async()=>{
 const f=fixture();await f.control.whenOpened();await tick();const old=f.requests[0];assert.equal(old.type,f.Leader);
 await f.control.act('community-tab:social');old.io.reject(Error('old IO failed'));await tick();await tick();
 assert.equal(f.requests.length,2);assert.equal(f.requests[1].type,f.Social);f.requests[1].io.resolve();await f.control.syncing;
 assert.equal(f.control.failure,'');assert.equal(await old.control.navigation.act('community-tab:leaderboard'),'');assert.equal(f.control.model.page.layout,'social');
 await f.control.forceClose();await f.control.forceClose();assert.equal(f.notified,1);assert.equal(f.registrations.size,0);assert.equal(f.log.at(-1)[1],f.Community);
});
test('rapid selections discard stale IO, close then unregister before opening the final content',async()=>{
 const f=fixture();await f.control.whenOpened();await tick();await f.control.act('community-tab:social');await f.control.act('community-tab:leaderboard');f.requests[0].io.resolve();await tick();await tick();
 assert.equal(f.requests.length,2);assert.equal(f.requests[1].type,f.Leader);f.requests[1].io.resolve();await f.control.syncing;
 assert.deepEqual(f.log.slice(0,4).map(x=>x[0]),['regis','close','unregis','regis']);await f.control.forceClose();assert.equal(f.notified,1);
});
test('current content failure remains retryable in the same outer control',async()=>{
 const f=fixture();await f.control.whenOpened();await tick();const shell=f.control.shell;f.requests[0].io.reject(Error('current content failed'));await f.control.syncing;assert.match(f.control.failure,/current content failed/);
 await f.control.act('community-retry');await tick();f.requests[1].io.resolve();await f.control.syncing;assert.equal(f.control.shell,shell);assert.equal(f.control.failure,'');await f.control.forceClose();
});
test('close during child IO retains the shell until all child ownership is released',async()=>{
 const f=fixture();await f.control.whenOpened();await tick();const close=f.control.forceClose();await tick();assert.equal(f.notified,0);assert.equal(f.log.some(x=>x[0]==='close'&&x[1]===f.Community),false);
 f.requests[0].io.resolve();await close;assert.equal(f.registrations.size,0);assert.equal(f.notified,1);assert.equal(f.log.at(-1)[1],f.Community);
});
test('failed unregistration keeps its exact owner for close retry and never reports success early',async()=>{
 const f=fixture({hold:false});await f.control.whenOpened();await f.control.syncing;f.failUnregis=true;
 await assert.rejects(f.control.forceClose(),/controlled cleanup failure/);assert.equal(f.notified,0);assert.equal(f.registrations.size,1);assert.equal(f.control.closed,false);assert(f.control.owner);
 f.failUnregis=false;await f.control.forceClose();assert.equal(f.registrations.size,0);assert.equal(f.notified,1);assert.equal(f.control.closed,true);
});
test('refresh during failed shell startup is handled by its top owner without an orphan rejected sync',async()=>{
 const gate=deferred(),f=fixture({shellGate:gate.promise});f.control.refresh();const opening=f.control.whenOpened();gate.reject(Error('shell failed'));
 await assert.rejects(opening,/shell failed/);await f.control.syncing;await f.control.forceClose();assert.equal(f.requests.length,0);assert.equal(f.notified,1);
});
