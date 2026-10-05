import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { CollectionFlightLedger } from '../../assets/Colony/scripts/presentation/collectionFlightLedger.ts';

function fixture() {
  const animations = [], credits = [], lights = [];
  class Vec3 {
    static ONE = new Vec3(1, 1, 1);
    constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
    clone() { return new Vec3(this.x, this.y, this.z); }
  }
  class UITransform { convertToNodeSpaceAR(point, out = new Vec3()) { return Object.assign(out, point); } }
  class UIOpacity { opacity = 255; }
  class Node {
    isValid = true;
    get worldPosition() { return this.position; }
    position = new Vec3();
    components = new Map([[UITransform, new UITransform()]]);
    getComponent(type) { return this.components.get(type); }
    addComponent(type) { const value = new type(); this.components.set(type, value); return value; }
    setPosition(x, y) { this.position = typeof x === 'number' ? new Vec3(x, y) : x; }
    setScale(value) { this.scale = value; }
    setRotationFromEuler(_x, _y, z) { this.angle = z; }
    getSiblingIndex() { return 0; }
    setSiblingIndex() {}
  }
  const stop = state => animations.filter(a => a.state === state).forEach(a => { a.stopped = true; });
  const pool = { put: node => { node.recycled = true; stop(node); for (const value of node.components.values()) stop(value); }, clear() {} };
  class NodeFactory {
    pool() { return pool; }
    acquire(_pool, name, x, y) { const node = new Node(); node.name = name; node.setPosition(x, y); lights.push(node); return node; }
    token() {}
  }
  const exports = {};
  let IconFlight;
  const compiled = ts.transpileModule(readFileSync(new URL('../../assets/Colony/scripts/presentation/collectionFlightPresentation.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = {
    exports,
    require: module => {
      if (module === './iconFlight') return { IconFlight };
      if (module === './collectionFlightLedger') return { CollectionFlightLedger };
      if (module === './nodeFactory') return { NodeFactory };
      if (module === './colonyColors') return { colonyColor: value => ({ value }) };
      return { Node, Vec3, UITransform, UIOpacity, Color: class {}, Tween: { stopAllByTarget: stop }, tween: state => {
        const animation = { state, stopped: false, to(seconds, values, options) { this.seconds = seconds; this.values = values; this.options = options; return this; }, call(callback) { this.callback = callback; return this; }, start() { animations.push(this); return this; }, step(t) { state.t = t; this.options?.onUpdate?.(); }, finish() { if (!this.stopped) { this.step(1); this.callback?.(); } } };
        return animation;
      } };
    },
  };
  const utility = ts.transpileModule(readFileSync(new URL('../../assets/Colony/scripts/presentation/iconFlight.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(utility, context); IconFlight = exports.IconFlight;
  runInNewContext(compiled, context);
  let endpoint = new Vec3(200, 300);
  const hud = { node: new Node(), progressTarget: () => ({ isValid: true, get worldPosition() { return endpoint; } }), updateLevelRail: remaining => credits.push(remaining), waitForProgress: () => Promise.resolve() };
  const view = new exports.CollectionFlightPresentation(hud, {}, 10, () => ({ worldPosition: new Vec3(20, 30) }));
  const event = (phase, stackId = 'a', cellId = 'cell') => ({ phase, stackId, cellId, color: 'berry', slotIndex: 0, message: '' });
  return { view, event, animations, credits, lights, utility: new IconFlight(hud.node), start: { worldPosition: new Vec3(20, 30) }, end: { isValid: true, get worldPosition() { return endpoint; } }, moveEndpoint: () => { endpoint = new Vec3(400, 600); } };
}

test('release starts a cubicOut flight immediately, follows moved target and credits once on landing', async () => {
  const f = fixture(); f.view.accept([f.event('MOVE'), f.event('RELEASE')]);
  assert.equal(f.lights.length, 1); assert.deepEqual(f.credits, []);
  const flight = f.animations.find(a => 't' in a.state);
  assert.equal(flight.seconds, 0.45); assert.equal(flight.options.easing, 'cubicOut');
  const fade = f.animations.find(a => a.values?.opacity !== undefined);
  assert.equal(fade.seconds, 0.45); assert.equal(fade.options.easing, 'cubicIn');
  flight.step(0.5); assert.deepEqual(f.credits, []); f.moveEndpoint(); flight.finish();
  await f.view.drain(); assert.deepEqual([f.lights[0].position.x, f.lights[0].position.y], [400, 600]);
  assert.deepEqual(f.credits, [9]); assert.ok(f.lights.every(n => n.recycled));
  f.view.accept([f.event('INTERACT'), f.event('RELEASE')]); assert.deepEqual(f.credits, [9]);
});
test('restart cancels flights and settles visual waits without late credits', async () => {
  const f = fixture(); f.view.accept([f.event('MOVE'), f.event('RELEASE')]);
  const wait = f.view.drain(); f.view.dispose(); await wait;
  for (const a of f.animations) a.finish(); assert.deepEqual(f.credits, []); assert.ok(f.lights[0].recycled);
});
test('unavailable target preserves exactly-once progress without creating a flight', async () => {
  const f = fixture(); f.view.hud.progressTarget = () => null;
  f.view.accept([f.event('MOVE'), f.event('RELEASE'), f.event('INTERACT')]);
  assert.equal(f.lights.length, 0); assert.deepEqual(f.credits, [9]); await f.view.drain();
});
test('multiple icons burst within the requested duration and concurrent flights complete separately', async () => {
  const f = fixture(), first = f.utility.fly(f.start, f.end, {}, 4, 450), second = f.utility.fly(f.start, f.end, {}, 2, 450);
  assert.equal(f.lights.length, 6);
  const bursts = f.animations.filter(a => a.values?.position); assert.equal(bursts.length, 6); assert.ok(bursts.every(a => a.seconds === 0.08));
  for (const burst of bursts) burst.finish();
  const flights = f.animations.filter(a => a.values?.t === 1);
  assert.equal(flights.length, 6); assert.ok(flights.every(a => a.seconds === 0.37 && a.options.easing === 'cubicOut'));
  f.moveEndpoint(); for (const flight of flights) flight.finish();
  assert.equal(await first.finished, 'completed'); assert.equal(await second.finished, 'completed');
  assert.ok(f.lights.every(n => n.recycled)); assert.ok(f.lights.every(n => n.position.x === 400 && n.position.y === 600));
});
test('cancelling in the burst phase prevents travel and later callbacks, and zero icons complete immediately', async () => {
  const f = fixture(), handle = f.utility.fly(f.start, f.end, {}, 5, 450); handle.cancel();
  for (const a of f.animations) a.finish(); assert.equal(await handle.finished, 'cancelled');
  assert.equal(f.animations.filter(a => 't' in a.state).length, 0);
  assert.equal(await f.utility.fly(f.start, f.end, {}, 0, 450).finished, 'completed');
  assert.throws(() => f.utility.fly(f.start, f.end, {}, -1, 450)); f.utility.dispose();
});
