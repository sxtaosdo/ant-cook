import type { DailyTimeReceipt } from './dailyTasks';

/** Foreground observations only; failed writes retain the same receipt for retry. */
export class DailyActivityBuffer {
  private sequence: number;
  private lastMono: number;
  private lastWall: number;
  private batch: DailyTimeReceipt | null = null;
  private readonly pending: DailyTimeReceipt[] = [];
  constructor(sequence: number, monotonic: number, wall: number) { this.sequence = sequence; this.lastMono = monotonic; this.lastWall = wall; }
  public reset(monotonic: number, wall: number): void { this.lastMono = monotonic; this.lastWall = wall; }
  public sample(monotonic: number, wall: number, active: boolean, boostMs = 0): void {
    const elapsed = Math.max(0, Math.floor(monotonic) - Math.floor(this.lastMono)), previous = this.lastWall;
    this.reset(monotonic, wall);
    if (!active || !elapsed || wall < previous || Math.abs(wall - previous - elapsed) > 60000) return;
    let start = wall - elapsed;
    const boost = Math.min(elapsed, Math.max(0, Math.floor(boostMs)));
    while (start < wall) {
      const day = Math.floor((start + 8 * 3600000) / 86400000);
      const end = Math.min(wall, (day + 1) * 86400000 - 8 * 3600000);
      if (this.batch && Math.floor((this.batch.startAt + 8 * 3600000) / 86400000) !== day) this.seal();
      if (!this.batch) this.batch = { sequence: ++this.sequence, startAt: start, endAt: end, onlineMs: 0, boostMs: 0 };
      this.batch.endAt = end;
      // Monotonic and wall clock millisecond boundaries can differ by one tick.
      // Keep the accumulated observation inside its actual wall-time interval.
      this.batch.onlineMs = Math.min(this.batch.onlineMs + end - start, this.batch.endAt - this.batch.startAt);
      this.batch.boostMs = Math.min(this.batch.onlineMs, this.batch.boostMs + Math.floor(boost * (end - start) / elapsed));
      start = end;
      if (this.batch.onlineMs >= 30000) this.seal();
    }
  }
  private seal(): void { if (this.batch) { this.pending.push(this.batch); this.batch = null; } }
  public flush(write: (receipt: DailyTimeReceipt) => void): void {
    this.seal();
    while (this.pending.length) { write(this.pending[0]!); this.pending.shift(); }
  }
  public get due(): boolean { return this.pending.length > 0; }
}
