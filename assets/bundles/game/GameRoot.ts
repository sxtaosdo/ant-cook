import { _decorator, Component, director, Director } from 'cc';
import { CocosAdapter, CocosComponentLifecycleHost } from 'db://shidai3/index';
import { CookLevelSession } from './application/cookLevelSession';
import { P10CookApplication } from './application/P10CookApplication';
import type { P10Intent, P10ReadModel } from './application/contracts';
import { CookSceneBootstrap } from './bootstrap/cookSceneBootstrap';
import { ModuleEntryGate, type GameplayModule, type ModuleEntry, type LeaveStatus, type SaveOutcome } from '../../shell/contracts';
import { IntentInputPort } from './presentation/IntentInputPort';
import { P10CookPresentation } from './presentation/P10CookPresentation';
import type { CookPageState } from './presentation/pageStates/cookPageTypes';
import { LoadingState, MapState, LevelState, KitchenState } from './presentation/pageStates';
import { PauseState, ResultState, UpgradeState, DecorState, StoryState, UnlockState, SettingsState, RecoveryState } from './presentation/pageStates/secondaryStates';
import { encodeCookGlobalLevel } from './application/cookLevelAddress';

const { ccclass } = _decorator;

@ccclass('GameRoot')
export class GameRoot extends Component implements GameplayModule {
    readonly id = 'cook' as const;
    private entry: ModuleEntry | null = null;
    private ready = false;
    private inputLocked = true;
    private closePromise: Promise<void> | null = null;
    private closing = false;
    private pendingPageCommit: (new () => CookPageState) | null = null;
    private pageStateTask: Promise<void> | null = null;
    private routing = false;
    private application: P10CookApplication | null = null;
    private session: CookLevelSession | null = null;
    private bootstrap: CookSceneBootstrap | null = null;
    private inputPort: IntentInputPort<P10Intent> | null = null;
    private presentation: P10CookPresentation | null = null;
    private lifecycle: CocosComponentLifecycleHost<P10Intent, P10ReadModel> | null = null;

    protected onLoad(): void { void this.boot().catch(cause => { this.entry?.fail(cause); console.error(cause); }); }
    private async boot(): Promise<void> {
        this.entry = ModuleEntryGate.require('cook'); this.entry.attach(this);
        this.application = new P10CookApplication({ storage: this.entry.storage,
            saveScope: { frameworkVersion: '2.0.7', sectionId: 'cook.main', primaryKey: 'progress' },
            clock: () => Date.now() / 1000, idGenerator: seed => seed });
        this.session = new CookLevelSession(this.application);
        this.inputPort = new IntentInputPort<P10Intent>();
        this.bootstrap = this.node.getComponent(CookSceneBootstrap) ?? this.node.addComponent(CookSceneBootstrap);
        this.presentation = new P10CookPresentation(this.node, this.inputPort, {
            showMap: () => this.requestPage(MapState), showUpgrade: () => this.requestPage(UpgradeState),
            showDecor: () => this.requestPage(DecorState), showStory: () => this.requestPage(StoryState),
            showSettings: () => this.requestPage(SettingsState), showUnlock: () => this.requestPage(UnlockState),
            showRecovery: () => this.requestPage(RecoveryState),
            showProductNavigation: () => { this.entry?.requestNavigation?.(); },
            canReceiveInput: () => !this.entry?.isNavigationCovered?.(),
        });
        this.bootstrap.bind(this.application, this.session, () => this.renderNow(),
            () => this.presentation!.initializeResources(), cause => this.entry?.saveBlocked(cause),
            () => !!this.entry?.isCurrent() && !this.closing);
        const adapter = new CocosAdapter<P10Intent, P10ReadModel>({ input: this.inputPort,
            presentation: { render: () => this.renderNow() }, dispatchIntent: intent => { void this.routeIntent(intent); },
            read: () => this.presentationModel(), update: delta => this.application?.update(delta) });
        this.lifecycle = new CocosComponentLifecycleHost(this, adapter); this.lifecycle.onLoad();
        await this.bootstrap.boot();
        await this.reportReady();
    }

