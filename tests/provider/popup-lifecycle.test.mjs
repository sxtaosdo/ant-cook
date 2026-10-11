import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return {promise,resolve,reject}; };
const framework = 'extensions/MKFramework/assets/MKFramework/Framework/';
const popup = name => `assets/Colony/popups/${name}/script/${name}`;

// Actual View/Control/Provider source runs here. cc, assets, prefab creation and business IO
// are controlled doubles; real Creator destruction is verified separately in Preview.
function fixture() {
  const errors = [], assets = [];
  class Events {
    handlers = new Map();
    on(key, fn, owner) { const list=this.handlers.get(key)??[]; list.push({fn,owner}); this.handlers.set(key,list); }
    off(key, fn, owner) { if (!fn) this.handlers.delete(key); else this.handlers.set(key,(this.handlers.get(key)??[]).filter(h=>h.fn!==fn||h.owner!==owner)); }
    targetOff(owner) { for (const [key,list] of this.handlers) this.handlers.set(key,list.filter(h=>h.owner!==owner)); }
    emit(key) { return Promise.all((this.handlers.get(key)??[]).map(h=>h.fn.call(h.owner))); }
    owned(owner) { return [...this.handlers.values()].flat().filter(h=>h.owner===owner).length; }
  }
  class Component { isValid=true; node=null; }
  class Label extends Component { string=''; }
  class Sprite extends Component { spriteFrame=null; }
  class Button extends Component { static EventType={CLICK:'click'}; interactable=true; }
  class UITransform extends Component { setContentSize() {} }
  class Widget extends Component { updateAlignment() {} }
  class Color { constructor(...args) { this.args=args; } }
  class Node extends Events {
    static EventType={TOUCH_START:'start',TOUCH_MOVE:'move',TOUCH_END:'end',TOUCH_CANCEL:'cancel'};
    isValid=true; active=true; parent=null; children=[]; components=new Map(); position={x:0,y:0};
    constructor(name='root') { super(); this.name=name; }
    get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
    getChildByName(name) { let child=this.children.find(n=>n.name===name); if(!child){ child=new Node(name); child.parent=this; this.children.push(child); } return child; }
    getComponent(Key) { if(!this.components.has(Key)){ const c=new Key(); c.node=this; this.components.set(Key,c); } return this.components.get(Key); }
    getComponentInChildren(Key) { return this.getChildByName('Text').getComponent(Key); }
    setContentSize() {} setSiblingIndex() {} setPosition() {} setRotationFromEuler() {}
    destroy() { this.isValid=false; this.handlers.clear(); for(const child of this.children)child.destroy(); for(const c of this.components.values()){ c.isValid=false; c.node=null; } }
  }
  class View extends Component {
    event=new Events(); available=true;
    get valid() { return this.available; }
    isAvailable() { return this.available; }
    refreshReward() { this.refreshes=(this.refreshes??0)+1; }
    render() { this.renders=(this.renders??0)+1; }
  }
  class Model { static async new(){return new this();} close(){Object.freeze(this);} }
  class Base { static instance(){return new this();} }
  const cc={Component,Node,Button,Label,Sprite,SpriteFrame:class {},EditBox:class {},Layout:class {},UITransform,Widget,Color,Vec3:class {},
    _decorator:{ccclass:()=>Class=>Class,property:(_target,key)=>key === undefined ? () => {} : undefined}, Tween:{stopAllByTarget(){}},
    tween:()=>({repeatForever(){return this;},to(){return this;},start(){}}),view:{getVisibleSize:()=>({width:750,height:1667})},
    js:{getSuper:Class=>{const parent=Object.getPrototypeOf(Class);return parent?.prototype?parent:null;}}};
  const ui={async open(Class,{init}){const view=new Class();view.node=new Node();view._model=init;return view;},
    async close(view){view.available=false;view.event=null;view.node=null;}};
  const mocks={cc, MKInstanceBase:{default:Base},MKLogger:{mkLog:{error:e=>errors.push(e)}},MKMonitor:{default:{clear(){}}},MKUIManage:{default:ui},
    VScrollView:{VirtualScrollView:class {}},colonyUtil:{ColonyUtil:{applyUiLayer(){}}},
    progressModel:{ProgressModel:Model},toolModel:{ToolModel:Model},resultSuccessModel:{ResultSuccessModel:Model},resultFailModel:{ResultFailModel:Model},
    progressView:{ColonyProgressView:View},toolView:{ColonyToolView:View},resultSuccessView:{ColonyResultSuccessView:View},resultFailView:{ColonyResultFailView:View}};
  const cache=new Map(); let mk;
  function load(relative) {
    const file=resolve(root,relative);
    if(cache.has(file))return cache.get(file).exports;
    const module={exports:{}};cache.set(file,module);
    const source=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,useDefineForClassFields:false}}).outputText;
    const require=name=>{
      if(name==='mk')return {__esModule:true,default:mk};
      const mock=mocks[name]??mocks[name.split('/').at(-1)];if(mock)return {__esModule:true,...mock};
      return load(resolve(dirname(file),name+'.ts'));
    };
    vm.runInNewContext(source,{module,exports:module.exports,require,setTimeout,clearTimeout,console:{error:(...e)=>errors.push(e)},Promise,Set,Map},{filename:file});
    return module.exports;
  }
  const Control=load(framework+'Module/MVC/MVCControlBase.ts').default;
  const tool=load(framework+'@Private/Tool/MKToolFunc.ts').default;
  mk={MVCViewBase:View,StaticViewBase:View,MVCModelBase:Model,MVCControlBase:Control,uiManage:ui,
    asset:{get(){const pending=deferred();assets.push(pending);return pending.promise;}}};
  function view(kind) {
    const Class=load(popup(kind)+'View.ts')[`Colony${kind[0].toUpperCase()+kind.slice(1)}View`];
    const view=new Class();view.node=new Node();
    if(kind.startsWith('result')) {
      view.titleLabel=view.node.getChildByName('Title').getComponent(Label);
      view.detailLabel=view.node.getChildByName('Detail').getComponent(Label);
      view.primaryLabel=view.node.getChildByName('PrimaryLabel').getComponent(Label);
      view.primaryButton=view.node.getChildByName('Primary').getComponent(Button);
      view.homeButton=view.node.getChildByName('Home').getComponent(Button);
      view.init({level:1,transported:2,hasNextLevel:true,daily:false,adAvailable:true,rewardText:'saved'});
    }
    return view;
  }
  return {load,view,Control,tool,View,Model,Node,Button,Label,Sprite,Events,ui,assets,errors};
}

