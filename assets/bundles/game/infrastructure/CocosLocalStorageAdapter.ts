import { sys } from 'cc';

export interface KeyValueStoragePort {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/** The only product adapter allowed to touch Cocos localStorage. */
export class CocosLocalStorageAdapter implements KeyValueStoragePort {
    public getItem(key: string): string | null {
        return sys.localStorage.getItem(key);
    }

    public setItem(key: string, value: string): void {
        sys.localStorage.setItem(key, value);
    }

    public removeItem(key: string): void {
        sys.localStorage.removeItem(key);
    }
}
