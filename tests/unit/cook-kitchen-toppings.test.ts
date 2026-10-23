
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KitchenRun } from '../../assets/bundles/game/core/KitchenRun';
import { KitchenRulesReader } from '../../assets/bundles/game/core/kitchenRules';
import { LEVELS } from '../../assets/bundles/game/core/content';
const raw=()=>{const r=JSON.parse(readFileSync(new URL('../../assets/bundles/game/resources/config/kitchen-rules.json',import.meta.url),'utf8'));r.recipes[0].toppings=[{id:'sausage',label:'香肠'},{id:'fritter',label:'油条'},{id:'lettuce',label:'生菜'}];r.recipes[0].orderToppingSets=[['sausage','lettuce'],['fritter']];r.customers.patienceSeconds=100;return r;};
function run(value=raw()){return new KitchenRun(LEVELS[0]!,'toppings',{rules:KitchenRulesReader.parse(value),upgrades:{}});}
function plate(r:KitchenRun){r.startCooking('jianbing');r.tick(3);return r.snapshot.production!.slots.find(s=>s.stationId==='plate'&&s.state==='Ready')!;}
test('assembled toppings and order labels agree and exact unordered set is required without changing base coins',()=>{
 const r=run(),s=plate(r),c=r.snapshot.production!.customers[0]!;
 assert.deepEqual(c.items[0]!.toppingIds,['sausage','lettuce']);assert.match(c.items[0]!.dishLabel!,/香肠.*生菜/);
 const before=JSON.stringify(r.snapshot);assert.throws(()=>r.serveReady(s.id,c.id));assert.equal(JSON.stringify(r.snapshot),before);
 r.addTopping(s.id,'lettuce');r.addTopping(s.id,'sausage');assert.match(r.snapshot.production!.slots.find(v=>v.id===s.id)!.dishLabel!,/香肠.*生菜/);
 const leaked=r.snapshot.production!; (leaked.slots.find(v=>v.id===s.id)!.toppingIds as string[]).push('fritter');(leaked.customers[0]!.items[0]!.toppingIds as string[]).push('fritter');
 r.serveReady(s.id,c.id);assert.equal(r.snapshot.servedOrders,1);assert.equal(r.snapshot.production!.baseCoins,5);assert.deepEqual(r.snapshot.production!.slots.find(v=>v.id===s.id)!.toppingIds,[]);
});
test('toppings reject unknown, duplicate, unready, wrong dish and hot-station commands without mutation',()=>{
 const r=run();r.startCooking('jianbing');const hot=r.snapshot.production!.slots.find(s=>s.state==='Cooking')!;
 assert.throws(()=>r.addTopping(hot.id,'sausage'));const s=plate(r);r.addTopping(s.id,'sausage');
 for(const id of ['sausage','unknown']){const before=JSON.stringify(r.snapshot);assert.throws(()=>r.addTopping(s.id,id));assert.equal(JSON.stringify(r.snapshot),before);}
 r.startCooking('soy_milk');r.tick(4);const soy=r.snapshot.production!.slots.find(s=>s.dishId==='soy_milk')!;assert.throws(()=>r.addTopping(soy.id,'lettuce'));
 r.startCooking('jianbing');r.tick(3);const blocked=r.snapshot.production!.slots.find(s=>s.stationId==='griddle'&&s.state==='Ready')!;assert.throws(()=>r.addTopping(blocked.id,'sausage'));
 r.tick(6);assert.equal(r.snapshot.production!.slots.find(s=>s.id===blocked.id)!.state,'Burnt');assert.throws(()=>r.addTopping(blocked.id,'sausage'));
 r.discardFood(s.id);assert.equal(r.snapshot.production!.discardedCount,1);assert.deepEqual(r.snapshot.production!.slots.find(slot=>slot.id===s.id)!.toppingIds,[]);
});
test('extra topping never delivers to a plain or different combination order and leaves patience and combo unchanged',()=>{
 const r=run(),s=plate(r);r.addTopping(s.id,'fritter');const before=JSON.stringify(r.snapshot);assert.throws(()=>r.serveReady(s.id,r.snapshot.production!.customers[0]!.id));assert.equal(JSON.stringify(r.snapshot),before);
 r.serveReady(s.id,r.snapshot.production!.customers[1]!.id);assert.equal(r.snapshot.combo,1);assert.equal(r.snapshot.servedOrders,1);
});
test('old rules omit toppings safely and malformed topping combinations fail at config boundary',()=>{
 const value=raw();delete value.recipes[0].toppings;delete value.recipes[0].orderToppingSets;const r=run(value),s=plate(r);r.serveReady(s.id);assert.equal(r.snapshot.servedOrders,1);
 for(const change of [(r:any)=>r.recipes[0].orderToppingSets=[['missing']],(r:any)=>r.recipes[0].orderToppingSets=[['sausage','sausage']],(r:any)=>r.recipes[0].toppings.push({id:'sausage',label:'重复'}),(r:any)=>r.recipes[0].orderToppingSets=[]]){const bad=raw();change(bad);assert.throws(()=>KitchenRulesReader.parse(bad));}
});
