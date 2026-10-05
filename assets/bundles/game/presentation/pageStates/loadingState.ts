import type { CookPageState, CookSceneContext } from './cookPageTypes';
import { MapState } from './mapState';
import { RecoveryState } from './secondaryStates';

/** Loading owns initial save IO, page registration and startup asset loading. */
export class LoadingState implements CookPageState {
    context!: CookSceneContext;
    private resources: Promise<void> | null = null;
    async enter(): Promise<void> {
        const started = this.context.application.start();
        if (!started.ok) {
            if (this.context.application.hasPendingSave) { this.context.startupSaveBlocked(started.error.message); return; }
            throw new Error(started.error.message);
        }
        await this.resumeStartup();
    }
    async resumeStartup(): Promise<void> {
        const context = this.context;
        if (!context || !context.session.bootReady() || !context.isCurrent()) return;
        if (!this.resources) this.resources = context.initializeResources();
        await this.resources;
        if (!context.isCurrent() || context.StateMachine.current !== this) return;
        await context.StateMachine.changeState(context.application.hasCheckpoint ? RecoveryState : MapState);
    }
    exit(): void {}
}
