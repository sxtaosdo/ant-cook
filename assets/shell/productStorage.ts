import type { LocalStoragePort, ModeId } from './contracts';

/** Product adapter only: existing gameplay save owners retain their transaction semantics. */
export class ProductStorage implements LocalStoragePort {
  constructor(private readonly backend: LocalStoragePort, private readonly scope: ModeId | 'shell',
    private readonly productPrefix = 'p4000.ant-cook.dev1') {
    if (!/^[a-z0-9._-]+$/.test(productPrefix)) throw new Error('Invalid product storage prefix');
  }
  private key(key: string): string {
    if (!key || key.includes('\0')) throw new Error('Invalid save key');
    return `${this.productPrefix}.${this.scope}.${key}`;
  }
  getItem(key: string): string | null { return this.backend.getItem(this.key(key)); }
  setItem(key: string, value: string): void { this.backend.setItem(this.key(key), value); }
  removeItem(key: string): void { this.backend.removeItem(this.key(key)); }
  read(key: string): string | null { return this.getItem(key); }
  write(key: string, value: string): void { this.setItem(key, value); }
}
