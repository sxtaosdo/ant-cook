import { encodeCookGlobalLevel } from '../../application/cookLevelAddress';
import type { CookPageState, CookSceneContext } from './cookPageTypes';
import { KitchenState } from './kitchenState';
import { LevelState } from './levelState';

/** Map（≈ Home）：选店/打开关卡列表；开局经 CasualLevelSession。 */
export class MapState implements CookPageState {
    public context!: CookSceneContext;
    public readonly screen = 'map';

    public enter(): void { this.context.syncPresentation(); }

    public exit(): void {
        // no-op
    }

    public async openLevelSelect(): Promise<void> {
        this.context.syncPresentation();
        await this.context.StateMachine.changeState(LevelState);
    }

    public async startGlobalLevel(globalLevel: number): Promise<boolean> {
        const started = this.context.session.startLevel(globalLevel);
        if (!started) {
            return false;
        }
        this.context.syncPresentation();
        await this.context.StateMachine.changeState(KitchenState);
        return true;
    }

    public async startSelectedLevel(): Promise<boolean> {
        const selection = this.context.readModel().selection;
        const globalLevel = encodeCookGlobalLevel(selection.restaurantIndex, selection.levelIndex);
        if (globalLevel === null) {
            return false;
        }
        return this.startGlobalLevel(globalLevel);
    }
}
