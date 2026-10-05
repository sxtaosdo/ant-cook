import { Color, Node, SpriteFrame } from 'cc';
import type { ObservableEvent } from '../gameModel';
import type { ColonyHudView } from '../views/hudView';
import { colonyColor } from './colonyColors';
import { CollectionFlightLedger } from './collectionFlightLedger';
import { IconFlight } from './iconFlight';

/** Start on slot release; credit once on landing independently of ant arrival. */
export class CollectionFlightPresentation {
  private readonly ledger = new CollectionFlightLedger();
  private readonly groupColors = new Map<string, Color>();
  private readonly flight: IconFlight;
  private readonly pending = new Set<Promise<void>>();
  private displayed = 0;
  private disposed = false;
  constructor(private readonly hud: ColonyHudView, private readonly frames: { orb: SpriteFrame }, private readonly total: number, private readonly slot: (index: number) => Node) {
    this.flight = new IconFlight(hud.node);
  }
  public accept(events: readonly ObservableEvent[]): void {
    if (this.disposed) return;
    for (const event of events) if (event.stackId && event.color) this.groupColors.set(event.stackId, colonyColor(event.color));
    const changes = this.ledger.consume(events);
    if (changes.direct) this.advance(changes.direct);
    for (const release of changes.released) {
      const end = this.hud.progressTarget();
      if (!end) { this.advance(release.count); continue; }
      const handle = this.flight.fly(this.slot(release.slotIndex), end, this.frames.orb, 1, 450, this.groupColors.get(release.stackId));
      const task = handle.finished.then(status => {
        if (!this.disposed && status === 'completed') this.advance(release.count);
        this.groupColors.delete(release.stackId);
      });
      this.pending.add(task); void task.finally(() => this.pending.delete(task));
    }
  }
  private advance(count: number): void {
    this.displayed = Math.min(this.total, this.displayed + count);
    this.hud.updateLevelRail(this.total - this.displayed);
  }
  public async drain(): Promise<void> { while (this.pending.size) await Promise.all([...this.pending]); await this.hud.waitForProgress(); }
  public dispose(): void { this.disposed = true; this.flight.dispose(); this.groupColors.clear(); }
}
