import { readFileSync } from 'node:fs';
import { KitchenRun } from '../../assets/bundles/game/core/KitchenRun';
import { P10GameCore } from '../../assets/bundles/game/core/P10GameCore';
import { LEVELS } from '../../assets/bundles/game/core/content';
import { KitchenRulesReader } from '../../assets/bundles/game/core/kitchenRules';
import assert from 'node:assert/strict';
import test from 'node:test';
import { P10CookApplication } from '../../assets/bundles/game/application/P10CookApplication';

class Store { data = new Map<string,string>(); getItem(key:string) { return this.data.get(key) ?? null; } setItem(key:string,value:string) { this.data.set(key,value); } removeItem(key:string) { this.data.delete(key); } }
const rules = () => ({ schema: 'cook-kitchen-rules-v1', source: 'isolated-test-values-not-reference', restaurantId: 'r01',
  stations: [
    { id: 'grill', label: '煎锅', upgradeId: 'grill', capacityByLevel: [1,2], timeMultipliers: [1,0.5], upgradePrices: [1] },
    { id: 'drink', label: '豆浆', upgradeId: 'prep', capacityByLevel: [1,2], timeMultipliers: [1,0.5], upgradePrices: [1] },
    { id: 'egg', label: '鸡蛋', upgradeId: 'tray', capacityByLevel: [1,2], timeMultipliers: [1,0.5], upgradePrices: [1] },
  ], recipes: [
    { dishId: 'jianbing', label: '煎饼', stationId: 'grill', cookSeconds: 2, burnAfterSeconds: 3, coinsByLevel: [10,20], upgradeId: 'ingredient-jianbing', upgradePrices: [1] },
    { dishId: 'soy_milk', label: '豆浆', stationId: 'drink', cookSeconds: 1, burnAfterSeconds: null, coinsByLevel: [5,10], upgradeId: 'ingredient-soy_milk', upgradePrices: [1] },
    { dishId: 'tea_egg', label: '鸡蛋', stationId: 'egg', cookSeconds: 1, burnAfterSeconds: 3, coinsByLevel: [5,10], upgradeId: 'ingredient-tea_egg', upgradePrices: [1] },
  ], customers: { count: 3, activeCapacity: 2, itemsPerCustomer: 2, patienceSeconds: 20, partialServeRecoverySeconds: 3 },
  combo: { windowSeconds: 4, bonusCoins: [0,1,2,3] }, limits: { maxBurnt: null, maxDiscarded: null, maxLost: 0 },
  goal: { mode: 'customers', metric: 'customers', target: 'all', starRatios: [0.5,0.8,1], keepEarningsOnFailure: false },
});
function fixture(t: {after(fn:()=>void):void}, raw:unknown = rules()) {
  const storage = new Store(); let id = 0;
  const app = new P10CookApplication({ storage, clock: () => 123, idGenerator: seed => `${seed}-${id++}`,
    saveScope: { frameworkVersion: '2.0.7', sectionId: 'cook.production.test', primaryKey: 'cook.production.test.progress' } });
  assert.equal(app.start().ok, true); assert.equal(app.configureKitchenRules(raw).ok, true);
  assert.equal(app.startLevelAt(0,0).ok, true); t.after(() => app.dispose()); return { app, storage };
}

test('ingredients start actual cooking; unready or direct dish delivery cannot complete orders', t => {
  const {app} = fixture(t); const before = app.read().kitchen!;
  assert.equal(before.production!.customers.filter(c => c.state === 'Active').length, 2);
  assert.equal(app.startCooking('jianbing').ok, true);
  const slot = app.read().kitchen!.production!.slots.find(s => s.dishId === 'jianbing')!;
  assert.equal(slot.state, 'Cooking'); assert.equal(app.serveReady(slot.id).ok, false);
  assert.equal(app.serve('jianbing').ok, false); assert.equal(app.read().kitchen!.servedOrders, 0);
  app.update(2); assert.equal(app.read().kitchen!.production!.slots.find(s => s.id === slot.id)!.state, 'Ready');
  assert.equal(app.serveReady(slot.id).ok, true); assert.equal(app.read().kitchen!.servedOrders, 1);
  assert.equal(app.serveReady(slot.id).ok, false); assert.equal(app.read().kitchen!.servedOrders, 1);
});

