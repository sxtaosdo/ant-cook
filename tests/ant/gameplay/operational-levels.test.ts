import assert from 'node:assert/strict';
import test from 'node:test';
import { createChallengeCatalog, createChallengePool, createOperationalCatalog, THEME_BASKETS, MAIN_SUPPLY_LEVELS, themeForLevel } from '../../../assets/Colony/scripts/application/operationalLevels.js';
import { ColonyFlowModel } from '../../../assets/Colony/scripts/gameModel.js';
import { deriveBoardGeometry, stackPilePosition } from '../../../assets/Colony/scripts/presentation/boardGeometry.js';
import type { DevelopmentLevelCatalog, DevelopmentLevelGroup, GameColor } from '../../../assets/Colony/scripts/application/levelCatalog.js';

const main = createOperationalCatalog();
const challenges = createChallengePool();

test('main catalog assigns five stall collections with produce twice and decorations once; daily boards remain separate', () => {
  assert.equal(THEME_BASKETS.length, 5);
  const itemOrder = [0, 1, 2, 3, 4, 5, 1, 2, 3, 4, 6, 7];
  for (const theme of THEME_BASKETS) {
    assert.equal(theme.items.length, 8);
    assert.deepEqual(theme.items.map(item => item.kind), ['stall', 'produce', 'produce', 'produce', 'produce', 'decoration', 'decoration', 'decoration']);
    assert.deepEqual(theme.items.map(item => item.target), [1, 2, 2, 2, 2, 1, 1, 1]);
  }
  for (let index = 0; index < 60; index += 1) {
    const target = themeForLevel(index + 1)!;
    const level = main.levels[index]!;
    assert.equal(level.themeId, target.theme.id);
    assert.equal(level.targetItemId, target.item.id);
    assert.equal(target.themeIndex, Math.floor(index / 12));
    const localIndex = index % 12;
    assert.equal(target.itemIndex, index < 12 && localIndex < 2 ? 1 - localIndex : itemOrder[localIndex]);
  }
  assert.ok(challenges.levels.every(level => level.themeId === undefined && level.targetItemId === undefined));
  assert.equal(themeForLevel(61), null);
});

function fixture(colors: GameColor[], groups: DevelopmentLevelGroup[]): ColonyFlowModel {
  return new ColonyFlowModel({ levels: [{ level: 1, sourceId: 'tool-regression', shape: 'NIGHT_MARKET',
    columns: colors.length, rows: 1, cells: colors.map((color, column) => ({ id: `cell-${column}`, row: 0, column, color })), groups }] });
}

function drain(model: ColonyFlowModel): void {
  for (let step = 0; step < 1000; step += 1) {
    const moves = model.dispatchReady().flat().filter((event) => event.phase === 'MOVE');
    if (moves.length === 0) return;
    for (const move of moves) model.completeTransport(move.cellId!);
  }
  assert.fail('Dispatch failed to finish');
}

test('trowel removes a depleted front group and reveals the next delivery', () => {
  const model = fixture(['berry', 'gold'], [
    { id: 'front', color: 'berry', count: 1, pile: 0, depth: 0 },
    { id: 'next', color: 'gold', count: 1, pile: 0, depth: 1 },
  ]);
  model.useTrowel();
  assert.equal(model.snapshot().stacks[0]!.selected, true);
  assert.equal(model.snapshot().stacks[1]!.accessible, true);
  model.selectStack('next');
  drain(model);
  assert.equal(model.snapshot().result, 'SUCCESS');
});

test('trowel removes a covered zero group without uncovering a later delivery early', () => {
  const model = fixture(['berry', 'gold', 'leaf'], [
    { id: 'front', color: 'gold', count: 1, pile: 0, depth: 0 },
    { id: 'covered', color: 'berry', count: 1, pile: 0, depth: 1 },
    { id: 'last', color: 'leaf', count: 1, pile: 0, depth: 2 },
  ]);
  model.useTrowel();
  assert.equal(model.snapshot().stacks[1]!.selected, true);
  assert.equal(model.snapshot().stacks[0]!.accessible, true);
  assert.equal(model.snapshot().stacks[2]!.accessible, false);
  model.selectStack('front');
  assert.equal(model.snapshot().stacks[2]!.accessible, true);
  drain(model);
  model.selectStack('last');
  drain(model);
  assert.equal(model.snapshot().result, 'SUCCESS');
});

for (const count of [1, 2]) {
  test(`trowel preserves occupied in-flight transport at remaining ${count - 1}`, () => {
    const groups: DevelopmentLevelGroup[] = [{ id: 'flying', color: 'berry', count, pile: 0, depth: 0 }];
    if (count === 1) groups.push({ id: 'waiting', color: 'berry', count: 1, pile: 1, depth: 0 });
    const model = fixture(['berry', 'berry'], groups);
    model.selectStack('flying');
    const move = model.dispatchOne().find((event) => event.phase === 'MOVE')!;
    if (count === 1) assert.equal(model.snapshot().slots[0]!.remaining, 0);
    model.useTrowel();
    assert.equal(model.snapshot().slots[0]!.remaining, 0);
    assert.equal(model.snapshot().result, 'PLAYING');
    model.completeTransport(move.cellId!);
    assert.equal(model.snapshot().result, 'SUCCESS');
    assert.equal(model.snapshot().transported, 2);
    assert.equal(model.snapshot().slots.filter(Boolean).length, 0);
  });
}

