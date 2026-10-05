import type { StoragePort } from '../../application/contracts';

export class MemoryStorageAdapter implements StoragePort {
    private readonly values = new Map<string, string>();

    public getItem(key: string): string | null {
        const value = this.values.get(key);
        return value ?? null;
    }

    public setItem(key: string, value: string): void {
        this.values.set(key, value);
    }

    public removeItem(key: string): void {
        this.values.delete(key);
    }
}
