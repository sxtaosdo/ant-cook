import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { PlayerProgress, PROGRESS_CALENDAR_START } from '../../assets/Colony/scripts/application/playerProgress.ts';
import { leaderboardTestConfig, socialTestConfig } from '../support/leaderboardTestConfig.ts';

// Execute the actual projection while stubbing Cocos/MK imports that are unused by read().
const source = readFileSync(new URL('../../assets/Colony/scripts/presentation/progressPresentation.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled)(() => ({}), module, module.exports);
const { ProgressPresentation } = module.exports;

test('opening the leaderboard projection across midnight or clock rollback never writes the save', () => {
  let now = PROGRESS_CALENDAR_START + 23 * 3600000;
  const memory = new Map(); let writes = 0;
  const progress = new PlayerProgress({ read:key=>memory.get(key)??null, write(key,value) { writes++; memory.set(key,value); } }, {now:()=>now}, leaderboardTestConfig, socialTestConfig);
  const saved = [...memory.entries()]; const previousWrites = writes;
  const presentation = new ProgressPresentation({progress}, 'leaderboard');
  for (const offset of [2 * 3600000, -86400000]) {
    now += offset;
    const page = presentation.read();
    assert.equal(page.layout, 'leaderboard'); assert.equal(page.leaderboard.entries.length, 51);
    assert.equal(writes, previousWrites); assert.deepEqual([...memory.entries()], saved);
  }
});
