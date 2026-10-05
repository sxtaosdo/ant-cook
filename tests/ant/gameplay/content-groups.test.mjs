import assert from 'node:assert/strict';
import test from 'node:test';
import { compileThemeCsv } from '../../scripts/compileThemeCsv.mjs';
import { prepareContent, resizeContent } from '../../scripts/generateLevelDifficulty.mjs';
import { replayAsync, ASYNC_PROFILES } from '../../scripts/asyncDifficultyReplay.mjs';

function balanced(level) {
  assert.ok(level.groups.every(group => group.count >= 2 && group.count <= 50));
  for (const color of new Set(level.cells.map(cell => cell.color))) {
    assert.equal(level.groups.filter(group => group.color === color).reduce((sum, group) => sum + group.count, 0), level.cells.filter(cell => cell.color === color).length);
  }
}

test('content preparation removes initial single groups without changing geometry or tutorial', () => {
  const levels = compileThemeCsv().levels;
  assert.equal(prepareContent(levels[0]), levels[0]);
  for (const level of levels.slice(1)) {
    const before = JSON.stringify(level), prepared = prepareContent(level);
    balanced(prepared);
    assert.deepEqual(prepared.cells.map(cell => [cell.id, cell.row, cell.column]), level.cells.map(cell => [cell.id, cell.row, cell.column]));
    assert.equal(JSON.stringify(level), before);
    assert.deepEqual(prepareContent(prepared), prepared);
  }
});

test('a single-cell accent becomes a balanced two-cell group without exceeding 50', () => {
  const cells = Array.from({ length: 51 }, (_, column) => ({ id: `cell-${column}`, row: 0, column, color: column === 50 ? 'berry' : 'citrus' }));
  const level = { level: 2, rows: 1, columns: 51, cells, groups: [
    { id: 'full', color: 'citrus', count: 50, pile: 0, depth: 0 }, { id: 'single', color: 'berry', count: 1, pile: 1, depth: 0 },
  ] };
  const prepared = prepareContent(level);
  balanced(prepared);
  assert.deepEqual(prepared.groups.map(group => group.count), [49, 2]);
  assert.deepEqual(prepared.groups.map(group => group.depth), [0, 0]);
  assert.deepEqual(new Set(prepared.cells.map(cell => cell.color)), new Set(['berry', 'citrus']));
});

test('board expansion preserves empty margins and color balance, and refuses tutorial changes', () => {
  const levels = compileThemeCsv().levels;
  assert.throws(() => resizeContent(levels[0], 34, 34), /tutorial/);
  assert.throws(() => resizeContent(levels[9], 31, 34), /rows\/columns/);
  const original = prepareContent(levels[9]), expanded = resizeContent(original, 34, 34);
  balanced(expanded);
  assert.equal(expanded.rows, 34); assert.equal(expanded.columns, 34);
  assert.equal(new Set(expanded.cells.map(cell => cell.id)).size, expanded.cells.length);
  assert.ok(expanded.cells.every(cell => cell.row > 0 && cell.row < 33 && cell.column > 0 && cell.column < 33));
  assert.equal(expanded.boardPath, original.boardPath);
});

test('several single-cell accents cannot overdraw a shared small delivery group', () => {
  const colors = [...Array(6).fill('berry'), 'citrus', 'leaf', 'plum'];
  const cells = colors.map((color, column) => ({ id: `cell-${column}`, row: 0, column, color }));
  const groups = [...Array.from({ length: 3 }, (_, depth) => ({ id: `berry-${depth}`, color: 'berry', count: 2, pile: 0, depth })),
    ...['citrus', 'leaf', 'plum'].map((color, index) => ({ id: color, color, count: 1, pile: index + 1, depth: 0 }))];
  const prepared = prepareContent({ level: 2, rows: 1, columns: 9, cells, groups });
  balanced(prepared);
  assert.equal(prepared.groups.filter(group => group.color === 'berry').reduce((sum, group) => sum + group.count, 0), 3);
  assert.deepEqual(prepareContent(prepared), prepared);
});

test('asynchronous exposure caching never sends the last ant to an already cleared boundary cell', () => {
  const cells = Array.from({ length: 9 }, (_, index) => ({ id: `cell-${index}`, row: Math.floor(index / 3), column: index % 3, color: 'leaf' }));
  const level = { level: 2, rows: 3, columns: 3, cells, groups: [{ id: 'delivery-0', color: 'leaf', count: 9, pile: 0, depth: 0 }] };
  for (const profile of ASYNC_PROFILES) {
    const result = replayAsync(level, [0], 'main', profile);
    assert.equal(result.result, 'SUCCESS', profile.name);
    assert.equal(result.transported, 9, profile.name);
    assert.equal(result.external, true, profile.name);
  }
});