test('actual MK parent-first Settings destruction survives synchronous Cocos field destruction before the child resumes',async()=>{
  const f=fixture(),Class=f.load('assets/Colony/popups/settings/script/settingsView.ts').ColonySettingsView;
  const view=new Class();view.node=new f.Node();view.viewRoot=view.node;
  const button=new f.Node();button.getComponent(f.Button);
  view.bind(button,true,()=>assert.fail('destroyed button must not act'));
  assert.equal(button.owned(view),3);
  f.tool.runParentFunc(view,'onDestroy',true);
  const destroyed=view.onDestroy();
  // Component destruction is synchronous; MK's awaited parent hook resumes later.
  assert.equal(button.owned(view),0);
  view.boundNodes=null;view.viewRoot=null;view.profileEditNode=null;view.node=null;
  await destroyed;
  assert.equal(f.errors.length,0);
  await button.emit('click');
});

test('actual popup late cleanup accepts destructed fields and retains one binding set after reopen',async()=>{
  const f=fixture(),Base=f.load('assets/Colony/popups/progress/script/popupView.ts').ColonyPopupView;
  const button=new f.Node();button.getComponent(f.Button);let actions=0;
  class Popup extends Base { render(){this.bind(button,true,()=>actions++);} }
  const view=new Popup();view.node=new f.Node();
  view.open();view.close();view.open();view.open();
  assert.equal(button.owned(view),3);await button.emit('click');assert.equal(actions,1);
  view.close();assert.equal(button.owned(view),0);
  for(const missing of [null,undefined]) {
    view.boundNodes=missing;assert.doesNotThrow(()=>view.onDisable());assert.doesNotThrow(()=>view.onDestroy());
  }
  assert.equal(f.errors.length,0);
});

