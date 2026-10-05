import type { IState, StateMachine } from 'db://shidai3/index';
import type { CookLevelSession } from '../../application/cookLevelSession';
import type { P10CookApplication } from '../../application/P10CookApplication';
import type { P10BusinessReadModel, P10Screen } from '../../application/contracts';

export interface CookSceneContext {
    readonly application: P10CookApplication;
    readonly session: CookLevelSession;
    readonly StateMachine: StateMachine<CookSceneContext>;
    initializeResources(): Promise<void>;
    startupSaveBlocked(cause: unknown): void;
    isCurrent(): boolean;
    syncPresentation(): void;
    readModel(): P10BusinessReadModel;
}
export interface CookPageState extends IState<CookSceneContext> { readonly screen?: P10Screen; }
