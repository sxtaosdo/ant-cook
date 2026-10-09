export const FREE_BOOST_MS = 180000;
export const AD_BOOST_MS = 120000;
export type SpeedMultiplier = 1 | 2 | 3;
export interface SpeedBudget { day: string; remainingMs: number }
export interface SpeedLease { day: string; ms: number }
export interface SpeedBudgetPort {
  readSpeedBoost(): SpeedBudget;
  reserveSpeedBoost(ms: number): SpeedLease;
  refundSpeedBoost(day: string, ms: number): void;
}

/** Prepay at most one active second; a crash cannot restore spent time. */
export class SpeedBoostSession {
  public multiplier: SpeedMultiplier = 1;
  private freeFinish = false;
  private lease: SpeedLease | null = null;
  public constructor(private readonly port: SpeedBudgetPort) {}
  public read(): SpeedBudget {
    const budget = this.port.readSpeedBoost();
    if (this.lease?.day !== budget.day) this.lease = null;
    return { ...budget, remainingMs: budget.remainingMs + (this.lease?.ms ?? 0) };
  }
  /** true asks the caller to show the exhausted-time panel. */
  public cycle(): boolean {
    if (this.freeFinish) return false;
    if (this.multiplier === 3) { this.stop(); return false; }
    if (this.read().remainingMs === 0 || !this.ensureLease()) { this.stop(); return true; }
    this.multiplier = this.multiplier === 1 ? 2 : 3;
    return false;
  }
  public advance(ms: number, recordConsumed?: (ms: number) => void): number {
    if (!Number.isSafeInteger(ms) || ms < 0) throw new Error('无效加速时长');
    this.read();
    if (this.freeFinish) { this.refundLease(); return 0; }
    if (this.multiplier === 1) return 0;
    let consumed = 0;
    while (ms > 0) {
      if (!this.ensureLease()) { this.stop(); return consumed; }
      const used = Math.min(ms, this.lease!.ms);
      this.lease!.ms -= used;
      consumed += used;
      recordConsumed?.(used);
      ms -= used;
    }
    if (this.read().remainingMs === 0) this.stop();
    return consumed;
  }
  public stop(): void {
    this.multiplier = 1;
    this.freeFinish = false;
    this.refundLease();
  }
  public get source(): 'manual' | 'freeFinish' { return this.freeFinish ? 'freeFinish' : 'manual'; }
  public startFreeFinish(): void {
    this.freeFinish = true;
    this.multiplier = 3;
    this.refundLease();
  }
  private refundLease(): void {
    const lease = this.lease;
    if (lease?.ms) this.port.refundSpeedBoost(lease.day, lease.ms);
    this.lease = null;
  }
  private ensureLease(): boolean {
    if (!this.lease?.ms) this.lease = this.port.reserveSpeedBoost(1000);
    return this.lease.ms > 0;
  }
}
