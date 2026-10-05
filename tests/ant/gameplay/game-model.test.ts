import assert from 'node:assert/strict';
import test from 'node:test';
import './board-route.test.js';
import './operational-levels.test.js';
import './level-difficulty.test.js';
import './daily-difficulty.test.js';
import './content-groups.test.mjs';
import { ColonyFlowModel, TRANSPORT_DISPATCH_INTERVAL_MS } from '../../assets/Colony/scripts/gameModel.js';
import { deriveBoardGeometry } from '../../assets/Colony/scripts/presentation/boardGeometry.js';
import { colonyTestLevelTrace } from '../../assets/Colony/scripts/testing/colonyTestTraces.js';
import { developmentLevelCatalog } from '../support/developmentLevelCatalog.js';

const catalog = developmentLevelCatalog();
const DEVELOPMENT_LEVEL_COUNT = catalog.levels.length;

test('bottom exposed cells are reserved first with stable same-row order', () => {
  const model = new ColonyFlowModel({ levels: [{ level: 1, sourceId: 'bottom-priority', shape: 'NIGHT_MARKET', rows: 3, columns: 3,
    cells: [{ id: 'top', row: 0, column: 1, color: 'white' }, { id: 'bottom-a', row: 2, column: 0, color: 'white' }, { id: 'bottom-b', row: 2, column: 2, color: 'white' }],
    groups: [{ id: 'white', color: 'white', count: 3, pile: 0, depth: 0 }],
  }] });
  model.selectStack('white');
  const targets = Array.from({ length: 3 }, () => model.dispatchOne().find(event => event.phase === 'MOVE')?.cellId);
  assert.deepEqual(targets, ['bottom-a', 'bottom-b', 'top']);
  targets.forEach(id => model.completeTransport(id!));
  assert.equal(model.snapshot().result, 'SUCCESS');
});

test('entry barrier blocks one stack identity while other same-color slots keep dispatching', () => {
  const model = new ColonyFlowModel({ levels: [{ level: 1, sourceId: 'entry-barrier', shape: 'NIGHT_MARKET', rows: 1, columns: 3,
    cells: [0, 1, 2].map(column => ({ id: `cell-${column}`, row: 0, column, color: 'white' as const })),
    groups: [{ id: 'waiting', color: 'white', count: 2, pile: 0, depth: 0 }, { id: 'ready', color: 'white', count: 1, pile: 1, depth: 0 }],
  }] });
  model.selectStack('waiting'); model.selectStack('ready');
  const events = model.dispatchReady(undefined, new Set(['waiting'])).flat();
  assert.deepEqual(events.filter(event => event.phase === 'SPAWN').map(event => event.stackId), ['ready']);
  assert.equal(model.snapshot().slots[0]?.remaining, 2);
  assert.equal(model.dispatchReady(undefined, new Set(['waiting'])).length, 0);
  assert.equal(model.dispatchReady().flat().find(event => event.phase === 'SPAWN')?.stackId, 'waiting');
});

test('bottom priority skips sealed inner holes until an exterior opening exists', () => {
  const cells = Array.from({ length: 25 }, (_, index) => ({ id: `ring-${index}`, row: Math.floor(index / 5), column: index % 5, color: 'gold' as const }))
    .filter(cell => cell.row === 0 || cell.row === 4 || cell.column === 0 || cell.column === 4);
  const model = new ColonyFlowModel({ levels: [{ level: 1, sourceId: 'sealed-bottom', shape: 'NIGHT_MARKET', rows: 5, columns: 5,
    cells: [...cells.map(cell => cell.id === 'ring-2' ? { ...cell, color: 'white' as const } : cell), { id: 'inner-white', row: 3, column: 2, color: 'white' }],
    groups: [{ id: 'white', color: 'white', count: 2, pile: 0, depth: 0 }, { id: 'gold', color: 'gold', count: 15, pile: 1, depth: 0 }],
  }] });
  model.selectStack('white');
  const first = model.dispatchOne().find(event => event.phase === 'MOVE')!;
  assert.equal(first.cellId, 'ring-2'); assert.ok(first.route!.length > 1);
  assert.equal(model.dispatchOne().length, 0, 'reserved exterior cell has not opened the cavity yet');
  model.completeTransport(first.cellId!);
  assert.equal(model.dispatchOne().find(event => event.phase === 'MOVE')?.cellId, 'inner-white');
});

const drain = (model: ColonyFlowModel) => {
  while (true) {
    const events = model.dispatchOne();
    if (events.length === 0) return;
    const cellId = events.find((event) => event.phase === 'MOVE')?.cellId;
    if (cellId) model.completeTransport(cellId);
  }
};