for(const kind of ['resultSuccess','resultFail']) {
  test(`actual ${kind} owns every button emitter and survives child-first destruction, partial init and repeated close`, async()=>{
    const f=fixture(), view=f.view(kind);view.open();
    const nodes=[...view.boundNodes];assert.equal(nodes.length,kind==='resultSuccess'?3:2);
    assert(nodes.every(n=>n.owned(view)===1));
    view.primaryButton.node=null;view.homeButton.node=null;
    view.close();view.close();view.onDestroy();
    assert(nodes.every(n=>n.owned(view)===0));assert.equal(view.isAvailable(),false);
    const partial=f.view(kind);partial.primaryButton=null;partial.homeButton=null;partial.onDestroy();partial.onDestroy();
    const dead=f.view(kind);dead.open();const children=[...dead.boundNodes];children.forEach(n=>n.destroy());
    f.tool.runParentFunc(dead,'onDestroy');await dead.onDestroy();assert.equal(f.errors.length,0);
    assert(children.every(n=>n.owned(dead)===0));
    const reused=f.view(kind);reused.open();reused.onDisable();reused.open();
    assert([...reused.boundNodes].every(n=>n.owned(reused)===1));reused.close();
  });
}

test('actual success collection load cannot update a reopened view with the same icon path or report obsolete failures',async()=>{
  const f=fixture(), view=f.view('resultSuccess');view._model.collection={iconPath:'same',name:'fruit',count:1,target:1,collected:1};
  view.open();const old=f.assets[0];view.close();view.open();const fresh=f.assets[1];
  const icon=view.node.getChildByName('ResultPanel').getChildByName('Collection').getChildByName('Icon').getComponent(f.Sprite);
  const current={name:'new'},stale={name:'old'};fresh.resolve(current);await tick();old.resolve(stale);await tick();assert.equal(icon.spriteFrame,current);
  view.close();view.open();const rejected=f.assets[2];view.onDestroy();view.node=null;rejected.reject(Error('obsolete'));await tick();assert.equal(f.errors.length,0);
});

for(const kind of ['tool','progress']) {
  test(`actual ${kind} view detaches stable nodes and remains unavailable after component references are cleared`,()=>{
    const f=fixture(), view=f.view(kind);view.viewRoot=view.node;const node=new f.Node();node.getComponent(f.Button);
    let actions=0;view.bind(node,true,()=>actions++);node.emit('click');assert.equal(actions,1);
    view.close();view.node=null;view.onDestroy();view.onDestroy();node.emit('click');assert.equal(actions,1);assert.equal(node.owned(view),0);assert.equal(view.isAvailable(),false);
  });
}

test('actual MVC captures the emitter, blocks input before close waits, and detaches before model reset even if View.event disappeared',async()=>{
  const f=fixture();let control, events, modelCloses=0;
  class Subject extends f.Control {
    async open(){this._model={close(){modelCloses++;assert.equal(events.owned(control),0);}};this._view=new f.View();events=this._view.event;events.on('action',()=>{},this);}
  }
  control=new Subject();await control.whenOpened();control._view.event=null;
  const first=control.close();assert.equal(control.isClosing,true);assert.equal(first,control.close());await first;
  assert.equal(modelCloses,1);assert.equal(events.owned(control),0);assert.equal(f.errors.length,0);
});

test('actual MVC close during asynchronous opening still detaches the later attached view and closes once',async()=>{
  const f=fixture(), opening=deferred();let events,modelCloses=0;
  class Subject extends f.Control {
    async open(){await opening.promise;this._model={close(){modelCloses++;}};this._view=new f.View();events=this._view.event;events.on('action',()=>{},this);}
  }
  const control=new Subject(), close=control.close();assert.equal(control.isClosing,true);opening.resolve();await close;
  assert.equal(events.owned(control),0);assert.equal(modelCloses,1);assert.equal(f.errors.length,0);
});

for(const kind of ['tool','progress']) {
  test(`actual ${kind} action can close its own popup before async completion without a deadlock, old model write or duplicate notification`,async()=>{
    const f=fixture(), operation=deferred();let control, notifications=0, reads=0;
    const Class=f.load(popup(kind)+'Control.ts')[kind==='tool'?'ToolControl':'ProgressControl'];
    control=new Class(new f.Node(),{read(){reads++;return {rows:[]};},async act(){await control.forceClose();return operation.promise;},closed(){notifications++;}});
    await control.whenOpened();const view=control._view, model=control._model, events=view.event;
    const action=control.act('free-tool:trowel');await tick();assert.equal(control.isClosing,true);assert.equal(notifications,1);assert(Object.isFrozen(model));
    operation.resolve('late feedback');await action;await control.forceClose();assert.equal(notifications,1);assert.equal(reads,1);assert.equal(view.renders,undefined);assert.equal(events.owned(control),0);assert.equal(f.errors.length,0);
  });
}

