import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { KitchenRun } from '../../assets/bundles/game/core/KitchenRun';
import { LEVELS } from '../../assets/bundles/game/core/content';
import { KitchenRulesReader } from '../../assets/bundles/game/core/kitchenRules';
import { P10CookApplication } from '../../assets/bundles/game/application/P10CookApplication';

const raw=()=>JSON.parse(readFileSync(new URL('../../assets/bundles/game/resources/config/kitchen-rules.json',import.meta.url),'utf8'));
function fixture(){const rules=KitchenRulesReader.parse(raw());return {rules,run:new KitchenRun(LEVELS[0]!,'plate-boundary',{rules,upgrades:{}})};}
function fillPlates(run:KitchenRun,seconds:number){run.startCooking('jianbing');run.startCooking('jianbing');run.tick(seconds);run.startCooking('jianbing');run.tick(seconds);return run.snapshot.production!.slots.find(slot=>slot.stationId==='griddle'&&slot.state==='Ready')!;}

test('plated recipes cannot bypass full plates by delivering Ready food from the griddle',()=>{
 const {run,rules}=fixture(),hot=fillPlates(run,rules.recipes[0]!.cookSeconds);
 assert.equal(hot.canServe,false);assert.ok(hot.burnRemainingSeconds!>0);const before=JSON.stringify(run.snapshot);
 assert.throws(()=>run.serveReady(hot.id),/装盘/);assert.equal(JSON.stringify(run.snapshot),before,'rejected hot-food delivery changes no gameplay state');
 const customer=run.snapshot.production!.customers[0]!,plate=run.snapshot.production!.slots.find(slot=>slot.stationId==='plate'&&slot.state==='Ready')!;
 run.serveReady(plate.id,customer.id);
 assert.equal(run.snapshot.production!.slots.find(slot=>slot.id===hot.id)!.state,'Idle');
 const moved=run.snapshot.production!.slots.find(slot=>slot.id===plate.id)!;
 assert.equal(moved.state,'Ready');assert.equal(moved.canServe,true);assert.equal(moved.burnRemainingSeconds,null);
 const next=run.snapshot.production!.customers[1]!,order=next.items.find(item=>item.dishId==='jianbing')!;
 for(const id of order.toppingIds)run.addTopping(moved.id,id);
 run.serveReady(moved.id,next.id);assert.equal(run.snapshot.servedOrders,2);
});

test('recipes without plateStationId still serve from their own station, while unready and burnt food cannot serve',()=>{
 const {run,rules}=fixture();run.startCooking('soy_milk');
 const drink=run.snapshot.production!.slots.find(slot=>slot.dishId==='soy_milk')!;
 assert.equal(drink.canServe,false);assert.throws(()=>run.serveReady(drink.id));run.tick(rules.recipes.find(recipe=>recipe.dishId==='soy_milk')!.cookSeconds);
 assert.equal(run.snapshot.production!.slots.find(slot=>slot.id===drink.id)!.canServe,true);
 run.serveReady(drink.id);assert.equal(run.snapshot.servedOrders,1);
 const hot=fillPlates(run,rules.recipes[0]!.cookSeconds);run.tick(hot.burnRemainingSeconds!);
 assert.equal(run.snapshot.production!.slots.find(slot=>slot.id===hot.id)!.state,'Burnt');
 const before=JSON.stringify(run.snapshot);assert.throws(()=>run.serveReady(hot.id));assert.equal(JSON.stringify(run.snapshot),before);
});

test('application reports the plating rejection without changing wallet, orders or food and permits delivery after space is freed',t=>{
 const rules=KitchenRulesReader.parse(raw()),data=new Map<string,string>();
 const app=new P10CookApplication({storage:{getItem:key=>data.get(key)??null,setItem:(key,value)=>{data.set(key,value);},removeItem:key=>{data.delete(key);}},clock:()=>1,idGenerator:seed=>seed,saveScope:{frameworkVersion:'2.0.7',sectionId:'cook.plate-boundary',primaryKey:'cook.plate-boundary.progress'}});
 t.after(()=>app.dispose());assert.equal(app.start().ok,true);assert.equal(app.configureKitchenRules(raw()).ok,true);assert.equal(app.startLevelAt(0,0).ok,true);
 app.startCooking('jianbing');app.startCooking('jianbing');app.update(rules.recipes[0]!.cookSeconds);app.startCooking('jianbing');app.update(rules.recipes[0]!.cookSeconds);
 const before=app.read(),hot=before.kitchen!.production!.slots.find(slot=>slot.stationId==='griddle'&&slot.state==='Ready')!;
 assert.equal(app.serveReady(hot.id).ok,false);assert.equal(app.read().error!.code,'INVALID_OPERATION');
 assert.deepEqual(app.read().kitchen,before.kitchen);assert.equal(app.read().progress.coins,before.progress.coins);
 const plate=app.read().kitchen!.production!.slots.find(slot=>slot.stationId==='plate'&&slot.state==='Ready')!;
 assert.equal(app.discardFood(plate.id).ok,true);assert.equal(app.read().kitchen!.production!.slots.find(slot=>slot.id===hot.id)!.state,'Idle');
 assert.equal(app.serveReady(plate.id).ok,true);assert.equal(app.read().kitchen!.servedOrders,1);
});