    private async reportReady(): Promise<void> {
        if (!this.entry?.isCurrent() || this.closing || this.bootstrap?.StateMachine.is(LoadingState)) return;
        this.renderNow(); await this.presentation?.settleRender();
        if (!this.entry.isCurrent() || this.closing) return;
        await new Promise<void>(resolve => director.once(Director.EVENT_AFTER_DRAW, resolve));
        if (!this.entry.isCurrent() || this.closing) return;
        this.ready = true; this.inputLocked = false;
        this.entry.ready({ mode: 'cook', transactionId: this.entry.transactionId, businessReady: true, firstFrameReady: true });
    }

    protected update(deltaTime: number): void {
        if (!this.ready || this.inputLocked || this.application?.hasPendingSave || this.pageStateTask) return;
        this.lifecycle?.update(deltaTime);
        this.trackPageTask(this.bootstrap!.StateMachine.update(deltaTime));
        this.presentation?.update(deltaTime);
    }
    protected onDestroy(): void { void this.close('recovery').catch(cause => console.error(cause)); }

    canLeave(): LeaveStatus {
        if (this.application?.hasPendingSave) return 'saveFailed';
        if (!this.ready || this.inputLocked || this.routing || this.pageStateTask || this.application?.hasCheckpoint || this.presentation?.hasRenderFailure) return 'playing';
        const machine = this.bootstrap?.StateMachine;
        return machine?.is(KitchenState) || machine?.is(PauseState) || machine?.is(RecoveryState) ? 'playing' : 'ready';
    }
    promotionReady(): boolean {
        return !this.closing && this.canLeave() === 'ready' && !!this.bootstrap?.StateMachine.is(MapState)
            && this.application?.firstRestaurantSaved === true;
    }
    async prepareExit(): Promise<LeaveStatus> {
        const status = this.canLeave(); if (status !== 'ready') return status;
        this.inputLocked = true; this.presentation?.setInputEnabled(false); return 'ready';
    }
    async flush(): Promise<SaveOutcome> {
        if (!this.application || !this.bootstrap) return { ok: false, reason: 'Cook application is unavailable' };
        const saved = this.application.hasPendingSave ? this.application.retrySave() : this.application.flush();
        if (!saved.ok) return { ok: false, reason: saved.error.message };
        if (this.pendingPageCommit && !this.closing) {
            const State = this.pendingPageCommit;
            await this.bootstrap.StateMachine.changeState(State);
            this.pendingPageCommit = null;
        }
        const current = this.bootstrap.StateMachine.current;
        if (current instanceof LoadingState) { await current.resumeStartup(); await this.reportReady(); }
        else {
            await this.advanceCommittedGameplay();
            this.renderNow(this.presentation?.hasRenderFailure);
            await this.presentation?.settleRender();
        }
        return { ok: true };
    }
    resumeInput(): void { if (!this.closing && !this.application?.hasPendingSave) { this.inputLocked = false; this.presentation?.setInputEnabled(true); } }
    close(_reason: 'switch' | 'recovery'): Promise<void> {
        this.closing = true;
        if (!this.closePromise) this.closePromise = this.dispose().catch(cause => { this.closePromise = null; throw cause; });
        return this.closePromise;
    }
    private async dispose(): Promise<void> {
        this.ready = false; this.inputLocked = true; this.lifecycle?.onDestroy(); this.lifecycle = null; this.inputPort?.clear();
        await this.pageStateTask?.catch(() => undefined);
        const bootstrap = this.bootstrap, presentation = this.presentation;
        const cleanup = await Promise.allSettled([
            bootstrap?.dispose().then(() => { if (this.bootstrap === bootstrap) this.bootstrap = null; }),
            presentation?.shutdown().then(() => { if (this.presentation === presentation) this.presentation = null; }),
        ]);
        const errors = cleanup.filter(result => result.status === 'rejected').map(result => result.reason);
        // Preserve failed owners for diagnostics; a rejected close never becomes fresh entry permission.
        if (errors.length) throw new AggregateError(errors, 'Cook cleanup did not complete');
        this.presentation = null; this.inputPort = null; this.bootstrap = null; this.session = null;
        this.application?.dispose(); this.application = null;
    }
    private presentationModel(): P10ReadModel {
        const state = this.bootstrap?.StateMachine.current as CookPageState | null;
        return { ...this.requireApplication().read(), screen: state?.screen ?? 'map' };
    }
    private renderNow(force = false): void {
        if (!this.application || !this.presentation || !this.bootstrap || this.closing || this.bootstrap.StateMachine.is(LoadingState)) return;
        this.presentation.render(this.presentationModel(), force);
    }
    private trackPageTask(task: Promise<void>): void {
        this.pageStateTask = task;
        void task.catch(cause => { this.entry?.fail(cause); console.error(cause); }).finally(() => { if (this.pageStateTask === task) this.pageStateTask = null; });
    }
    private requestPage(State: new () => CookPageState): void {
        if (this.inputLocked || this.routing || this.pageStateTask || this.application?.hasPendingSave || this.closing) return;
        if (this.application?.hasCheckpoint && State !== RecoveryState) return;
        this.trackPageTask(this.bootstrap!.StateMachine.changeState(State));
    }
    /** Continue committed business results after a fixed snapshot retry, without replaying commands. */
    private async advanceCommittedGameplay(): Promise<void> {
        if (!this.bootstrap || !this.application || this.application.hasPendingSave || this.closing) return;
        const machine = this.bootstrap.StateMachine, model = this.application.read();
        if (model.result && machine.is(KitchenState)) await machine.changeState(ResultState);
        else if (model.kitchen && !model.paused && !machine.is(KitchenState)) await machine.changeState(KitchenState);
        else if (model.kitchen && model.paused && machine.is(KitchenState)) await machine.changeState(PauseState);
        else if (!model.kitchen && !model.result && machine.is(ResultState)) await machine.changeState(UnlockState);
        else if (!model.kitchen && !this.application.hasCheckpoint && (machine.is(KitchenState) || machine.is(PauseState) || machine.is(RecoveryState))) await machine.changeState(MapState);
    }
    private async routeIntent(intent: P10Intent): Promise<void> {
        if (this.inputLocked || this.routing || this.pageStateTask || this.application?.hasPendingSave || this.closing) return;
        this.routing = true;
        try {
            const app = this.requireApplication(), session = this.session!;
            switch (intent.type) {
                case 'p10.start-level': {
                    const selected = app.read().selection;
                    const global = encodeCookGlobalLevel(selected.restaurantIndex, intent.payload.levelIndex ?? selected.levelIndex);
                    if (global === null || !session.startLevel(global)) return;
                    await this.bootstrap!.StateMachine.changeState(KitchenState); break;
                }
                case 'p10.select-restaurant':
                    if (app.chooseRestaurant(intent.payload.restaurantIndex).ok) await this.bootstrap!.StateMachine.changeState(LevelState);
                    else if (app.hasPendingSave) this.pendingPageCommit = LevelState;
                    break;
                case 'p10.select-level': app.chooseLevel(intent.payload.levelIndex); break;
                case 'p10.set-level-page': app.setLevelPage(intent.payload.page); break;
                case 'p10.set-story-page': app.setStoryPage(intent.payload.page); break;
                case 'p10.serve-dish': app.serve(intent.payload.dishId); break;
                case 'p10.pause': app.pauseRun(); break;
                case 'p10.resume': app.resumeRun(); break;
                case 'p10.restart': session.retry(); break;
                case 'p10.abandon': session.showHome(); break;
                case 'p10.next-after-result': session.nextLevel(); break;
                case 'p10.purchase-upgrade': app.buyUpgrade(intent.payload.restaurantId, intent.payload.stationId); break;
                case 'p10.toggle-setting': app.setSetting(intent.payload.key, intent.payload.value); break;
                case 'p10.resume-checkpoint': app.resumeSavedRun(); break;
                case 'p10.reset-save':
                    if (app.resetProgress().ok) await this.bootstrap!.StateMachine.changeState(MapState);
                    else if (app.hasPendingSave) this.pendingPageCommit = MapState;
                    break;
            }
            await this.advanceCommittedGameplay(); this.renderNow();
        } catch (cause) { this.entry?.fail(cause); console.error(cause); }
        finally { this.routing = false; }
    }
    private requireApplication(): P10CookApplication { if (!this.application) throw new Error('Cook not started'); return this.application; }
}