test('actual result advertising preserves confirmed business reward but never writes the reset model or refreshes a closed view',async()=>{
  const f=fixture(), result=deferred();let granted=0;
  const Class=f.load(popup('resultSuccess')+'Control.ts').ResultSuccessControl;
  const control=new Class({level:1,transported:1,hasNextLevel:true,adAvailable:true},new f.Node(),{onHome(){},onContinue(){},async onAd(){await result.promise;granted+=40;return 'saved';},canAd:()=>true});
  await control.whenOpened();const view=control._view,model=control._model;const task=control.onAd();assert.equal(view.refreshes,1);
  await control.close();result.resolve();await task;assert.equal(granted,40);assert.equal(view.refreshes,1);assert.notEqual(model.rewardText,'saved');assert.equal(f.errors.length,0);
});

for(const kind of ['resultSuccess','resultFail']) {
  test(`actual ${kind} navigation is single shot and suppressed if the gameplay owner expires while closing`,async()=>{
    const f=fixture(), closing=deferred();let current=true,navigation=0;
    f.ui.close=async view=>{await closing.promise;view.available=false;view.event=null;};
    const Class=f.load(popup(kind)+'Control.ts')[kind==='resultSuccess'?'ResultSuccessControl':'ResultFailControl'];
    const control=new Class({level:1,transported:1,hasNextLevel:true},new f.Node(),{onHome(){navigation++;},onContinue(){navigation++;},canNavigate:()=>current});
    await control.whenOpened();const first=control.onHome();const duplicate=control.onHome();await tick();current=false;closing.resolve();await Promise.all([first,duplicate]);assert.equal(navigation,0);
    const active=new Class({level:1,transported:1,hasNextLevel:true},new f.Node(),{onHome(){navigation++;},onContinue(){navigation++;},canNavigate:()=>true});
    await active.whenOpened();await Promise.all([active.onHome(),active.onHome()]);assert.equal(navigation,1);assert.equal(f.errors.length,0);
  });
}

test('actual social icon resolve and reject during close or after destroy never touch the old page',async()=>{
  for(const phase of ['closing','microtask-closing','destroyed','empty-destroyed']) for(const reject of [false,true]) {
    if(phase==='empty-destroyed'&&!reject) continue;
    const f=fixture(),Class=f.load('assets/Colony/popups/social/script/socialView.ts').ColonySocialView;
    const view=new Class();view.node=new f.Node();view.revision=1;view.ownerAvailable=()=>true;
    const item={kind:'stall',id:'stall',count:1,name:'stall',boardPath:'board'};
    const profileRoot=new f.Node();
    view.profileAvatar=profileRoot.getChildByName('Avatar').getComponent(f.Sprite);
    view.profileInitial=profileRoot.getChildByName('Avatar').getChildByName('Initial').getComponent(f.Label);
    view.themeNameLabel=profileRoot.getChildByName('ThemeName').getComponent(f.Label);
    view.emptyLabel=profileRoot.getChildByName('Street').getChildByName('Empty').getComponent(f.Label);
    for(const [property,name] of [['stallSprite','Stall'],['lanternSprite','Lantern'],['signSprite','Sign'],['planterSprite','Planter']])view[property]=profileRoot.getChildByName('Street').getChildByName(name).getComponent(f.Sprite);
    view.produceSprites=Array.from({length:8},(_,index)=>profileRoot.getChildByName('Street').getChildByName(`Produce${index}`).getComponent(f.Sprite));
    view.profileButtons=['Previous','Next','Follow','Like','Message','Request'].map(name=>profileRoot.getChildByName(name));
    view.profileButtonLabels=view.profileButtons.map(node=>node.getChildByName('Text').getComponent(f.Label));
    view.profile({theme:{items:[item],name:'theme',cleared:1,themeIndex:0},partner:{name:'guest'},avatarColor:'#FFFFFF'},1,()=>{});
    const frame=view.stallSprite.spriteFrame;
    let task;
    if(phase==='empty-destroyed') {view.emptyLabel.node.destroy();assert.equal(view.node.isValid,true);assert.equal(view.ownerAvailable(),true);}
    else if(phase!=='destroyed') {
      const Popup=f.load('assets/Colony/popups/social/script/socialPopupView.ts').ColonySocialPopupView;
      const popup=new Popup();popup.node=new f.Node();popup.socialView=view;
      popup.viewRoot=popup.node; view.ownerAvailable=()=>popup.isAvailable();
      if(phase==='microtask-closing') {
        // Same-tick settled image followed by MK Closing invalidation and real parent-first close helper.
        if(reject)f.assets[0].reject(Error('cancelled'));else f.assets[0].resolve({});
        popup.available=false;f.tool.runParentFunc(popup,'close');task=popup.close();
      } else {popup.close();assert.equal(view.boundNodes.size,0);}
      assert.equal(view.node.isValid,true);assert.equal(view.node.activeInHierarchy,true);
    } else {view.onDestroy();view.isValid=false;view.node=null;}
    if(phase!=='microtask-closing') {if(reject)f.assets[0].reject(Error('cancelled'));else f.assets[0].resolve({});}await task;await tick();assert.equal(f.errors.length,0);assert.equal(view.stallSprite.spriteFrame,frame);
  }
});