test('waiting customers do not lose patience and a partial multi-dish order restores only its own customer', t => {
  const {app} = fixture(t); app.startCooking('jianbing'); app.update(2);
  const before = app.read().kitchen!.production!, first = before.customers[0], other = before.customers[1];
  assert.equal(before.customers[2].state, 'Waiting'); assert.equal(before.customers[2].patienceRemaining, 20);
  const slot = before.slots.find(s => s.dishId === 'jianbing')!;
  assert.equal(app.serveReady(slot.id,first.id).ok,true);
  const after = app.read().kitchen!.production!;
  assert.equal(after.customers[0].state, 'Active'); assert.equal(after.customers[0].patienceRemaining,20);
  assert.equal(after.customers[1].patienceRemaining,other.patienceRemaining);
  assert.equal(after.customers[0].items.filter(item => item.state === 'Served').length,1);
});

test('ready food burns once, cannot be served burnt, and discarding frees its actual station', t => {
  const {app} = fixture(t); app.startCooking('jianbing'); app.update(5);
  const run = app.read().kitchen!, slot = run.production!.slots.find(s => s.dishId === 'jianbing')!;
  assert.equal(slot.state,'Burnt'); assert.equal(run.production!.burntCount,1);
  app.update(1); assert.equal(app.read().kitchen!.production!.burntCount,1);
  assert.equal(app.serveReady(slot.id).ok,false); assert.equal(app.discardFood(slot.id).ok,true);
  assert.equal(app.read().kitchen!.production!.discardedCount,1);
  assert.equal(app.startCooking('jianbing').ok,true);
});

test('station full and invalid configuration are rejected without invented fallback values', t => {
  const {app} = fixture(t); assert.equal(app.startCooking('jianbing').ok,true);
  const before = JSON.stringify(app.read().kitchen);
  assert.equal(app.startCooking('jianbing').ok,false); assert.equal(JSON.stringify(app.read().kitchen),before);
  assert.equal(app.buyUpgrade('r01','unknown-station').ok,false);
  const other = new P10CookApplication({storage:new Store(),clock:()=>0,idGenerator:seed=>seed,
    saveScope:{frameworkVersion:'2.0.7',sectionId:'bad',primaryKey:'bad'}}); t.after(()=>other.dispose());
  assert.equal(other.configureKitchenRules({...rules(),customers:{...rules().customers,activeCapacity:0}}).ok,false);
});

function finish(app:P10CookApplication) {
  for (let guard=0;app.read().kitchen && guard<200;guard++) {
    const production = app.read().kitchen!.production!;
    const customer = production.customers.find(c=>c.state==='Active')!;
    const item = customer.items.find(i=>i.state==='Pending')!;
    const ready = production.slots.find(s=>s.state==='Ready'&&s.dishId===item.dishId);
    if(ready) { assert.equal(app.serveReady(ready.id,customer.id).ok,true); continue; }
    const cooking = production.slots.find(s=>s.state==='Cooking'&&s.dishId===item.dishId);
    if(cooking) app.update(cooking.remainingSeconds);
    else assert.equal(app.startCooking(item.dishId).ok,true);
  }
  assert.equal(app.read().kitchen,null);
}

test('production income settles once, funds real equipment and ingredient upgrades, and old save reload keeps grades', t => {
  const {app,storage} = fixture(t); finish(app);
  const result = app.read(); assert.equal(result.result!.success,true);
  assert.ok(result.result!.coinsGranted>0); const earned = result.progress.coins;
  assert.equal(earned,result.result!.coinsGranted,'no additional legacy fixed reward is stacked');
  assert.equal(app.buyUpgrade('r01','grill').ok,true);
  assert.equal(app.buyUpgrade('r01','ingredient-jianbing').ok,true);
  assert.equal(app.read().progress.coins,earned-2);
  assert.equal(app.startLevelAt(0,0).ok,true);
  const upgraded = app.read().kitchen!.production!;
  assert.equal(upgraded.slots.filter(s=>s.stationId==='grill').length,2);
  app.startCooking('jianbing'); assert.equal(app.read().kitchen!.production!.slots.find(s=>s.dishId==='jianbing')!.remainingSeconds,1);
  app.update(1); const slot = app.read().kitchen!.production!.slots.find(s=>s.state==='Ready')!;
  app.serveReady(slot.id); assert.equal(app.read().kitchen!.production!.baseCoins,20);
  app.pauseRun(); assert.ok(app.capture());
  const reloaded = new P10CookApplication({storage,clock:()=>999,idGenerator:seed=>seed,
    saveScope:{frameworkVersion:'2.0.7',sectionId:'cook.production.test',primaryKey:'cook.production.test.progress'}});
  t.after(()=>reloaded.dispose()); assert.equal(reloaded.start().ok,true); assert.equal(reloaded.configureKitchenRules(rules()).ok,true);
  assert.equal(reloaded.read().progress.upgrades['r01:grill'],2);
  assert.equal(reloaded.read().progress.upgrades['r01:ingredient-jianbing'],2);
  assert.equal(reloaded.read().paused,true); assert.equal(reloaded.read().kitchen!.production!.baseCoins,0,'checkpoint resumes by explicit full run restart');
  assert.equal(reloaded.read().progress.coins,earned-2);
});

