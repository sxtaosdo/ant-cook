import assert from 'node:assert/strict';
import test from 'node:test';
import { ColonyFlowModel } from '../../assets/Colony/scripts/gameModel';
import { createOperationalCatalog, createChallengePool, MAIN_SUPPLY_LEVELS } from '../../assets/Colony/scripts/application/operationalLevels';
import { parseDevelopmentLevelCatalog, type DevelopmentLevelCatalog } from '../../assets/Colony/scripts/application/levelCatalog';

const fixture = (initialSlots: 5 | 6): DevelopmentLevelCatalog => ({ levels: [{
  level: 1, sourceId: 'rules-interleaved', shape: 'PROVISIONAL_ORANGE_POP', columns: 3, rows: 3, initialSlots,
  cells: Array.from({ length: 9 }, (_, i) => ({ id: `cell-${i}`, row: Math.floor(i / 3), column: i % 3,
    color: i % 2 === 0 ? 'blue' as const : 'berry' as const })),
  groups: [{ id: 'blue', color: 'blue', count: 5, pile: 0, depth: 0 }, { id: 'red', color: 'berry', count: 4, pile: 0, depth: 1 }],
}] });

test('only configured main supply rounds start at six slots without consuming a tool', () => {
  const catalog = createOperationalCatalog();
  const model = new ColonyFlowModel(catalog);
  assert.deepEqual(MAIN_SUPPLY_LEVELS, [8, 14, 20]);
  for (const level of [1, 7, 8, 9, 14, 20, 21, 60]) {
    const supply = MAIN_SUPPLY_LEVELS.some(id => id === level);
    assert.equal(model.reset(level).slots.length, supply ? 6 : 5);
    assert.deepEqual(model.usedToolList(), []);
    assert.equal(model.canUseTool('slot'), !supply);
    if (supply) {
      assert.throws(() => model.useExtraSlot(), /not available/);
      assert.equal(model.addExtraSlot(), false);
      assert.equal(model.snapshot().slots.length, 6);
      assert.deepEqual(model.usedToolList(), []);
    }
  }
  model.reset(9); model.useExtraSlot();
  assert.deepEqual(model.usedToolList(), ['slot']);
  assert.equal(model.reset(14).slots.length, 6);
  assert.deepEqual(model.usedToolList(), []);
  const daily = new ColonyFlowModel(createChallengePool());
  for (let level = 1; level <= daily.levelCount; level++) assert.equal(daily.reset(level).slots.length, 5);
});

test('the same interleaved five-slot solution stays legal with six slots and existing reveal timing', () => {
  const models = [new ColonyFlowModel(fixture(5)), new ColonyFlowModel(fixture(6))];
  const traces = models.map(model => {
    model.selectStack('blue');
    assert.equal(model.snapshot().stacks.find(stack => stack.id === 'red')!.accessible, true);
    model.selectStack('red');
    const trace: string[] = [];
    for (let i = 0; i < 9; i++) {
      const spawn = model.dispatchOne().find(event => event.phase === 'SPAWN');
      assert.ok(spawn?.cellId, 'a legal five-slot transport must remain available');
      trace.push(spawn.cellId); model.completeTransport(spawn.cellId);
    }
    assert.equal(model.snapshot().result, 'SUCCESS');
    assert.equal(model.snapshot().remainingCells, 0);
    return trace;
  });
  assert.deepEqual(traces[0], traces[1]);
});

test('slot rules reject unsupported capacity in both JSON and direct model catalogs', () => {
  const raw = fixture(5);
  const invalid = { levels: [{ ...raw.levels[0]!, initialSlots: 7 }] };
  assert.throws(() => new ColonyFlowModel(invalid as unknown as DevelopmentLevelCatalog), /must be 5 or 6/);
  assert.throws(() => parseDevelopmentLevelCatalog({ schema: 'food-hunt-development-level-catalog-v1', ...invalid }), /must be 5 or 6/);
});
