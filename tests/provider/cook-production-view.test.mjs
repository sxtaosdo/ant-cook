import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the real View/Presentation with Cocos drawing and MK asset IO doubled.
class Transform {
  contentSize = { width: 750, height: 1334 };
  setContentSize(width, height) { this.contentSize = { width, height }; }
  getBoundingBoxToWorld() { return { contains: point => point.target === this.node }; }
}
class Sprite { spriteFrame = null; }
Sprite.Type = { SIMPLE: 0 }; Sprite.SizeMode = { CUSTOM: 0 };
class Label { string = ''; }
Label.Overflow = { SHRINK: 2 };
class Opacity { opacity = 255; }
class Node {
  constructor(name = '') { this.name = name; this.children = []; this.components = new Map(); this.active = true; this.isValid = true; this.layer = 33554432; }
  get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
  addChild(node) { node.parent = this; this.children.push(node); }
  addComponent(Type) { const component = new Type(); component.node = this; this.components.set(Type, component); return component; }
  getComponent(Type) { return this.components.get(Type) ?? null; }
  setPosition(x, y, z = 0) { this.position = typeof x === 'object' ? { ...x } : { x, y, z }; }
  setSiblingIndex() {}
  destroy() { this.isValid = false; for (const child of [...this.children]) child.destroy(); if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
}
const frame = { originalSize: { width: 720, height: 1280 }, isValid: true };
const assetReads = [];
const cc = { _decorator: { ccclass: () => Class => Class, property: () => () => {} }, Node, Label, Sprite,
  SpriteFrame: class {}, UITransform: Transform, UIOpacity: Opacity,
  Color: class { constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } },
  Vec3: class { constructor(x, y, z) { Object.assign(this, { x, y, z }); } },
  HorizontalTextAlignment: { LEFT: 0, CENTER: 1, RIGHT: 2 }, VerticalTextAlignment: { CENTER: 1 },
  input: { on() {}, off() {} }, Input: { EventType: { TOUCH_END: 'touch-end' } },
  isValid: value => Boolean(value) && value.isValid !== false && value.node?.isValid !== false };
cc.Color.WHITE = new cc.Color(255, 255, 255, 255);
const mk = { ViewBase: class {}, asset: { async get(path) { assetReads.push(path); return frame; } },
  Release: { release() {}, followRelease() {} } };
function load(name, mocks = {}) {
  const exports = {};
  const path = new URL('../../assets/bundles/game/presentation/' + name + '.ts', import.meta.url);
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, experimentalDecorators: true, useDefineForClassFields: false } }).outputText;
  vm.runInNewContext(code, { exports, require: id => {
    if (id === 'cc') return cc;
    if (id === 'mk') return { default: mk };
    if (mocks[id]) return mocks[id];
    throw Error('Unresolved presentation import: ' + id);
  }, console, AggregateError });
  return exports;
}
const { KitchenFlowScreenGroup } = load('KitchenFlowScreenGroup');
const { P10CookPresentation } = load('P10CookPresentation', {
  './KitchenFlowScreenGroup': { KitchenFlowScreenGroup }, './MapFlowScreenGroup': { MapFlowScreenGroup: class {} },
  './SettingsFlowScreenGroup': { SettingsFlowScreenGroup: class {} }, './ProgressionScreenGroup': { ProgressionScreenGroup: class {} },
  '../ui/ViewportLayout': {}, '../ui/ScreenArtManifest': {
    artPathFor: screen => screen, SCREEN_ART_MANIFEST: { kitchen: { overlayAlpha: 36 }, pause: { overlayAlpha: 112 }, result: { overlayAlpha: 40 }, upgrade: { overlayAlpha: 40 } },
  },
});
const viewport = { width: 750, height: 1334, topY: 643, bottomY: -643 };
function model() {
  return { screen: 'pause', progress: { coins: 42, totalStars: 6, settings: { reducedMotion: false } },
    kitchen: { servedOrders: 2, remainingSeconds: 12.2, combo: 1,
      orders: [{ state: 'Pending', dishId: 'jianbing', patienceRemaining: 9, patienceMax: 10 }, {}, {}, {}] },
    level: { dishPool: ['jianbing', 'soy_milk', 'tea_egg'] },
    selection: { restaurantIndex: 0, levelIndex: 0 },
    catalog: { restaurants: [{ id: 'r0', name: '煎饼早餐', levelIds: ['level0', 'level1'] }] },
    lastSuccess: false, result: null };
}
function fixture({ fixed = true } = {}) {
  const view = new KitchenFlowScreenGroup(); view.node = new Node('KitchenFlowGroup'); view.node.addComponent(Transform);
  const add = name => { const node = new Node(name); view.pauseRoot.addChild(node); node.addComponent(Transform); return node; };
  if (fixed) {
    view.pauseRoot = new Node('PauseRoot'); view.node.addChild(view.pauseRoot); view.pauseRoot.addComponent(Transform);
    view.pauseHeaderRoot = add('Header'); view.pauseTransition = add('Transition');
    view.pauseBackground = add('Background').addComponent(Sprite); view.pauseBackground.spriteFrame = frame;
    view.pauseCurrencyLabel = add('Currency').addComponent(Label); view.pauseSummaryLabel = add('Summary').addComponent(Label);
    for (const [key, y] of [['pauseResumeButton', -10], ['pauseRestartButton', -125], ['pauseExitButton', -230]]) {
      view[key] = add(key); view[key].setPosition(0, y, 0);
    }
  }
  const intents = []; let enabled = true;
  const presentation = new P10CookPresentation(new Node('Module'), { publish: intent => intents.push(intent) },
    { canReceiveInput: () => enabled });
  Object.assign(presentation, { pageView: view, active: true, viewport, panelFrame: frame, readModel: model() });
  return { view, presentation, intents, setEnabled(v) { enabled = v; },
    tap(node) { presentation.handlePointer({ getUILocation: () => ({ target: node }) }); } };
}
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }


