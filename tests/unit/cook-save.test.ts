import assert from 'node:assert/strict';
import test from 'node:test';
import { P10CookApplication } from '../../assets/bundles/game/application/P10CookApplication';
import { ProductStorage } from '../../assets/shell/productStorage';
import type { StoragePort } from '../../assets/bundles/game/application/contracts';
import { P10GameCore } from '../../assets/bundles/game/core/P10GameCore';
import { createDefaultSave } from '../../assets/bundles/game/core/SaveCodec';

class Store implements StoragePort {
  values = new Map<string, string>(); writes: string[] = []; fail = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.writes.push(value); if (this.fail) throw Error('quota exceeded'); this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
function app(store: Store) { return new P10CookApplication({ storage: new ProductStorage(store, 'cook'), clock: () => 123,
  idGenerator: seed => seed, saveScope: { frameworkVersion: '2.0.7', sectionId: 'cook.main', primaryKey: 'progress' } }); }

test('actual final restaurant settlement qualifies only after failed save retries; explicit level-40 fixture',()=>{
  const store=new Store(),game=app(store);game.start();assert.equal(game.firstRestaurantSaved,false);
  const seed=createDefaultSave();seed.levels['r01-l40'].unlocked=true;seed.restaurants.r01.highestUnlockedLevel=40;
  (game as unknown as {core:P10GameCore}).core=P10GameCore.load(JSON.stringify(seed));assert.equal(game.flush().ok,true);
  assert.equal(game.startLevelAt(0,39).ok,true);
  for(let guard=0;guard<100;guard++) {
    const pending=game.read().kitchen?.orders.filter(o=>o.state==='Pending')??[];assert.ok(pending.length>0);
    if(pending.length===1)store.fail=true;
    const result=game.serve(pending[0].dishId);
    if(store.fail) {assert.equal(result.ok,false);break;}assert.equal(result.ok,true);
  }
  assert.equal(game.read().progress.restaurants.r01.chapterComplete,true);assert.equal(game.hasPendingSave,true);assert.equal(game.firstRestaurantSaved,false);
  store.fail=false;assert.equal(game.retrySave().ok,true);assert.equal(game.firstRestaurantSaved,true);
  const writes=store.writes.length;for(let i=0;i<10;i++)assert.equal(game.firstRestaurantSaved,true);assert.equal(store.writes.length,writes);
  game.dispose();const restored=app(store);assert.equal(restored.start().ok,true);assert.equal(restored.firstRestaurantSaved,true);restored.dispose();
});

test('fresh own save ignores old real keys and a new instance restores its own progress', () => {
  const store = new Store(); store.values.set('p10_cook_game_save_v2', JSON.stringify({ version: 2, coins: 999 }));
  const first = app(store); assert.equal(first.start().ok, true); assert.equal(first.read().progress.coins, 0);
  assert.equal(first.dispatch({ type: 'p10.toggle-setting', payload: { key: 'reducedMotion', value: true } }).ok, true);
  const writes = store.writes.length; assert.equal(first.start().ok, true); assert.equal(store.writes.length, writes);
  first.dispose(); const second = app(store); assert.equal(second.start().ok, true);
  assert.equal(second.read().progress.settings.reducedMotion, true); second.dispose();
  assert.equal(JSON.parse(store.values.get('p10_cook_game_save_v2')!).coins, 999);
});

test('initial save failure retries the identical snapshot and activates only once', () => {
  const store = new Store(); store.fail = true; const game = app(store);
  assert.equal(game.start().ok, false); assert.equal(game.hasPendingSave, true);
  assert.equal(game.dispatch({ type: 'p10.start-level', payload: {} }).ok, false);
  store.fail = false; assert.equal(game.retrySave().ok, true); assert.equal(game.isStarted, true);
  assert.equal(store.writes[0], store.writes[1]); const count = store.writes.length;
  assert.equal(game.start().ok, true); assert.equal(store.writes.length, count); game.dispose();
});

test('business save failure freezes commands and update; exact pending bytes are retried', () => {
  const store = new Store(); const game = app(store); assert.equal(game.start().ok, true); assert.equal(game.startLevelAt(0, 0).ok, true); store.fail = true;
  assert.equal(game.dispatch({ type: 'p10.toggle-setting', payload: { key: 'reducedMotion', value: true } }).ok, false);
  assert.equal(game.hasPendingSave, true); const pending = store.writes.at(-1); const state = game.read();
  assert.equal(game.dispatch({ type: 'p10.toggle-setting', payload: { key: 'reducedMotion', value: false } }).ok, false);
  game.update(20); assert.deepEqual(game.read().kitchen, state.kitchen); assert.ok(state.kitchen);
  store.fail = false; assert.equal(game.retrySave().ok, true); assert.equal(store.writes.at(-1), pending);
  assert.equal(game.hasPendingSave, false); game.dispose();
});

test('corrupt own data is reported and not replaced or deleted', () => {
  const store = new Store(); const key = 'p4000.ant-cook.dev1.cook.progress'; store.values.set(key, '{broken');
  const game = app(store); assert.equal(game.start().ok, false); assert.equal(game.flush().ok, false);
  assert.equal(store.values.get(key), '{broken'); assert.equal(store.writes.length, 0); game.dispose();
});

test('one level-button command atomically selects the level and enters the kitchen', () => {
  const store = new Store(), game = app(store); game.start();
  assert.equal(game.dispatch({ type: 'p10.start-level', payload: { levelIndex: 0 } }).ok, true);
  assert.equal(game.read().selection.levelIndex, 0); assert.ok(game.read().kitchen); assert.equal('screen' in game.read(), false);
  assert.ok(game.hasCheckpoint); game.dispose();
});
