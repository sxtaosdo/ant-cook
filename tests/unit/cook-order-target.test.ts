import assert from 'node:assert/strict';
import test from 'node:test';
import { P10CookApplication } from '../../assets/bundles/game/application/P10CookApplication';
import { RunStatus } from '../../assets/bundles/game/core/types';
class Store { data=new Map<string,string>(); getItem(k:string){return this.data.get(k)??null} setItem(k:string,v:string){this.data.set(k,v)} removeItem(k:string){this.data.delete(k)} }
function fixture(t:{after(fn:()=>void):void}){let n=0;const app=new P10CookApplication({storage:new Store(),clock:()=>123,idGenerator:seed=>`${seed}-${n++}`,saveScope:{frameworkVersion:'2.0.7',sectionId:'cook.order-target.test',primaryKey:'cook.order-target.test.progress'}});assert.equal(app.start().ok,true);assert.equal(app.startLevelAt(0,0).ok,true);t.after(()=>app.dispose());return app;}
test('only the first displayed pending order is deliverable; a later matching dish receives existing wrong-dish penalty',t=>{
 const app=fixture(t),before=app.read().kitchen!;assert.notEqual(before.orders[0].dishId,before.orders[1].dishId);
 assert.equal(app.serve(before.orders[1].dishId).ok,true);const after=app.read().kitchen!;
 assert.equal(after.servedOrders,0);assert.equal(after.score,0);assert.equal(after.combo,0);assert.equal(after.remainingSeconds,before.remainingSeconds-3);
 assert.deepEqual(after.orders.map(o=>o.state),before.orders.map(o=>o.state));assert.equal(after.orders[0].patienceRemaining,before.orders[0].patienceRemaining-3);
});
test('correct visible deliveries advance in order and preserve combo, stars and one settlement',t=>{
 const app=fixture(t);const first=app.read().kitchen!;assert.equal(app.serve(first.orders[0].dishId).ok,true);const second=app.read().kitchen!;
 assert.equal(second.servedOrders,1);assert.equal(second.combo,1);assert.equal(second.orders[0].state,'Served');assert.equal(second.orders[1].state,'Pending');
 while(app.read().kitchen?.status===RunStatus.Running){const next=app.read().kitchen!.orders.find(o=>o.state==='Pending')!;assert.equal(app.serve(next.dishId).ok,true)}
 const done=app.read();assert.equal(done.result?.success,true);assert.equal(done.result?.stars,3);assert.equal(done.result?.score,720);
 const coins=done.progress.coins;assert.equal(app.serve(first.orders[0].dishId).ok,false);assert.equal(app.read().progress.coins,coins);
});
test('repeated wrong future dishes cannot bypass patience failure or grant a successful settlement',t=>{
 const app=fixture(t);const future=app.read().kitchen!.orders[1].dishId;
 for(let guard=0;app.read().kitchen&&guard<12;guard++)assert.equal(app.serve(future).ok,true);
 const done=app.read();assert.equal(done.kitchen,null);assert.equal(done.result?.success,false);assert.equal(done.result?.coinsGranted,0);assert.equal(done.progress.levels['r01-l02'].unlocked,false);
});
