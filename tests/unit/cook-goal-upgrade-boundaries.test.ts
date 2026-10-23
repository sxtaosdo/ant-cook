import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { KitchenRun } from '../../assets/bundles/game/core/KitchenRun';
import { KitchenRulesReader } from '../../assets/bundles/game/core/kitchenRules';
import { P10GameCore } from '../../assets/bundles/game/core/P10GameCore';
import { createDefaultSave } from '../../assets/bundles/game/core/SaveCodec';
import { LEVELS } from '../../assets/bundles/game/core/content';

const actualRules=()=>JSON.parse(readFileSync(new URL('../../assets/bundles/game/resources/config/kitchen-rules.json',import.meta.url),'utf8'));
const capacity=(run:KitchenRun,stationId:string)=>run.snapshot.production!.slots.filter(slot=>slot.stationId===stationId).length;
function deliverNext(run:KitchenRun,rules:ReturnType<typeof KitchenRulesReader.parse>){
 const customer=run.snapshot.production!.customers.find(customer=>customer.state==='Active')!;
 const order=customer.items.find(item=>item.state==='Pending')!,recipe=rules.recipes.find(recipe=>recipe.dishId===order.dishId)!;
 run.startCooking(order.dishId);run.tick(recipe.cookSeconds);
 const food=run.snapshot.production!.slots.find(slot=>slot.dishId===order.dishId&&slot.canServe)!;
 assert.ok(food,'cooked order must be available at its own delivery station');
 for(const toppingId of order.toppingIds)run.addTopping(food.id,toppingId);
 run.serveReady(food.id,customer.id);
}

test('synthetic explicit 11-dish target counts individual deliveries independently of 10 customers and 20 available items',()=>{
 // Observation-inspired mechanism fixture only: not an asserted original level number or original numeric tuning.
 const raw=actualRules();raw.source='synthetic-goal-boundary-not-original-level';
 raw.customers.count=10;raw.customers.patienceSeconds=1000;raw.limits.maxLost=null;raw.goal={...raw.goal,metric:'dishes',target:11};
 const rules=KitchenRulesReader.parse(raw),run=new KitchenRun(LEVELS[0]!,'synthetic-eleven-dishes',{rules,upgrades:{}});
 assert.equal(run.snapshot.production!.customers.length,10);assert.equal(run.snapshot.orders.length,20);
 assert.equal(run.snapshot.production!.goal.target,11);
 for(let index=0;index<10;index++)deliverNext(run,rules);
 assert.equal(run.snapshot.production!.goal.current,10);assert.equal(run.snapshot.status,'Running');
 deliverNext(run,rules);
 assert.equal(run.snapshot.servedOrders,11);assert.equal(run.snapshot.production!.goal.current,11);
 assert.ok(run.snapshot.production!.customers.some(customer=>customer.state==='Active'||customer.state==='Waiting'));
 // Current customers-mode termination behavior only; the screenshots do not establish an immediate-completion policy.
 assert.equal(run.snapshot.status,'Running');
 for(let guard=0;guard<10&&run.snapshot.status==='Running';guard++)run.tick(raw.customers.patienceSeconds);
 assert.equal(run.snapshot.status,'Completed');assert.equal(run.snapshot.servedOrders,11);
 assert.equal(run.snapshot.production!.goal.target,11);assert.equal(run.snapshot.production!.goal.current,11);
 assert.ok(run.snapshot.orders.some(order=>order.state==='Expired'),'undelivered items do not replace explicit dish target with total generated demand');
});

test('actual r01 independent griddle and plate upgrades persist as 3/3/1 next-run capacity without upgrading soy',()=>{
 // Prices and multipliers are read only from the existing project config; no screenshot price or original level is assigned here.
 const rules=KitchenRulesReader.parse(actualRules()),seed=createDefaultSave();
 seed.coins=rules.stations.reduce((sum,station)=>sum+(station.upgradePrices[0]??0),0);
 const core=P10GameCore.load(JSON.stringify(seed));core.configureKitchenRules(rules);
 const oldRun=core.startLevel(LEVELS[0]!.id,'before-independent-upgrades');
 assert.deepEqual(['griddle','plate','soy-machine'].map(id=>capacity(oldRun,id)),[2,2,1]);
 const initialCoins=core.progress.coins;
 const grill=core.purchaseUpgrade('r01','grill','independent-grill-grade2'),tray=core.purchaseUpgrade('r01','tray','independent-tray-grade2');
 assert.equal(grill.applied,true);assert.equal(tray.applied,true);
 assert.equal(core.progress.coins,initialCoins-grill.coinsSpent-tray.coinsSpent);
 assert.deepEqual(['griddle','plate','soy-machine'].map(id=>capacity(oldRun,id)),[2,2,1],'a running kitchen retains its captured equipment grades');
 const restored=P10GameCore.load(core.serialize());restored.configureKitchenRules(rules);
 const next=restored.startLevel(LEVELS[0]!.id,'after-independent-upgrades');
 assert.deepEqual(['griddle','plate','soy-machine'].map(id=>capacity(next,id)),[3,3,1]);
 assert.equal(restored.getUpgradeQuote('r01','prep').currentLevel,1);assert.equal(restored.getUpgradeQuote('r01','grill').currentLevel,2);assert.equal(restored.getUpgradeQuote('r01','tray').currentLevel,2);
 const soy=restored.purchaseUpgrade('r01','prep','independent-soy-grade2');assert.equal(soy.applied,true);
 const afterSoy=restored.startLevel(LEVELS[0]!.id,'after-soy-only');
 assert.deepEqual(['griddle','plate','soy-machine'].map(id=>capacity(afterSoy,id)),[3,3,2]);
 assert.deepEqual(['griddle','plate','soy-machine'].map(id=>capacity(next,id)),[3,3,1]);
});
