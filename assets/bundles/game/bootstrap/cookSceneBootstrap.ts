import { _decorator, Component } from 'cc';
import { StateMachine } from 'db://shidai3/index';
import { CookLevelSession } from '../application/cookLevelSession';
import type { P10CookApplication } from '../application/P10CookApplication';
import type { P10BusinessReadModel } from '../application/contracts';
import type { CookSceneContext } from '../presentation/pageStates/cookPageTypes';
import { KitchenState, LoadingState, MapState } from '../presentation/pageStates';

const { ccclass } = _decorator;

/**
 * Game 场景 Context：持有 StateMachine 与 CookLevelSession。
 * 首切片仍委托旧 Presentation 渲染；页面身份以 StateMachine.current 为准。
 */
@ccclass('CookSceneBootstrap')
export class CookSceneBootstrap extends Component implements CookSceneContext {
    public application!: P10CookApplication;
    public session!: CookLevelSession;
    public readonly StateMachine: StateMachine<CookSceneContext> = new StateMachine<CookSceneContext>(this);

    private presentationSync: (() => void) | null = null;
    private destroyed = false;
    private disposeTask: Promise<void> | null = null;
    private resources!: () => Promise<void>;
    private blocked!: (cause: unknown) => void;
    private currentEntry!: () => boolean;

    public bind(
        application: P10CookApplication,
        session: CookLevelSession,
        presentationSync: () => void,
        resources: () => Promise<void>, blocked: (cause: unknown) => void, currentEntry: () => boolean,
    ): void {
        this.application = application;
        this.session = session;
        this.presentationSync = presentationSync;
        this.resources = resources; this.blocked = blocked; this.currentEntry = currentEntry;
    }

    public async boot(): Promise<void> {
        if (this.destroyed) {
            return;
        }
        await this.StateMachine.changeState(LoadingState);
    }

    public initializeResources(): Promise<void> { return this.resources(); }
    public startupSaveBlocked(cause: unknown): void { this.blocked(cause); }
    public isCurrent(): boolean { return !this.destroyed && this.currentEntry(); }

    public syncPresentation(): void {
        this.presentationSync?.();
    }

    public readModel(): P10BusinessReadModel {
        return this.application.read();
    }

    public get pageIsMap(): boolean {
        return this.StateMachine.is(MapState);
    }

    public get pageIsKitchen(): boolean {
        return this.StateMachine.is(KitchenState);
    }

    public dispose(): Promise<void> {
        this.destroyed = true;
        if (!this.disposeTask) this.disposeTask = this.StateMachine.releaseAllStates()
            .then(() => { this.presentationSync = null; })
            .catch(cause => { this.disposeTask = null; throw cause; });
        return this.disposeTask;
    }

    protected onDestroy(): void { void this.dispose().catch(cause => console.error(cause)); }
}
