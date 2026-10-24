import assert from 'node:assert/strict';
import test from 'node:test';
import { boardRoute } from '../../../assets/Colony/scripts/application/boardRoute';

test('all small obstacle boards choose minimum distance then minimum turns', () => {
  const bounds = { minRow: 0, maxRow: 2, minColumn: 0, maxColumn: 2 };
  const start = { row: 3, column: 1 }, target = { row: 0, column: 1 };
  const candidates = Array.from({ length: 9 }, (_, id) => `${Math.floor(id / 3)}:${id % 3}`).filter(key => key !== '0:1');
  const directions = [[-1, 0], [0, -1], [0, 1], [1, 0]];
  for (let mask = 0; mask < 256; mask += 1) {
    const occupied = new Set(candidates.filter((_, bit) => mask & (1 << bit)));
    // Independent direction-state search compares the lexicographic cost.
    const queue = [{ row: start.row, column: start.column, direction: -1, distance: 0, turns: 0 }];
    const visited = new Set<string>();
    let expected: { distance: number; turns: number } | undefined;
    while (queue.length) {
      queue.sort((a, b) => a.distance - b.distance || a.turns - b.turns);
      const current = queue.shift()!;
      const key = `${current.row}:${current.column}:${current.direction}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (current.row === target.row && current.column === target.column) { expected = current; break; }
      directions.forEach(([dr, dc], direction) => {
        const row = current.row + dr!, column = current.column + dc!;
        if (row < -1 || row > 3 || column < -1 || column > 3 || occupied.has(`${row}:${column}`)) return;
        queue.push({ row, column, direction, distance: current.distance + 1, turns: current.turns + (current.direction < 0 || current.direction === direction ? 0 : 1) });
      });
    }
    const route = boardRoute(start, target, bounds, occupied);
    if (!expected) { assert.deepEqual(route, []); continue; }
    assert.deepEqual(route[0], start);
    assert.deepEqual(route.at(-1), target);
    assert.equal(route.length - 1, expected.distance, `distance: ${mask}`);
    let turns = 0, previous = '';
    route.slice(1).forEach((point, i) => {
      const last = route[i]!;
      const direction = `${point.row - last.row}:${point.column - last.column}`;
      assert.equal(Math.abs(point.row - last.row) + Math.abs(point.column - last.column), 1);
      assert.equal(occupied.has(`${point.row}:${point.column}`), false);
      if (previous && previous !== direction) turns += 1;
      previous = direction;
    });
    assert.equal(turns, expected.turns, `turns: ${mask}`);
  }
});

test('sealed targets do not produce a route through occupied cells', () => {
  assert.deepEqual(boardRoute({ row: 3, column: 1 }, { row: 1, column: 1 }, { minRow: 0, maxRow: 2, minColumn: 0, maxColumn: 2 }, new Set(['0:1', '1:0', '1:2', '2:1'])), []);
});
