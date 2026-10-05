import type { CasualLevelSession } from 'db://shidai3/minigame/index';
import type { P10CookApplication } from './P10CookApplication';
import { decodeCookGlobalLevel } from './cookLevelAddress';

/**
 * 厨房过关环会话：实现 P0002 CasualLevelSession。
 * 养成/存档/经营 Intent 不经由此类。
 */
export class CookLevelSession implements CasualLevelSession {
    public constructor(private readonly application: P10CookApplication) {}

    public bootReady(): boolean {
        if (!this.application.isStarted) {
            return false;
        }
        const model = this.application.read();
        if (model.error?.code === 'BAD_CONFIG' || model.error?.code === 'RUNTIME') {
            return false;
        }
        return !this.application.hasPendingSave && (model.saveStatus.state === 'ready' || model.saveStatus.state === 'error');
    }

    public startLevel(level: number): boolean {
        return this.openLevel(level, false);
    }

    public reset(level: number): boolean {
        return this.openLevel(level, true);
    }

    public retry(): boolean {
        return this.application.retryRun('session-retry').ok;
    }

    public nextLevel(): boolean { return this.application.continueAfterResult().ok; }
    public showHome(): boolean { return this.application.abandonRun().ok; }

    private openLevel(level: number, _forceRestart: boolean): boolean {
        const address = decodeCookGlobalLevel(level);
        if (address === null) {
            return false;
        }

        return this.application.startLevelAt(address.restaurantIndex, address.levelIndex).ok;
    }
}