test('ten development levels alternate only the two supplied provisional boards', () => {
  const model = new ColonyFlowModel(catalog);
  assert.equal(DEVELOPMENT_LEVEL_COUNT, 10);
  for (let level = 1; level <= DEVELOPMENT_LEVEL_COUNT; level += 1) {
    const snapshot = model.reset(level);
    assert.equal(snapshot.level, level);
    assert.equal(snapshot.shape, level % 2 === 1 ? 'PROVISIONAL_ORANGE_POP' : 'PROVISIONAL_FOX');
    assert.equal(snapshot.board.length, level % 2 === 1 ? 494 : 422);
    assert.equal(snapshot.slots.length, 5);
    const boardCounts = new Map<string, number>();
    const queueCounts = new Map<string, number>();
    snapshot.board.forEach((cell) => boardCounts.set(cell.color, (boardCounts.get(cell.color) ?? 0) + 1));
    snapshot.stacks.forEach((stack) => queueCounts.set(stack.color, (queueCounts.get(stack.color) ?? 0) + stack.count));
    assert.deepEqual(queueCounts, boardCounts);
  }
});

test('development dispatch cadence remains explicit candidate-only timing', () => {
  assert.equal(TRANSPORT_DISPATCH_INTERVAL_MS, 180);
});

for (let level = 1; level <= DEVELOPMENT_LEVEL_COUNT; level += 1) {
  test(`level ${level} clears exactly its configured board and releases every slot`, () => {
    const model = new ColonyFlowModel(catalog);
    model.reset(level);
    for (const stackId of colonyTestLevelTrace(catalog, level, 'success')) {
      model.selectStack(stackId);
      drain(model);
    }
    const snapshot = model.snapshot();
    assert.equal(snapshot.result, 'SUCCESS');
    assert.equal(snapshot.remainingCells, 0);
    assert.equal(snapshot.slots.filter(Boolean).length, 0);
  });

  test(`level ${level} has five stable top-of-pile groups for slot-pressure testing`, () => {
    const model = new ColonyFlowModel(catalog);
    model.reset(level);
    const topGroups = colonyTestLevelTrace(catalog, level, 'failure');
    assert.equal(topGroups.length, 5);
    topGroups.forEach((stackId) => model.selectStack(stackId));
    assert.equal(model.snapshot().slots.filter(Boolean).length, 5);
  });
}

test('another eligible color can dispatch while a different color is already in flight', () => {
  const model = new ColonyFlowModel(catalog);
  model.reset(1);
  const [first, second] = colonyTestLevelTrace(catalog, 1, 'success');
  model.selectStack(first!);
  model.selectStack(second!);
  const round = model.dispatchReady();
  const colors = new Set(round.flatMap((events) => events.filter((event) => event.phase === 'SPAWN').map((event) => event.color)));
  assert.ok(colors.size >= 2);
});

test('routes begin below the configured board bounds instead of a fixed 19x19 grid', () => {
  const model = new ColonyFlowModel(catalog);
  const initial = model.reset(1);
  model.selectStack(colonyTestLevelTrace(catalog, 1, 'success')[0]!);
  const move = model.dispatchOne().find((event) => event.phase === 'MOVE')!;
  assert.equal(move.route?.at(0)?.row, Math.max(...initial.board.map((cell) => cell.row)) + 1);
});

test('board cells and transport entry share the same dynamic geometry', () => {
  const model = new ColonyFlowModel(catalog);
  for (const level of [1, 2]) {
    const initial = model.reset(level);
    const geometry = deriveBoardGeometry(initial.board);
    model.selectStack(colonyTestLevelTrace(catalog, level, 'success')[0]!);
    const move = model.dispatchOne().find((event) => event.phase === 'MOVE')!;
    const routeStart = move.route?.[0]!;
    assert.deepEqual(geometry.entryPosition(routeStart.column), geometry.toPosition(routeStart.row, routeStart.column));
    const cell = initial.board.find((item) => item.id === move.cellId)!;
    assert.notDeepEqual(geometry.toPosition(cell.row, cell.column), { x: 0, y: 90 });
  }
});

test('both development boards fit inside the play area below the market header', () => {
  const model = new ColonyFlowModel(catalog);
  for (const level of [1, 2]) {
    const { board } = model.reset(level);
    const geometry = deriveBoardGeometry(board);
    for (const cell of board) {
      const { x, y } = geometry.toPosition(cell.row, cell.column);
      const halfSize = geometry.cellSize * 1.08 / 2;
      assert.ok(x - halfSize >= -212 && x + halfSize <= 212);
      assert.ok(y - halfSize >= -122 && y + halfSize <= 302);
    }
    assert.ok(geometry.entryPosition(geometry.minColumn).y <
      geometry.toPosition(geometry.maxRow, geometry.minColumn).y);
  }
});

test('power-ups retain their five-to-six slot and retry reset behavior', () => {
  const model = new ColonyFlowModel(catalog);
  const initial = model.reset(10);
  assert.equal(model.addExtraSlot(), true);
  assert.equal(model.snapshot().slots.length, 6);
  assert.ok(model.clearOneExposedCell().some((event) => event.phase === 'INTERACT'));
  assert.deepEqual(model.reset(10), initial);
});