test('combo earns separate coins within its configured window, and a long gap resets it', t => {
  const raw = rules(); raw.customers.patienceSeconds=100;
  const {app}=fixture(t,raw);
  app.startCooking('jianbing'); app.startCooking('soy_milk'); app.update(2);
  let production=app.read().kitchen!.production!;
  app.serveReady(production.slots.find(s=>s.dishId==='jianbing')!.id);
  app.serveReady(production.slots.find(s=>s.dishId==='soy_milk')!.id);
  production=app.read().kitchen!.production!;
  assert.equal(production.baseCoins,15); assert.equal(production.comboCoins,1); assert.equal(production.earnedCoins,16);
  app.update(5); app.startCooking('tea_egg'); app.update(1);
  app.serveReady(app.read().kitchen!.production!.slots.find(s=>s.dishId==='tea_egg')!.id);
  assert.equal(app.read().kitchen!.combo,1); assert.equal(app.read().kitchen!.production!.comboCoins,1);
});

test('burn and discard constraints fail through real settlement without granting failed-run earnings', t => {
  const raw=rules(); raw.limits.maxBurnt=0;
  const {app}=fixture(t,raw); app.startCooking('jianbing'); app.update(5);
  assert.equal(app.read().kitchen,null); assert.equal(app.read().result!.success,false); assert.equal(app.read().progress.coins,0);
  const discard=rules(); discard.limits.maxDiscarded=0;
  const second=fixture(t,discard).app; second.startCooking('jianbing'); second.update(2);
  const id=second.read().kitchen!.production!.slots.find(s=>s.state==='Ready')!.id;
  assert.equal(second.discardFood(id).ok,true); assert.equal(second.read().result!.success,false);
  assert.equal(second.read().progress.coins,0);
});

test('blocked production command exposes an error, success clears it, and snapshots never own gameplay state', t => {
  const {app}=fixture(t); app.startCooking('jianbing'); assert.equal(app.startCooking('jianbing').ok,false);
  assert.equal(app.read().error!.code,'INVALID_OPERATION');
  const leaked=app.read().kitchen!.production!; Object.assign(leaked.slots[0]!,{state:'Ready'}); Object.assign(leaked.customers[0]!,{patienceRemaining:0});
  assert.equal(app.read().kitchen!.production!.slots[0]!.state,'Cooking'); assert.equal(app.read().kitchen!.production!.customers[0]!.patienceRemaining,20);
  app.update(2); assert.equal(app.serveReady(app.read().kitchen!.production!.slots[0]!.id).ok,true); assert.equal(app.read().error,null);
});

test('the actual first-restaurant JSON supports a complete production run and recipe projection', t => {
  const raw:unknown=JSON.parse(readFileSync(new URL('../../assets/bundles/game/resources/config/kitchen-rules.json',import.meta.url),'utf8'));
  const {app}=fixture(t,raw), production=app.read().kitchen!.production!;
  assert.deepEqual(production.recipes.map(recipe=>recipe.dishId),['jianbing','soy_milk']);
  assert.match(production.configSource,/historical.*project-defaults/);
  assert.equal(production.slots.filter(slot=>slot.stationId==='griddle').length,2);
  assert.equal(production.slots.filter(slot=>slot.stationId==='plate').length,2);
  assert.equal(production.slots.filter(slot=>slot.stationId==='soy-machine').length,1);
  finish(app); assert.equal(app.read().result!.success,true); assert.ok(app.read().result!.coinsGranted>=30);
});