function productionModel() {
 const value=model(); value.screen='kitchen'; value.kitchen.status='Running'; value.kitchen.production={
 recipes:[{dishId:'jianbing',label:'煎饼'},{dishId:'soy_milk',label:'豆浆'}],
 slots:[{id:'grill-0',stationId:'grill',dishId:'jianbing',state:'Cooking',remainingSeconds:2.2,burnRemainingSeconds:null},
 {id:'grill-1',stationId:'grill',dishId:'jianbing',state:'Ready',remainingSeconds:0,burnRemainingSeconds:4},
 {id:'drink-0',stationId:'drink',dishId:'soy_milk',state:'Burnt',remainingSeconds:0,burnRemainingSeconds:0}],
 customers:[{id:'c1',state:'Active',patienceRemaining:8,patienceMax:10,items:[{id:'i1',dishId:'jianbing',state:'Pending'}]},
 {id:'c2',state:'Active',patienceRemaining:1,patienceMax:10,items:[{id:'i2',dishId:'soy_milk',state:'Pending'},{id:'i3',dishId:'tea_egg',state:'Served'}]},
 {id:'c3',state:'Waiting',patienceRemaining:10,patienceMax:10,items:[{id:'i4',dishId:'tea_egg',state:'Pending'}]}],
 baseCoins:7,comboCoins:2,earnedCoins:9,burntCount:1,discardedCount:0,elapsedSeconds:4,configSource:'mixed-historical-and-project-defaults',
 goal:{mode:'timed',metric:'coins',target:30,current:9}}; return value;
}
function productionFixture() { const f=fixture({fixed:false}); f.presentation.readModel=productionModel(); f.presentation.showKitchen();return f; }
function nodes(root) { return [root,...root.children.flatMap(nodes)]; }
function button(f,text) { return nodes(f.view.node).find(n=>n.name===`Button_${text}`); }
function texts(f) { return nodes(f.view.node).flatMap(n=>n.getComponent(Label)?.string??[]); }