test('last completion releases its slot and a duplicate old completion cannot clear the replacement', () => {
  const model = fixture(['berry', 'gold'], [
    { id: 'first', color: 'berry', count: 1, pile: 0, depth: 0 },
    { id: 'replacement', color: 'gold', count: 1, pile: 1, depth: 0 },
  ]);
  model.selectStack('first');
  const firstEvents = model.dispatchOne();
  const firstMove = firstEvents.find((event) => event.phase === 'MOVE')!;
  assert.equal(firstEvents.some((event) => event.phase === 'RELEASE'), false);
  assert.equal(model.snapshot().slots[0]!.stackId, 'first');
  assert.equal(model.snapshot().result, 'PLAYING');

  assert.equal(model.completeTransport(firstMove.cellId!).some(event => event.phase === 'RELEASE'), true);
  model.selectStack('replacement');
  assert.equal(model.snapshot().slots[0]!.stackId, 'replacement');
  model.completeTransport(firstMove.cellId!);
  assert.equal(model.snapshot().slots[0]!.stackId, 'replacement');
  assert.equal(model.snapshot().result, 'PLAYING');

  const replacementMove = model.dispatchOne().find((event) => event.phase === 'MOVE')!;
  assert.equal(model.snapshot().slots[0]!.remaining, 0);
  assert.equal(model.snapshot().result, 'PLAYING');
  model.completeTransport(replacementMove.cellId!);
  assert.equal(model.snapshot().result, 'SUCCESS');
});

test('one non-slot extra supply preserves free tools and the six-slot limit', () => {
  const model = new ColonyFlowModel(main);
  model.reset(20);
  assert.equal(model.canUseExtraSupply('trowel'), false);
  model.useTrowel();
  assert.equal(model.canUseExtraSupply('trowel'), true);
  model.useExtraSupply('trowel');
  assert.equal(model.canUseExtraSupply('trowel'), false);
  assert.throws(() => model.useExtraSupply('trowel'));
  assert.ok(model.useCompass());
  assert.equal(model.canUseExtraSupply('compass'), false);
  assert.throws(() => model.useExtraSlot(), /not available/);
  assert.equal(model.snapshot().slots.length, 6);
  assert.equal(model.addExtraSlot(), false);
  model.reset(20);
  assert.equal(model.snapshot().slots.length, 6);
  model.useCompass();
  assert.equal(model.canUseExtraSupply('compass'), true);
  model.useExtraSupply('compass');
  assert.throws(() => model.useExtraSupply('compass'));
});

test('all 90 boards remain solvable after the free trowel is used on entry', () => {
  for (const catalog of [main, challenges] as DevelopmentLevelCatalog[]) {
    for (const level of catalog.levels) {
      const model = new ColonyFlowModel(catalog);
      model.reset(level.level);
      model.useTrowel();
      for (const group of level.groups) {
        if (model.snapshot().stacks.find((stack) => stack.id === group.id)!.selected) continue;
        model.selectStack(group.id);
        drain(model);
      }
      assert.equal(model.snapshot().result, 'SUCCESS', level.sourceId);
      assert.equal(model.snapshot().transported, level.cells.length, level.sourceId);
    }
  }
});

test('denser boards fit the sample frame and delivery groups form non-overlapping vertical columns', () => {
  const model = new ColonyFlowModel(main);
  assert.equal(deriveBoardGeometry(model.reset(1).board).cellSize, 420 / 17);
  for (const catalog of [main, challenges]) {
    const denser = new ColonyFlowModel(catalog);
    for (const level of catalog.levels) {
      const board = denser.reset(level.level).board;
      const geometry = deriveBoardGeometry(board, 560);
      assert.ok(geometry.cellSize >= 560 / 48, level.sourceId);
      for (const cell of board) {
        const position = geometry.toPosition(cell.row, cell.column);
        assert.ok(Math.abs(position.x) + geometry.cellSize / 2 <= 280.001, level.sourceId);
        assert.ok(Math.abs(position.y - 90) + geometry.cellSize / 2 <= 280.001, level.sourceId);
      }
    }
  }
  const snapshot = model.reset(60);
  for (const stack of snapshot.stacks) {
    const position = stackPilePosition(stack, snapshot.stacks);
    assert.ok(position.y <= 0);
    assert.ok(position.x - 41 >= -250 && position.x + 41 <= 250);
  }
  for (const pile of new Set(snapshot.stacks.map((stack) => stack.pile))) {
    const positions = snapshot.stacks.filter((stack) => stack.pile === pile)
      .map((stack) => stackPilePosition(stack, snapshot.stacks).y)
      .sort((left, right) => right - left);
    for (let index = 1; index < positions.length; index += 1) {
      assert.ok(positions[index - 1]! - positions[index]! >= 104);
    }
  }
  const first = snapshot.stacks.find((stack) => stack.depth === 0)!;
  model.selectStack(first.id);
  const after = model.snapshot();
  const next = after.stacks.find((stack) => stack.pile === first.pile && stack.accessible)!;
  assert.equal(stackPilePosition(next, after.stacks).y, 0);
});

