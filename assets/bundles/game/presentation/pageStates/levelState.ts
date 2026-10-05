import { encodeCookGlobalLevel } from '../../application/cookLevelAddress';
import type { CookPageState, CookSceneContext } from './cookPageTypes';
import { KitchenState } from './kitchenState';
import { MapState } from './mapState';

/** Level：选关页；确认后经 CasualLevelSession 开局。 */
export class LevelState implements CookPageState {
    public context!: CookSceneContext;
    public readonly screen = 'level';

    public enter(): void { this.context.syncPresentation(); }

    public exit(): void {
        // no-op
    }

    public async goMap(): Promise<void> {
        this.context.session.showHome();
        this.context.syncPresentation();
        await this.context.StateMachine.changeState(MapState);
    }

    public async startSelectedLevel(): Promise<boolean> {
        const selection = this.context.readModel().selection;
        const globalLevel = encodeCookGlobalLevel(selection.restaurantIndex, selection.levelIndex);
        if (globalLevel === null) {
            return false;
        }
        const started = this.context.session.startLevel(globalLevel);
        if (!started) {
            return false;
        }
        this.context.syncPresentation();
        await this.context.StateMachine.changeState(KitchenState);
        return true;
    }
}
