import assert from 'node:assert/strict';
import test from 'node:test';
import { stackPileHeads, stackPilePosition } from '../../assets/Colony/scripts/presentation/boardGeometry';
import type { StackState } from '../../assets/Colony/scripts/gameModel';
test('cached queue heads preserve locked, selected and sparse-depth layouts', () => {
  const original = [
    { id: 'a', pile: 0, depth: 0, selected: true, accessible: false },
    { id: 'b', pile: 0, depth: 2, selected: false, accessible: false },
    { id: 'c', pile: 0, depth: 5, selected: false, accessible: true },
    { id: 'd', pile: 1, depth: 4, selected: true, accessible: false },
    { id: 'e', pile: 2, depth: 8, selected: false, accessible: false },
  ].map(stack => ({ ...stack, color: 'leaf', count: 3 })) as StackState[];
  for (const stacks of [original, original.map(stack => ({ ...stack, selected: stack.depth % 2 === 0, accessible: false })), original.map(stack => ({ ...stack, selected: true }))]) {
    const heads = stackPileHeads(stacks);
    for (const stack of stacks) assert.deepEqual(stackPilePosition(stack, stacks, heads), stackPilePosition(stack, stacks));
  }
  assert.equal(stackPileHeads(original).get(0), 2);
  assert.equal(stackPilePosition(original[1]!, original, stackPileHeads(original)).y, 0);
});
