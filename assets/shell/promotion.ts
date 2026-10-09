import type { LocalStoragePort, ModeId } from './contracts';
import { ProductStorage } from './productStorage';

export const PROMOTION_DECLINE_MS = 7 * 86400000;
interface Cooldowns { version: 1; ant: number; cook: number }

/** Shell metadata only; gameplay facts and rewards remain owned by each module. */
export class ShellPromotion {
  private readonly storage: ProductStorage;
  private readonly shown = new Set<ModeId>();
  private cooldowns: Cooldowns = { version: 1, ant: 0, cook: 0 };
  private blocked = false;
  constructor(backend: LocalStoragePort, private readonly now = (): number => Date.now()) {
    this.storage = new ProductStorage(backend, 'shell');
    try {
      const raw = this.storage.getItem('promotion');
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !('version' in parsed) || parsed.version !== 1
        || !('ant' in parsed) || !('cook' in parsed)
        || !Number.isSafeInteger(parsed.ant) || Number(parsed.ant) < 0
        || !Number.isSafeInteger(parsed.cook) || Number(parsed.cook) < 0) throw Error('推荐记录不可读取');
      this.cooldowns = { version: 1, ant: Number(parsed.ant), cook: Number(parsed.cook) };
    } catch { this.blocked = true; }
  }
  public canOffer(source: ModeId): boolean {
    const now = this.now();
    return !this.blocked && !this.shown.has(source) && Number.isSafeInteger(now) && now >= this.cooldowns[source];
  }
  public markShown(source: ModeId): void { this.shown.add(source); }
  public decline(source: ModeId): void {
    const until = this.now() + PROMOTION_DECLINE_MS;
    if (this.blocked || !Number.isSafeInteger(until) || until < PROMOTION_DECLINE_MS) throw Error('推荐记录未保存');
    const next: Cooldowns = { ...this.cooldowns, [source]: until };
    this.storage.setItem('promotion', JSON.stringify(next));
    this.cooldowns = next;
  }
}