test('real plate capacity releases cooking slots while full plates leave hot food exposed to burning', t => {
  const raw=rules(); raw.stations.push({id:'plate',label:'摆盘',upgradeId:'plating',capacityByLevel:[1,2],timeMultipliers:[1,1],upgradePrices:[1]});
  raw.recipes=raw.recipes.map(recipe=>recipe.dishId==='jianbing'?{...recipe,plateStationId:'plate'}:recipe);
  const {app}=fixture(t,raw); app.startCooking('jianbing'); app.update(2);
  let production=app.read().kitchen!.production!;
  assert.equal(production.slots.find(slot=>slot.stationId==='plate')!.state,'Ready');
  assert.equal(production.slots.find(slot=>slot.stationId==='grill')!.state,'Idle');
  app.startCooking('jianbing'); app.update(5); production=app.read().kitchen!.production!;
  assert.equal(production.slots.find(slot=>slot.stationId==='grill')!.state,'Burnt');
  assert.equal(production.slots.find(slot=>slot.stationId==='plate')!.state,'Ready');
  const upgraded=new KitchenRun(LEVELS[0]!,'plate-grade',{rules:KitchenRulesReader.parse(raw),upgrades:{'r01:plating':2}});
  assert.equal(upgraded.snapshot.production!.slots.filter(slot=>slot.stationId==='plate').length,2);
});

test('large time advances and smaller frames agree and only age customers after admission', () => {
  const raw=rules(); raw.customers.count=5; raw.customers.activeCapacity=1; raw.customers.patienceSeconds=3; raw.limits.maxLost=null;
  const options={rules:KitchenRulesReader.parse(raw),upgrades:{}};
  const large=new KitchenRun(LEVELS[0]!,'same-attempt',options), small=new KitchenRun(LEVELS[0]!,'same-attempt',options);
  large.tick(10); for(let i=0;i<10;i++)small.tick(1);
  assert.deepEqual(large.snapshot,small.snapshot);
  assert.equal(large.snapshot.production!.customers[3]!.state,'Active');
  assert.equal(large.snapshot.production!.customers[3]!.patienceRemaining,2);
  assert.equal(large.snapshot.production!.customers[4]!.state,'Waiting');
  assert.equal(large.snapshot.production!.customers[4]!.patienceRemaining,3);
});

test('production settlement remains idempotent even when the same attempt reaches a different receipt ID', () => {
  const raw=rules(); raw.customers.count=1; raw.customers.itemsPerCustomer=1;
  const core=P10GameCore.createNew(); core.configureKitchenRules(KitchenRulesReader.parse(raw));
  const run=core.startLevel('r01-l01','one-production-attempt');
  run.startCooking('jianbing'); run.tick(2); run.serveReady(run.snapshot.production!.slots.find(slot=>slot.state==='Ready')!.id);
  const receipt=core.settle(run,'receipt-a'), coins=core.progress.coins;
  const retry=core.settle(run,'receipt-b');
  assert.deepEqual(retry,receipt); assert.equal(core.progress.coins,coins);
  assert.equal(receipt.coinsGranted,run.snapshot.production!.earnedCoins);
});

test('discarding a plate just before a hot-food burn deadline immediately plates the waiting food', t => {
  const raw:unknown=JSON.parse(readFileSync(new URL('../../assets/bundles/game/resources/config/kitchen-rules.json',import.meta.url),'utf8'));
  const {app}=fixture(t,raw); app.startCooking('jianbing'); app.startCooking('jianbing'); app.update(3);
  app.startCooking('jianbing'); app.update(3); app.update(5.99);
  const before=app.read().kitchen!.production!, plate=before.slots.find(slot=>slot.stationId==='plate'&&slot.state==='Ready')!;
  const hot=before.slots.find(slot=>slot.stationId==='griddle'&&slot.state==='Ready')!;
  assert.ok(hot.burnRemainingSeconds!<0.02); assert.equal(app.discardFood(plate.id).ok,true);
  assert.equal(app.read().kitchen!.production!.slots.find(slot=>slot.id===hot.id)!.state,'Idle');
  app.update(0.02); assert.equal(app.read().kitchen!.production!.burntCount,0);
  assert.equal(app.read().kitchen!.production!.slots.filter(slot=>slot.stationId==='plate'&&slot.state==='Ready').length,2);
});