test('production page renders independent customer patience, real slot states and separated earned coins without snapshot writes',async()=>{
 const f=fixture({fixed:false});f.presentation.readModel=freeze(productionModel()); const before=JSON.stringify(f.presentation.readModel);
 f.presentation.showKitchen();await f.presentation.artTask;
 const labels=texts(f).join('\n');assert.match(labels,/基础 7.*连击 2.*本局 9/);assert.match(labels,/80%/);assert.match(labels,/10%/);
 assert.match(labels,/制作中/);assert.match(labels,/可上菜/);assert.match(labels,/烧焦/);assert.match(labels,/待现版校准/);
 assert.equal(nodes(f.view.node).filter(n=>n.name.startsWith('Customer_')).length,2);assert.equal(JSON.stringify(f.presentation.readModel),before);
});
test('ingredients start production; only a current Ready slot serves and a burnt slot discards',async()=>{
 const f=productionFixture();await f.presentation.artTask;
 f.tap(button(f,'制作煎饼'));f.tap(nodes(f.view.node).find(n=>n.name==='ProductionSlot_grill-0'));
 f.tap(nodes(f.view.node).find(n=>n.name==='ProductionSlot_grill-1'));f.tap(nodes(f.view.node).find(n=>n.name==='ProductionSlot_drink-0'));
 assert.deepEqual(JSON.parse(JSON.stringify(f.intents)),[
 {type:'p10.start-cooking',payload:{dishId:'jianbing'}},{type:'p10.serve-ready',payload:{slotId:'grill-1'}},
 {type:'p10.discard-food',payload:{slotId:'drink-0'}}]);
 assert.equal(f.intents.some(i=>i.type==='p10.serve-dish'),false);
});
test('production refresh reuses nodes while updating slots, customers, goals and error feedback',async()=>{
 const f=productionFixture();await f.presentation.artTask;const before=nodes(f.view.node),targets=f.presentation.tapTargets.length;
 const next=productionModel();next.kitchen.production.slots[0].state='Ready';next.kitchen.production.customers[0].patienceRemaining=3;
 next.kitchen.production.goal.current=12;next.error={code:'INVALID_OPERATION',message:'没有可用制作位'};f.presentation.readModel=next;f.presentation.refreshKitchenHud();
 assert.deepEqual(nodes(f.view.node),before);assert.equal(f.presentation.tapTargets.length,targets);assert.match(texts(f).join('\n'),/30%/);
 assert.match(texts(f).join('\n'),/12\/30/);assert.match(texts(f).join('\n'),/没有可用制作位/);
 f.tap(nodes(f.view.node).find(n=>n.name==='ProductionSlot_grill-0'));assert.equal(f.intents.at(-1).type,'p10.serve-ready');
});
test('production layout follows model capacity and customer replacement without hardcoded initial counts',async()=>{
 const f=productionFixture();await f.presentation.artTask;const next=productionModel();
 next.kitchen.production.slots.push({id:'extra',stationId:'grill',dishId:null,state:'Idle',remainingSeconds:0,burnRemainingSeconds:null});
 f.presentation.readModel=next;f.presentation.refreshKitchenHud();await f.presentation.artTask;
 assert.equal(nodes(f.view.node).filter(n=>n.name.startsWith('ProductionSlot_')).length,4);
 next.kitchen.production.customers[0].state='Served';next.kitchen.production.customers[2].state='Active';f.presentation.refreshKitchenHud();await f.presentation.artTask;
 assert.equal(nodes(f.view.node).some(n=>n.name==='Customer_c1'),false);assert.equal(nodes(f.view.node).some(n=>n.name==='Customer_c3'),true);
});
test('production targets reject stale Ready state and retain module/input/pause gates',async()=>{
 const f=productionFixture();await f.presentation.artTask;const ready=nodes(f.view.node).find(n=>n.name==='ProductionSlot_grill-1');
 f.presentation.readModel.kitchen.production.slots[1].state='Idle';f.tap(ready);assert.equal(f.intents.length,0);
 f.presentation.readModel.kitchen.production.slots[1].state='Ready';f.presentation.setInputEnabled(false);f.tap(ready);
 f.presentation.setInputEnabled(true);f.setEnabled(false);f.tap(ready);f.setEnabled(true);
 f.presentation.readModel.paused=true;f.tap(ready);assert.equal(f.intents.length,0);
 f.presentation.readModel.paused=false;f.presentation.readModel.screen='pause';f.presentation.showPause();await f.presentation.artTask;f.tap(ready);assert.equal(f.intents.length,0);
});
test('legacy kitchens keep their first-pending dish intent when production is absent',async()=>{
 const f=fixture({fixed:false});f.presentation.readModel.screen='kitchen';f.presentation.showKitchen();await f.presentation.artTask;
 f.tap(button(f,'煎饼'));assert.equal(f.intents[0].type,'p10.serve-dish');
});

