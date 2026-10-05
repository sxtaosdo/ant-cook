import assert from 'node:assert/strict';
import test from 'node:test';
import { CollectionFlightLedger } from '../../assets/Colony/scripts/presentation/collectionFlightLedger';
import type { ObservableEvent } from '../../assets/Colony/scripts/gameModel';
const event = (phase: ObservableEvent['phase'], stackId?: string, cellId?: string): ObservableEvent => ({ phase, stackId, cellId, slotIndex: 0, message: '' });
test('release immediately reports all reservations including its dispatch round once', () => {
  const ledger = new CollectionFlightLedger();
  ledger.consume([event('MOVE', 'a', '1'), event('MOVE', 'a', '2')]);
  ledger.consume([event('INTERACT', 'a', '2')]);
  assert.deepEqual(ledger.consume([event('RELEASE', 'a'), event('MOVE', 'a', '3')]).released, [{ stackId: 'a', slotIndex: 0, count: 3 }]);
  assert.deepEqual(ledger.consume([event('INTERACT', 'a', '1'), event('INTERACT', 'a', '3'), event('RELEASE', 'a')]).released, []);
});
test('reused slots, duplicate dispatches and trowel arrivals never double count', () => {
  const ledger = new CollectionFlightLedger();
  const a = ledger.consume([event('MOVE', 'a', '1'), event('MOVE', 'a', '1'), event('RELEASE', 'a')]);
  const b = ledger.consume([event('MOVE', 'b', '2'), event('RELEASE', 'b')]);
  assert.equal(a.released[0]!.count, 1); assert.equal(b.released[0]!.count, 1);
  assert.equal(ledger.consume([event('INTERACT', undefined, '3')]).direct, 1);
  assert.equal(ledger.consume([event('INTERACT', undefined, '3')]).direct, 0);
});
