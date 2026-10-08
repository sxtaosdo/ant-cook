import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function load(path, modules) {
  const source = readFileSync(new URL(`../../assets/Colony/scripts/${path}.ts`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, experimentalDecorators: true, useDefineForClassFields: false } }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, require: name => modules[name] ?? {} });
  return exports;
}

test('free and normal speed remove timed text after a timed boost; expiration clamps at zero', () => {
  const decorator = () => () => {};
  const { ColonyHudView } = load('views/hudView', {
    cc: { _decorator: { ccclass: decorator, property: decorator } },
    mk: { default: { StaticViewBase: class {} } },
  });
  const hud = new ColonyHudView();
  hud.speedText = { string: '' }; hud.speedTime = { string: '' }; hud.speedTimePlate = { active: false };
  hud.setSpeedBoost(2, 65000); assert.equal(hud.speedTime.string, '1m:05s'); assert.equal(hud.speedTimePlate.active, true);
  hud.setSpeedBoost(3, 65000, 'freeFinish'); assert.equal(hud.speedText.string, '3×');
  assert.equal(hud.speedTime.string, ''); assert.equal(hud.speedTimePlate.active, false);
  hud.setSpeedBoost(2, -100); assert.equal(hud.speedTime.string, '0m:00s');
  hud.setSpeedBoost(1, 1000); assert.equal(hud.speedTime.string, ''); assert.equal(hud.speedTimePlate.active, false);
});

function playFixture() {
  const popups = [], shakes = [], used = [], selections = [];
  const { PlayState } = load('presentation/pageStates/playState', {
    '../hardLevelNotice': { HardLevelNotice: class {} },
    '../progressPresentation': { ProgressPresentation: { open: async (_context, page) => popups.push(page) } },
  });
  const state = new PlayState();
  const snapshot = { slots: [{ stackId: 'a' }], stacks: [], level: 1, result: 'PLAYING' };
  state.context = { destroyed: false, inputLocked: false, generation: 1, app: { error: null },
    play: { snapshot: () => snapshot, usedToolList: () => used, lastEventList: () => [],
      lastDispatchRoundList: () => [], suggestedStack: () => null,
      selectStack: id => { selections.push(id); throw Error('stop after command boundary'); },
      useExtraSlot: () => { if (used.includes('slot')) throw Error('used'); used.push('slot'); } },
    hudView: { setFeedback() {} }, toolBarView: { setUsed() {} },
  };
  state.board = { shakeStack: id => shakes.push(id), addExtraSlot() {} };
  state.playSound = async () => {};
  return { state, snapshot, popups, shakes, used, selections };
}

test('full slots reject repeated clicks before selecting, moving or settling', async () => {
  const f = playFixture();
  await f.state.tapStack('first'); await f.state.tapStack('second');
  assert.deepEqual(f.shakes, ['first', 'second']); assert.deepEqual(f.selections, []);
  f.snapshot.slots.push(null); await f.state.tapStack('third'); assert.deepEqual(f.selections, ['third']);
  f.snapshot.slots[1] = { stackId: 'new' }; await f.state.tapStack('fourth');
  assert.deepEqual(f.selections, ['third']); assert.deepEqual(f.shakes, ['first', 'second', 'fourth']);
});

test('remaining round tool is used directly once, exhausted tool opens its popup, locked page ignores clicks', async () => {
  const f = playFixture();
  await Promise.all([f.state.tapTool('slot'), f.state.tapTool('slot')]);
  assert.deepEqual(f.used, ['slot']); assert.deepEqual(f.popups, ['tool-slot']);
  f.state.context.inputLocked = true; await f.state.tapTool('slot'); assert.equal(f.popups.length, 1);
  f.state.context.inputLocked = false; f.state.context.destroyed = true;
  await f.state.tapTool('trowel'); assert.deepEqual(f.used, ['slot']);
});
