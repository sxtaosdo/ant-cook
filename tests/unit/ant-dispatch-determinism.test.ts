import assert from 'node:assert/strict';
import test from 'node:test';
import { ColonyFlowModel } from '../../assets/Colony/scripts/gameModel';
import type { DevelopmentLevelCatalog } from '../../assets/Colony/scripts/application/levelCatalog';

// Development behavior only: this file makes no claim about Food Hunt's original target order.
function catalog(reverseBottom = false): DevelopmentLevelCatalog {
  const right = { id: 'right', row: 2, column: 2, color: 'white' as const };
  const left = { id: 'left', row: 2, column: 0, color: 'white' as const };
  const top = { id: 'top', row: 0, column: 1, color: 'white' as const };
  return { levels: [{ level: 1, sourceId: 'isolated-current-dispatch-order', shape: 'NIGHT_MARKET', rows: 3, columns: 3,
    cells: reverseBottom ? [left, top, right] : [right, top, left],
    groups: [{ id: 'white', color: 'white', count: 3, pile: 0, depth: 0 }],
  }] };
}
function state(model: ColonyFlowModel) {
  return { snapshot: model.snapshot(), events: model.lastEventList(), dispatch: model.lastDispatchRoundList(),
    tools: model.usedToolList(), suggested: model.suggestedStack() };
}
function replay(model: ColonyFlowModel) {
  model.reset(1);
  const trace: unknown[] = [state(model)];
  model.selectStack('white'); trace.push(state(model));
  const targets: string[] = [];
  for (let index = 0; index < 3; index++) {
    const move = model.dispatchOne().find(event => event.phase === 'MOVE');
    assert.ok(move?.cellId); targets.push(move.cellId);
    trace.push(state(model));
  }
  assert.equal(new Set(targets).size, 3, 'Pending reservations must select distinct cells');
  assert.equal(model.snapshot().result, 'PLAYING');
  for (const id of targets) { model.completeTransport(id); trace.push(state(model)); }
  assert.equal(model.snapshot().result, 'SUCCESS');
  assert.equal(model.snapshot().transported, 3);
  assert.equal(model.snapshot().slots.filter(Boolean).length, 0);
  return { targets, trace };
}

test('current same-color policy uses bottom row first and configured same-row order, rather than column order', () => {
  assert.deepEqual(replay(new ColonyFlowModel(catalog())).targets, ['right', 'left', 'top']);
  assert.deepEqual(replay(new ColonyFlowModel(catalog(true))).targets, ['left', 'right', 'top']);
});

test('identical command traces are deterministic across fresh models and reset after partial or completed transport', () => {
  const expected = replay(new ColonyFlowModel(catalog()));
  for (let iteration = 0; iteration < 3; iteration++) {
    const model = new ColonyFlowModel(catalog());
    assert.deepEqual(replay(model), expected);
    model.reset(1); model.selectStack('white'); model.dispatchOne();
    assert.deepEqual(replay(model), expected, 'Reset must discard prior reservations and exposure cache');
    assert.deepEqual(replay(model), expected, 'A completed prior round must not affect the next replay');
  }
});

test('duplicate selected-group input is rejected without altering a pending dispatch, count, events or tools', () => {
  const model = new ColonyFlowModel(catalog()); model.selectStack('white');
  const target = model.dispatchOne().find(event => event.phase === 'MOVE')!.cellId!;
  const before = state(model);
  for (let index = 0; index < 3; index++) {
    assert.throws(() => model.selectStack('white'), /already selected/);
    assert.deepEqual(state(model), before);
  }
  assert.equal(model.completeTransport(target).filter(event => event.phase === 'INTERACT').length, 1);
  const after = model.snapshot();
  model.completeTransport(target);
  assert.deepEqual(model.snapshot(), after, 'Duplicate delivery cannot transport another cell or decrement again');
});
