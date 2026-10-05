import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../../assets/Colony/scripts/presentation/transportPresentation.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function presentationWithRecordedTweens(hold = false) {
  const durations = [];
  const rates = [], pending = [];
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require: (module) => {
      if (module === './nodeFactory') return { NodeFactory: class { pool() { return {}; } } };
      if (module !== 'cc') return {};
      return {
        Vec3: { distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y) },
        Tween: { stopAllByTarget() {} },
        tween: (target) => {
          let onComplete;
          const animation = {
            to: (duration, values) => { durations.push(duration); target.position = values.position; return animation; },
            call: (callback) => { onComplete = callback; return animation; },
            timeScale: rate => { rates.push({ target, rate }); return animation; },
            start: () => { if (hold) pending.push(() => onComplete()); else onComplete(); return animation; },
          };
          return animation;
        },
      };
    },
  });
  return { presentation: new exports.TransportPresentation({}, {}, null, {}), durations, rates, pending };
}

test('transport reset resolves pending movement and prevents later route segments', async () => {
  const { presentation, pending, durations } = presentationWithRecordedTweens(true);
  presentation.root.children = [];
  const worker = { position: { x: 0, y: 0 }, setRotationFromEuler() {} };
  const moving = presentation.move(worker, [{ x: 360, y: 0 }, { x: 720, y: 0 }], 360);
  presentation.reset(); await moving;
  assert.equal(presentation.moving, false); assert.deepEqual(durations, [1]);
  pending.shift()(); assert.deepEqual(durations, [1]);
});

test('in-flight movement changes rate immediately while cargo fade keeps its duration', async () => {
  const { presentation, durations, rates, pending } = presentationWithRecordedTweens(true);
  const opacity = { opacity: 255 };
  const worker = { position: { x: 0, y: 0 }, setRotationFromEuler() {}, getComponent: () => opacity };
  const moving = presentation.move(worker, [{ x: 360, y: 0 }], 360);
  assert.equal(presentation.moving, true);
  for (const rate of [2, 3, 1]) presentation.setSpeedMultiplier(rate);
  assert.deepEqual(rates.map(item => item.rate), [1, 2, 3, 1]);
  pending.shift()(); await moving; assert.equal(presentation.moving, false);
  const fading = presentation.fade(worker);
  presentation.setSpeedMultiplier(3);
  assert.deepEqual(durations, [1, 0.12]);
  assert.equal(rates.length, 4, 'fade tween must never receive boost timeScale');
  pending.shift()(); await fading;
});

for (const [mode, level, scale] of [
  ['main', 1, 1], ['main', 2, 1.6], ['main', 60, 1.6],
  ['daily', 1, 1.6], ['daily', 30, 1.6],
]) {
  test(`${mode} level ${level} scales both travel time and minimum segment duration`, async () => {
    const { presentation, durations } = presentationWithRecordedTweens();
    assert.equal(presentation.evidence.movementScale, 1);
    presentation.configureMovement(mode, level);
    assert.equal(presentation.evidence.movementScale, scale);
    const worker = { position: { x: 0, y: 0 }, setRotationFromEuler() {} };
    await presentation.move(worker, [{ x: 360, y: 0 }, { x: 362, y: 0 }], 360);
    assert.deepEqual(durations, [1 / scale, 0.07 / scale]);
  });
}