test('actual construction icon and second-stage board load are fenced by destruction and preserve late failure silence',async()=>{
  for(const stage of ['icon','board','reject']) {
    const f=fixture(),Class=f.load('assets/Colony/scripts/views/constructionView.ts').ColonyConstructionView;
    const view=new Class();view.node=new f.Node();view.revision=1;
    const task=view.projectItem({kind:'stall',id:'stall',count:1,name:'stall',iconPath:'icon',boardPath:'board'},true,1,new f.Node(),new f.Node());
    if(stage==='board'){f.assets[0].resolve({});await tick();assert.equal(f.assets.length,2);}
    view.onDestroy();view.isValid=false;view.node=null;
    if(stage==='reject')f.assets[0].reject(Error('cancelled'));else f.assets.at(-1).resolve({});await task;assert.equal(f.errors.length,0);
  }
});

test('actual toolbar refresh maps existing free-use state to count/plus through 0→1→0 without disabling the original click action',async()=>{
  const f=fixture(),Class=f.load('assets/Colony/scripts/views/toolBarView.ts').ColonyToolBarView;
  const view=new Class();view.node=new f.Node();let clicked=[];
  for(const name of ['trowel','slot','compass']) {
    view[name+'Button']=new f.Node(name).getComponent(f.Button);
    view[name+'Count']=new f.Node(name+'Count').getComponent(f.Button);
  }
  view.bind(tool=>clicked.push(tool),()=>assert.fail('icon must retain its original route'));
  for(const used of [['trowel'],[],['trowel'],['trowel']]) {
    view.setUsed(used);
    const node=view.trowelButton.node;
    const label=node.getChildByName('Status').getComponent(f.Label);
    assert.equal(label.string,used.includes('trowel')?'＋':'1');assert.equal(view.trowelButton.interactable,true);
    await node.emit('click');
  }
  assert.deepEqual(clicked,['trowel','trowel','trowel','trowel']);
});


test('actual shop list callback ignores Closing/model-reset and an older open while children remain active',()=>{
  const f=fixture(), Class=f.load('assets/Colony/popups/shop/script/shopView.ts').ColonyShopView;
  const view=new Class();view.node=new f.Node();
  for(const key of ['titleLabel','summaryLabel','feedbackLabel'])view[key]=new f.Node(key).getComponent(f.Label);
  view.closeButton=new f.Node('Close');view.backButton=new f.Node('Back');
  view.list={renderItemFn:null,refreshList(){},scrollToTop(){}};
  const model={page:{layout:'shop',title:'shop',summary:'',rows:[{action:'starter-diamonds',enabled:true}]},feedback:''};
  view.init(model);view.open();
  let renders=0;const action=new f.Node('Action');
  const card={getComponent:()=>({actionButton:action,render(){renders++;}})};
  const old=view.list.renderItemFn;old(card,0);assert.equal(renders,1);
  assert.equal(view.node.activeInHierarchy,true);view.available=false;
  view._model=new Proxy({}, {get(){throw Error('reset model must not be read');}});
  assert.doesNotThrow(()=>old(card,0));assert.equal(renders,1);
  view.close();view.available=true;view.init(model);view.open();
  assert.doesNotThrow(()=>old(card,0));assert.equal(renders,1);
  view.list.renderItemFn(card,0);assert.equal(renders,2);
  view.close();assert.equal(action.owned(view),0);assert.equal(f.errors.length,0);
});