test('original first mango lesson exposes five fronts and advances each three-deep queue', () => {
  const model = new ColonyFlowModel(main);
  assert.equal(themeForLevel(1)!.item.kind, 'produce');
  assert.equal(themeForLevel(1)!.item.id, 'mango');
  const initial = model.reset(1);
  assert.equal(initial.board.length, 165);
  assert.equal(initial.stacks.length, 15);
  assert.deepEqual(initial.stacks.map(stack => [stack.color, stack.count, stack.pile, stack.depth]), [
    ['charcoal', 13, 0, 0], ['charcoal', 13, 0, 1], ['charcoal', 12, 0, 2],
    ['leaf', 5, 1, 0], ['leaf', 4, 1, 1], ['leaf', 4, 1, 2],
    ['gold', 19, 2, 0], ['gold', 19, 2, 1], ['gold', 19, 2, 2],
    ['citrus', 11, 3, 0], ['citrus', 10, 3, 1], ['citrus', 10, 3, 2],
    ['berry', 9, 4, 0], ['berry', 9, 4, 1], ['berry', 8, 4, 2],
  ]);
  assert.deepEqual(initial.stacks.filter(stack => stack.accessible).map(stack => stack.id),
    ['delivery-0', 'delivery-3', 'delivery-6', 'delivery-9', 'delivery-12']);
  for (let pile = 0; pile < 5; pile += 1) {
    const queue = initial.stacks.filter(stack => stack.pile === pile);
    assert.deepEqual(queue.map(stack => stack.depth), [0, 1, 2]);
    assert.deepEqual(queue.map(stack => stackPilePosition(stack, initial.stacks).y), [0, -104, -208]);
  }
  model.selectStack('delivery-0');
  const after = model.snapshot();
  const next = after.stacks.find(stack => stack.id === 'delivery-1')!;
  assert.equal(next.accessible, true);
  assert.equal(stackPilePosition(next, after.stacks).y, 0);
  assert.equal(stackPilePosition(after.stacks.find(stack => stack.id === 'delivery-2')!, after.stacks).y, -104);
});

test('content contains 90 distinct geometries and deterministic daily rotation', () => {
  assert.equal(main.levels.length, 60);
  assert.equal(challenges.levels.length, 30);
  const geometry = (level: typeof main.levels[number]) => level.cells.map(({ row, column }) => `${row}:${column}`).sort().join('|');
  assert.equal(new Set([...main.levels, ...challenges.levels].map(geometry)).size, 90);
  const sources = new Set(Array.from({ length: 30 }, (_, index) => createChallengeCatalog(`2026-09-${String(index + 1).padStart(2, '0')}`).levels[0]!.sourceId));
  assert.equal(sources.size, 30);
  assert.deepEqual(createChallengeCatalog('2026-09-22'), createChallengeCatalog('2026-10-22'));
  assert.throws(() => createChallengeCatalog('2026-02-30'));
  assert.ok(main.levels.filter(level => level.level > 1 && (level.level - 1) % 12 === 0)
    .every(level => new Set(level.cells.map(cell => cell.color)).size > new Set(main.levels[0]!.cells.map(cell => cell.color)).size));
  assert.deepEqual([...new Set(challenges.levels.map(level => level.rows))].sort(), [23, 25, 27]);
  assert.ok(challenges.levels.every(level => level.rows === level.columns && level.cells.length <= 729));
});

for (const [mode, catalog] of [['main', main], ['challenge', challenges]] as const) {
  for (const level of catalog.levels) {
    test(`${mode} ${level.level} solves through real reservations without tools`, () => {
      const model = new ColonyFlowModel(catalog);
      model.reset(level.level);
      const colorCount = new Set(level.cells.map(cell => cell.color)).size;
      if (mode === 'main' && level.level === 6) assert.equal(colorCount, 3, 'Keep the approved lantern palette');
      else assert.ok(colorCount >= (mode === 'main' && level.level <= 5 ? 2 : 4));
      const counts = (items: readonly { color: string; count?: number }[]) => {
        const result: Record<string, number> = {};
        for (const item of items) result[item.color] = (result[item.color] ?? 0) + (item.count ?? 1);
        return result;
      };
      assert.deepEqual(counts(level.cells), counts(level.groups));
      for (const group of level.groups) {
        model.selectStack(group.id);
        for (let step = 0; step <= level.cells.length; step += 1) {
          const moves = model.dispatchReady().flat().filter((event) => event.phase === 'MOVE');
          if (moves.length === 0) break;
          for (const move of moves) model.completeTransport(move.cellId!);
        }
      }
      const final = model.snapshot();
      assert.equal(final.result, 'SUCCESS');
      assert.equal(final.remainingCells, 0);
      assert.equal(final.transported, level.cells.length);
      assert.equal(final.slots.filter(Boolean).length, 0);
      assert.equal(final.slots.length, level.initialSlots ?? 5);
    });
  }
}