function hostFixture({missingAsset=false,rejected=false}={}) {
 const state={events:[],current:true,commands:[]};
 class App { hasPendingSave=false; configureKitchenRules(raw){state.events.push(['configure',raw]);return rejected?{ok:false,error:{message:'BAD_CONFIG fixture'}}:{ok:true};}
  startCooking(...args){state.commands.push(['start',...args]);}serveReady(...args){state.commands.push(['serve',...args]);}discardFood(...args){state.commands.push(['discard',...args]);} }
 class Bootstrap {StateMachine={is:()=>true};bind(...args){this.resources=args[3];}async boot(){} }
 class Presentation {async initializeResources(){state.events.push(['presentation']);} }
 const entry={storage:{},isCurrent:()=>state.current,attach(){},ready(){assert.fail('Loading is not ready');}};
 const mocks={cc:{Component:class{},_decorator:{ccclass:()=>Class=>Class}},mk:{default:{asset:{async get(path,Type,owner,options){state.events.push(['asset',path,options.bundleStr]);return missingAsset?null:{json:{schema:'fixture'}};}}}},
  'db://shidai3/index':{CocosAdapter:class{},CocosComponentLifecycleHost:class{onLoad(){}}},
  './application/P10CookApplication':{P10CookApplication:App},'./application/cookLevelSession':{CookLevelSession:class{}},
  './bootstrap/cookSceneBootstrap':{CookSceneBootstrap:Bootstrap},'../../shell/contracts':{ModuleEntryGate:{require:()=>entry}},
  './presentation/IntentInputPort':{IntentInputPort:class{}},'./presentation/P10CookPresentation':{P10CookPresentation:Presentation}};
 const exports={};const code=ts.transpileModule(readFileSync(new URL('../../assets/bundles/game/GameRoot.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,useDefineForClassFields:false}}).outputText;
 vm.runInNewContext(code,{exports,require:id=>mocks[id]??{},console,AggregateError});const root=new exports.GameRoot();
 root.node={getComponent(){return null;},addComponent(Type){return new Type();}};return {root,state};
}
test('Loading resource callback loads and validates centralized rules before presentation and rejects missing/bad configuration',async()=>{
 const f=hostFixture();await f.root.boot();await f.root.bootstrap.resources();
 assert.deepEqual(JSON.parse(JSON.stringify(f.state.events)),[['asset','resources/config/kitchen-rules','game'],['configure',{schema:'fixture'}],['presentation']]);
 for(const options of [{missingAsset:true},{rejected:true}]){const bad=hostFixture(options);await bad.root.boot();await assert.rejects(bad.root.bootstrap.resources(),/rules did not load|BAD_CONFIG/);assert.equal(bad.state.events.some(event=>event[0]==='presentation'),false);}
 const stale=hostFixture();await stale.root.boot();stale.state.current=false;await stale.root.bootstrap.resources();assert.equal(stale.state.events.some(event=>event[0]==='configure'),false);
});
test('real GameRoot production routes dispatch once through application and retain existing save/navigation locks',async()=>{
 const f=hostFixture();await f.root.boot();f.root.inputLocked=false;f.root.advanceCommittedGameplay=async()=>{};f.root.renderNow=()=>{};
 const intents=[{type:'p10.start-cooking',payload:{dishId:'jianbing'}},{type:'p10.serve-ready',payload:{slotId:'grill-1',customerId:'c2'}},{type:'p10.discard-food',payload:{slotId:'grill-0'}}];
 for(const intent of intents)await f.root.routeIntent(intent);
 assert.deepEqual(JSON.parse(JSON.stringify(f.state.commands)),[['start','jianbing'],['serve','grill-1','c2'],['discard','grill-0']]);
 for(const flag of ['inputLocked','routing','closing']){f.root[flag]=true;await f.root.routeIntent(intents[0]);f.root[flag]=false;}
 f.root.application.hasPendingSave=true;await f.root.routeIntent(intents[0]);assert.equal(f.state.commands.length,3);
});

test('upgrades render all equipment and ingredient quotes with real effects and publish the quoted ID',async()=>{
 const f=fixture({fixed:false});const value=model();value.screen='upgrade';value.upgradeQuotes={
 grill:{restaurantId:'r0',stationId:'grill',label:'煎炉',kind:'equipment',currentLevel:1,nextLevel:2,price:120,affordable:true,currentEffect:{capacity:2,timeMultiplier:1},nextEffect:{capacity:3,timeMultiplier:0.8}},
 flour:{restaurantId:'r0',stationId:'flour',label:'面粉',kind:'ingredient',currentLevel:1,nextLevel:2,price:80,affordable:true,currentEffect:{coins:5},nextEffect:{coins:7}}};
 f.presentation.pageView={node:f.view.node};f.presentation.readModel=value;f.presentation.showUpgrade();await f.presentation.artTask;
 const label=texts(f).join('\n');assert.match(label,/容量 2.*用时×1.*容量 3.*用时×0.8/);assert.match(label,/每份 5金币.*每份 7金币/);assert.doesNotMatch(label,/效率.*8%/);
 f.tap(button(f,'80 金币'));assert.equal(f.intents[0].payload.stationId,'flour');
 value.upgradeQuotes.flour.affordable=false;f.tap(button(f,'80 金币'));assert.equal(f.intents.length,1);
});
test('production terminal/save states and explicit ready discard are checked against the latest model',async()=>{
 const f=productionFixture();await f.presentation.artTask;const slot=nodes(f.view.node).find(n=>n.name==='ProductionSlot_grill-1');
 const discard=nodes(slot).find(n=>n.name==='Button_丢弃');f.tap(discard);assert.equal(f.intents[0].type,'p10.discard-food');
 f.presentation.readModel.kitchen.status='Completed';f.tap(slot);f.presentation.readModel.kitchen.status='Running';
 for(const state of ['saving','error']){f.presentation.readModel.saveStatus={state};f.tap(slot);}assert.equal(f.intents.length,1);
});

test('result projects only the saved settlement coins for success or failure without awarding from the view',async()=>{
 for(const success of [false,true]){
  const f=fixture({fixed:false});f.presentation.readModel.screen='result';f.presentation.readModel.lastSuccess=success;
  f.presentation.readModel.result={score:9,stars:success?2:0,coinsGranted:7};const before=JSON.stringify(f.presentation.readModel);
  f.presentation.showResult();await f.presentation.artTask;assert.match(texts(f).join('\n'),/结算入账 7 金币/);assert.equal(JSON.stringify(f.presentation.readModel),before);
 }
});

test('production ingredients come only from configured recipes and customer-limited mode never presents a false time deadline',async()=>{
 const f=productionFixture();await f.presentation.artTask;assert.equal(button(f,'制作茶叶蛋'),undefined);assert.ok(button(f,'制作豆浆'));
 const next=productionModel();next.kitchen.production.goal.mode='customers';next.kitchen.remainingSeconds=0;f.presentation.readModel=next;f.presentation.refreshKitchenHud();
 assert.equal(f.presentation.hudTime.string,'限客 0/3');assert.doesNotMatch(f.presentation.hudTime.string,/时间/);
});

test('production pause projects customer limit, coin goal and active pending items with frozen state in dynamic and fixed pages',async()=>{
 for(const fixed of [false,true]){
  const f=fixture({fixed});const value=productionModel();value.screen='pause';value.paused=true;
  value.kitchen.orders=Array(12).fill({state:'Pending'});value.kitchen.servedOrders=0;value.kitchen.remainingSeconds=47;
  const production=value.kitchen.production;production.goal={mode:'customers',metric:'coins',target:30,current:0};production.earnedCoins=0;
  for(let i=4;i<=6;i++)production.customers.push({id:'c'+i,state:'Waiting',patienceMax:10,patienceRemaining:10,items:[{state:'Pending',dishId:'jianbing'}]});
  f.presentation.readModel=freeze(value);const before=JSON.stringify(value);f.presentation.showPause();await f.presentation.artTask;
  const label=fixed?f.view.pauseSummaryLabel.string:texts(f).join('\n');assert.ok(label.includes('限客 0/6'));assert.ok(label.includes('金币 0/30'));
  assert.match(label,/当前待上 2份/);assert.match(label,/冻结/);assert.ok(!label.includes('已完成 0/12')&&!label.includes('47秒'));assert.equal(JSON.stringify(value),before);
 }
});
