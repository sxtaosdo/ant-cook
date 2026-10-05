import type { ObservableEvent } from '../gameModel';

/** Release credits are visual only; gameplay still waits for actual arrivals. */
export class CollectionFlightLedger {
  private readonly counts = new Map<string, number>();
  private readonly dispatched = new Set<string>();
  private readonly released = new Set<string>();
  private readonly directArrivals = new Set<string>();
  public consume(events: readonly ObservableEvent[]) {
    const released: { stackId: string; slotIndex: number; count: number }[] = [];
    let direct = 0;
    for (const event of events) if (event.phase === 'MOVE' && event.stackId && event.cellId && !this.dispatched.has(event.cellId)) {
      this.dispatched.add(event.cellId); this.counts.set(event.stackId, (this.counts.get(event.stackId) ?? 0) + 1);
    }
    for (const event of events) {
      if (event.phase === 'RELEASE' && event.stackId && event.slotIndex !== undefined && !this.released.has(event.stackId)) {
        this.released.add(event.stackId);
        released.push({ stackId: event.stackId, slotIndex: event.slotIndex, count: this.counts.get(event.stackId) ?? 0 });
      }
      if (event.phase === 'INTERACT' && !event.stackId && event.cellId && !this.directArrivals.has(event.cellId)) {
        this.directArrivals.add(event.cellId); direct++;
      }
    }
    return { released, direct };
  }
}
