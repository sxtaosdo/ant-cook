import type { CookPageState, CookSceneContext } from './cookPageTypes';
import { MapState } from './mapState';
import { ResultState, PauseState } from './secondaryStates';

/**
 * Kitchen（≈ Play）：局内玩法仍走 Application/Core。
 * 结算提交后直接切换 ResultState；
 * retry / next / home 经 CasualLevelSession。
 */
export class KitchenState implements CookPageState {
    public context!: CookSceneContext;
    public readonly screen = 'kitchen';

    public enter(): void { this.context.syncPresentation(); }

    public exit(): void {
        // no-op
    }

    public async update(): Promise<void> {
        const model = this.context.readModel();
        if (this.context.application.hasPendingSave) return;
        if (model.result) await this.context.StateMachine.changeState(ResultState);
        else if (model.paused) await this.context.StateMachine.changeState(PauseState);
        else this.context.syncPresentation();
    }

    public retry(): boolean {
        const ok = this.context.session.retry();
        this.context.syncPresentation();
        return ok;
    }

    public nextLevel(): boolean {
        const ok = this.context.session.nextLevel();
        this.context.syncPresentation();
        return ok;
    }

    public async goHome(): Promise<boolean> {
        const ok = this.context.session.showHome();
        this.context.syncPresentation();
        if (ok) {
            await this.context.StateMachine.changeState(MapState);
        }
        return ok;
    }
}
