import {
    loadConfig,
    MessageRuntime,
    FeatureRuntime,
    failure,
    success,
    type ConfigValidationError,
    type MessageHandlerMissingError,
    type Result,
} from 'db://shidai3/index';
import type {
    Feature,
    FeatureContext,
    FeatureOperationError,
    MessageHandlerDuplicateError,
} from 'db://shidai3/index';
import {
    DEFAULT_P10_APP_CONFIG,
} from './contracts';
import type {
    P10Command,
    P10Intent,
    P10Query,
    P10Event,
    P10BusinessReadModel,
    P10Selection,
    P10RuntimePorts,
    StoragePort,
    P10ApplicationError,
    P10Config,
    SaveStatus,
    SaveStatusView,
    P10RestaurantCatalog,
    SaveSectionProblem,
} from './contracts';
import {
    P10GameCore,
    type KitchenRun,
    type KitchenRunReadModel,
    type LevelConfig,
    type RestaurantConfig,
    type SettlementReceipt,
    type GameSettings,
    type UpgradeQuote,
    LEVELS,
    RESTAURANTS,
    RunStatus,
} from '../core';
import { FrameworkSaveCoordinatorAdapter, type P10FrameworkSaveConfig } from '../infrastructure/save/SaveCoordinatorAdapter';

interface P10RuntimeState {
    selection: P10MutableSelection;
    level: LevelConfig | null;
    kitchen: KitchenRun | null;
    result: SettlementReceipt | null;
    lastSuccess: boolean;
    saveStatus: SaveStatusView;
    error: P10ApplicationError | null;
    isPaused: boolean;
    upgradeQuotes: Record<string, UpgradeQuote>;
}

interface P10MutableSelection {
    restaurantIndex: number;
    levelIndex: number;
    levelPage: number;
    storyPage: number;
}

interface P10FeatureDependencies {
    readonly appMessageBus: MessageRuntime;
    readonly applyCommand: (intent: P10Intent) => Result<P10BusinessReadModel, P10ApplicationError>;
    readonly read: () => P10BusinessReadModel;
}

type Clock = () => number;


const QUERY_EVENT_TYPES: readonly P10Event['type'][] = [
    'p10.kitchen-updated',
    'p10.settlement-applied',
    'p10.save-status-changed',
    'p10.upgrade-applied',
] as const;

class P10CookFeature implements Feature {
    public readonly id = 'feature.p10-cook';
    public readonly dependencies: readonly string[] = [];
    private readonly disposers: Array<() => void> = [];

    public constructor(private readonly deps: P10FeatureDependencies) {}

    public register(context: FeatureContext): Result<void, FeatureOperationError> {
        const registerCommand = <T extends P10Intent>(
            type: T['type'],
            handler: (intent: T) => Result<P10BusinessReadModel, P10ApplicationError>,
        ): Result<() => void, MessageHandlerDuplicateError> => {
            return this.deps.appMessageBus.registerCommand<T, P10BusinessReadModel, P10ApplicationError>(type, handler);
        };

        const commands: Array<Result<() => void, MessageHandlerDuplicateError>> = [
            registerCommand('p10.select-restaurant', (intent) => this.deps.applyCommand(intent)),
            registerCommand('p10.set-level-page', (intent) => this.deps.applyCommand(intent)),
            registerCommand('p10.set-story-page', (intent) => this.deps.applyCommand(intent)),
            registerCommand('p10.select-level', (intent) => this.deps.applyCommand(intent)),
            registerCommand('p10.start-level', (intent) => this.deps.applyCommand(intent)),
            registerCommand('p10.serve-dish', (intent) => this.deps.applyCommand(intent)),
            registerCommand('p10.pause', (intent) => this.deps.applyCommand(intent)),
            registerCommand('p10.resume', (intent) => this.deps.applyCommand(intent)),
            registerCommand('p10.restart', (intent) => this.deps.applyCommand(intent)),
            registerCommand('p10.abandon', (intent) => this.deps.applyCommand(intent)),
            registerCommand('p10.next-after-result', (intent) => this.deps.applyCommand(intent)),
            registerCommand('p10.purchase-upgrade', (intent) => this.deps.applyCommand(intent)),
            registerCommand('p10.toggle-setting', (intent) => this.deps.applyCommand(intent)),
            registerCommand('p10.resume-checkpoint', (intent) => this.deps.applyCommand(intent)),
            registerCommand('p10.reset-save', (intent) => this.deps.applyCommand(intent)),
        ];

        for (const command of commands) {
            if (!command.ok) {
                return failure({ code: command.error.code, featureId: this.id });
            }
            this.disposers.push(command.value);
        }

        const query = this.deps.appMessageBus.registerQuery<P10Query, P10BusinessReadModel, P10ApplicationError>('p10.read', () =>
            success(this.deps.read()),
        );
        if (!query.ok) {
            return failure({ code: query.error.code, featureId: this.id });
        }
        this.disposers.push(query.value);
        return success(undefined);
    }

    public activate(): Result<void, FeatureOperationError> {
        return success(undefined);
    }

    public deactivate(): void {
        for (const disposer of [...this.disposers].reverse()) {
            disposer();
        }
        this.disposers.length = 0;
    }
}

export class P10CookApplication {
    private readonly clock: Clock;
    private readonly idGenerator: (seed: string) => string;
    private config: P10Config;
    private readonly storage: StoragePort;
    private readonly messageBus: MessageRuntime;
    private readonly featureRuntime: FeatureRuntime;
    private readonly saveCoordinator: FrameworkSaveCoordinatorAdapter;
    private readonly feature: P10CookFeature;
    private readonly restaurantCatalog: P10RestaurantCatalog;

    private core: P10GameCore = P10GameCore.createNew();
    private state: P10RuntimeState;
    private started = false;
    private initializationAttempted = false;
    private disposed = false;
    private savePending = false;
    private readonly saveScope: P10FrameworkSaveConfig;
    public get hasPendingSave(): boolean { return this.savePending; }
    public get hasCheckpoint(): boolean { return this.core.progress.hasCheckpoint; }
    public get firstRestaurantSaved(): boolean { return !this.savePending && this.core.progress.restaurants.r01?.chapterComplete === true; }


    public get isStarted(): boolean {
        return this.started;
    }

    public constructor(ports: P10RuntimePorts, config: P10Config = DEFAULT_P10_APP_CONFIG) {
        if (!ports.saveScope) throw new Error("Cook save scope is required");
        this.saveScope = ports.saveScope;
        this.storage = ports.storage;
        this.clock = ports.clock;
        this.idGenerator = ports.idGenerator;
        this.config = { ...config };
        this.messageBus = new MessageRuntime();
        this.featureRuntime = new FeatureRuntime();
        this.saveCoordinator = new FrameworkSaveCoordinatorAdapter(this.storage, this.saveScope);
        this.restaurantCatalog = { restaurants: RESTAURANTS, levels: LEVELS };
        this.state = this.createDefaultState();

        this.feature = new P10CookFeature({
            appMessageBus: this.messageBus,
            applyCommand: (intent) => this.applyIntent(intent),
            read: () => this.read(),
        });
        this.featureRuntime.add(this.feature);
    }

    public start(configInput: unknown = this.config): Result<void, P10ApplicationError> {
        if (this.disposed) return failure({ code: 'RUNTIME', message: 'Cook is disposed' });
        if (!this.initializationAttempted) {
            this.initializationAttempted = true;
            this.initialize(configInput);
        } else if (this.savePending) this.retrySave();
        return this.started && !this.savePending ? success(undefined)
            : failure(this.state.error ?? { code: 'SAVE', message: 'Cook initialization has not committed' });
    }

    private initialize(configInput: unknown): void {
        const configured = loadConfig(configInput, this.validateConfig);
        if (!configured.ok) {
            this.state.error = { code: 'BAD_CONFIG', message: configured.error.message };
            this.state.saveStatus = this.toSaveStatus('error', [{
                code: 'SAVE_SECTION_MISSING',
                sectionId: 'config',
                cause: configured.error.message,
            }]);
            return;
        }

        this.config = { ...configured.value };
        this.state = this.createDefaultState();

        const framework = this.featureRuntime.capabilities.provide('framework.save', this.saveCoordinator.coordinator);
        if (!framework.ok) {
            this.state.error = { code: 'RUNTIME', message: framework.error.code };
            this.state.saveStatus = this.toSaveStatus('error', [{
                code: 'SAVE_UNKNOWN_ERROR',
                sectionId: framework.error.capabilityId,
                cause: framework.error.code,
            }]);
            return;
        }

        const attached = this.saveCoordinator.attachCoreState(
            () => this.core,
            (core) => {
                this.core = core;
            },
        );
        if (!attached.ok) {
            this.state.error = { code: 'RUNTIME', message: attached.error.code };
            this.state.saveStatus = this.toSaveStatus('error', [attached.error]);
            return;
        }

        const activated = this.featureRuntime.activate();
        if (!activated.ok) {
            this.state.error = { code: 'RUNTIME', message: activated.error.code };
            this.state.saveStatus = this.toSaveStatus('error', [{
                code: 'SAVE_UNKNOWN_ERROR',
                sectionId: 'feature',
                cause: activated.error.featureId,
            }]);
            return;
        }

        const loaded = this.saveCoordinator.loadOrCreate(P10GameCore.createNew());
        if (!loaded.ok) {
            this.savePending = this.saveCoordinator.hasPendingSnapshot;
            this.state.error = { code: 'SAVE', message: `${loaded.error.code}: ${loaded.error.cause ?? ''}` };
            this.state.saveStatus = this.toSaveStatus('error', [loaded.error]);
            return;
        }

        this.started = true;
        this.state.selection = this.resolveSelectionFromProgress(this.state.selection);
        this.syncFromCoreProgress();
        this.state.error = loaded.value.recoveryError === undefined
            ? null
            : { code: 'SAVE', message: `${loaded.value.recoveryError.code}: ${loaded.value.recoveryError.cause ?? ''}` };
        this.state.saveStatus = loaded.value.recoveryError === undefined
            ? this.toSaveStatus('ready')
            : this.toSaveStatus('error', [loaded.value.recoveryError]);

        if (this.config.autoResumeCheckpoint && this.core.progress.hasCheckpoint) {
            const resumed = this.core.resumeCheckpoint();
            if (resumed) {
                this.syncCheckpointLevel(resumed.snapshot.levelId);
                this.state.kitchen = resumed;
                this.state.isPaused = true;
                this.state.lastSuccess = false;
            }
        }

        if (loaded.value.recoveryError === undefined) {
            this.persist();
        }
    }

    public dispatch(intent: P10Intent | P10Query): Result<unknown, P10ApplicationError> {
        if (intent.type !== 'p10.read' && (this.savePending || this.disposed || !this.started))
            return failure({ code: 'SAVE', message: 'Save pending or Cook not ready; retry the save, not the command' });
        const handled = intent.type === 'p10.read'
            ? this.messageBus.query<unknown, P10ApplicationError>(intent as P10Query)
            : this.messageBus.execute<unknown, P10ApplicationError>(intent as P10Intent);

        if (!handled.ok) {
            return failure(this.normalizeDispatchError(handled.error as MessageHandlerMissingError, intent));
        }

        if (intent.type !== 'p10.read' && this.started) {
            const saved = this.persist();
            if (!saved.ok) return saved;
        }
        return success(handled.value);
    }

    /** One validated selection + kitchen/checkpoint mutation and one durable snapshot. */
    public startLevelAt(restaurantIndex: number, levelIndex: number, attemptId?: string): Result<P10BusinessReadModel, P10ApplicationError> {
        return this.commitBusiness(() => this.beginLevelAt(restaurantIndex, levelIndex,
            attemptId ?? this.idGenerator(`${this.config.idPrefix}-attempt-${this.clock()}`)));
    }

    public chooseRestaurant(index: number) { return this.commitBusiness(() => this.selectRestaurant(index)); }
    public chooseLevel(index: number) { return this.commitBusiness(() => this.selectLevel(index)); }
    public setLevelPage(page: number) { return this.commitBusiness(() => this.applyIntent({ type: 'p10.set-level-page', payload: { page } })); }
    public setStoryPage(page: number) { return this.commitBusiness(() => this.applyIntent({ type: 'p10.set-story-page', payload: { page } })); }
    public serve(dishId: string) { return this.commitBusiness(() => this.serveDish(dishId)); }
    public pauseRun() { return this.commitBusiness(() => { this.state.isPaused = true; return success(this.read()); }); }
    public resumeRun() { return this.commitBusiness(() => { this.state.isPaused = false; return success(this.read()); }); }
    public retryRun(reason: string) { return this.commitBusiness(() => this.restart(reason)); }
    public abandonRun() { return this.commitBusiness(() => { this.core.abandonCheckpoint(); this.state.kitchen = null; this.state.isPaused = false; return success(this.read()); }); }
    public continueAfterResult() { return this.commitBusiness(() => this.nextAfterResult()); }
    public buyUpgrade(restaurantId: string, stationId: string) { return this.commitBusiness(() => this.purchaseUpgrade(restaurantId, stationId)); }
    public setSetting(key: keyof GameSettings, value: number | boolean) { return this.commitBusiness(() => this.toggleSetting(key, value)); }
    public resumeSavedRun() { return this.commitBusiness(() => this.resumeCheckpoint()); }
    public resetProgress() { return this.commitBusiness(() => this.resetSave()); }

    private commitBusiness(operation: () => Result<P10BusinessReadModel, P10ApplicationError>): Result<P10BusinessReadModel, P10ApplicationError> {
        if (this.savePending || this.disposed || !this.started) return failure({ code: 'SAVE', message: 'Save pending or Cook not ready' });
        const handled = operation();
        if (!handled.ok) return handled;
        const saved = this.persist();
        return saved.ok ? success(this.read()) : saved;
    }

    private beginLevelAt(restaurantIndex: number, levelIndex: number, attemptId: string): Result<P10BusinessReadModel, P10ApplicationError> {
        const restaurant = this.restaurantCatalog.restaurants[restaurantIndex];
        const levelId = restaurant?.levelIds[levelIndex];
        const level = levelId ? resolveLevel(this.restaurantCatalog.levels, levelId) : null;
        if (!Number.isInteger(restaurantIndex) || !Number.isInteger(levelIndex) || !restaurant || !level
            || !this.core.progress.restaurants[restaurant.id]?.unlocked || !this.core.progress.levels[level.id]?.unlocked)
            return failure({ code: 'INVALID_OPERATION', message: 'Selected restaurant/level is unavailable or locked' });
        try {
            const run = this.core.startLevel(level.id, attemptId);
            this.state.selection = { restaurantIndex, levelIndex, levelPage: Math.floor(levelIndex / 6), storyPage: 0 };
            this.state.level = level;
            this.state.kitchen = run;
            this.state.isPaused = false;
            this.state.result = null;
            this.state.lastSuccess = false;
            this.refreshUpgradeQuotes();
            return success(this.read());
        } catch (cause) { return failure({ code: 'RUNTIME', message: String(cause) }); }
    }

    public update(deltaTime: number): void {
        if (!this.started || this.savePending || this.disposed || this.state.isPaused || this.state.kitchen === null) {
            return;
        }

        if (!Number.isFinite(deltaTime) || deltaTime < 0) {
            this.state.error = { code: 'INVALID_OPERATION', message: 'deltaTime must be finite and non-negative' };
            return;
        }

        try {
            const snapshot = this.state.kitchen.tick(deltaTime);
            if (snapshot.status !== RunStatus.Running) {
                const settlementId = this.idGenerator(`settlement-${snapshot.levelId}-${snapshot.attemptId}-${Math.floor(this.clock() * 1000)}`);
                this.state.result = this.core.settle(this.state.kitchen, settlementId);
                this.state.lastSuccess = this.state.result.success;
                this.state.kitchen = null;
                this.state.isPaused = true;
                this.publishEvent({
                    type: 'p10.settlement-applied',
                    payload: {
                        settlementId,
                        success: this.state.result.success,
                        stars: this.state.result.stars,
                    },
                });
                this.persist();
            }
            this.publishEvent({ type: 'p10.kitchen-updated', payload: { paused: this.state.isPaused } });
        } catch (error) {
            this.state.error = { code: 'RUNTIME', message: String(error) };
            this.state.isPaused = true;
            this.persist();
        }
    }

    public read(): P10BusinessReadModel {
        return {
            paused: this.state.isPaused,
            catalog: clone(this.restaurantCatalog),
            progress: clone(this.core.progress),
            upgradeQuotes: clone(this.state.upgradeQuotes),
            selection: {
                restaurantIndex: this.state.selection.restaurantIndex,
                levelIndex: this.state.selection.levelIndex,
                levelPage: this.state.selection.levelPage,
                storyPage: this.state.selection.storyPage,
            },
            level: this.state.level ? clone(this.state.level) : null,
            kitchen: this.state.kitchen ? clone(this.state.kitchen.snapshot) : null,
            result: this.state.result ? clone(this.state.result) : null,
            lastSuccess: this.state.lastSuccess,
            saveStatus: {
                ...this.state.saveStatus,
                details: {
                    ...this.state.saveStatus.details,
                    sectionErrors: [...this.state.saveStatus.details.sectionErrors],
                },
            },
            error: this.state.error ? { ...this.state.error } : null,
        };
    }

    public capture(): string {
        const saved = this.persist();
        return saved.ok ? saved.value : '';
    }

    public flush(): Result<string, P10ApplicationError> {
        if (!this.started && !this.savePending) return failure({ code: 'SAVE', message: 'Cook has not loaded a valid save' });
        return this.persist();
    }

    public retrySave(): Result<string, P10ApplicationError> {
        if (!this.savePending) return this.flush();
        const saved = this.persist();
        if (saved.ok && !this.started) {
            this.started = true;
            this.state.selection = this.resolveSelectionFromProgress(this.state.selection);
            this.syncFromCoreProgress();
        }
        return saved;
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.featureRuntime.deactivate();
        this.started = false;
    }

    public shutdown(): void { this.dispose(); }

    public subscribeToEvents(handler: (event: P10Event) => void): () => void {
        const disposers = QUERY_EVENT_TYPES.map((eventType) => this.messageBus.subscribe(eventType, handler));
        return () => {
            for (const dispose of disposers.reverse()) {
                dispose();
            }
        };
    }

    private applyIntent(intent: P10Intent): Result<P10BusinessReadModel, P10ApplicationError> {
        switch (intent.type) {
            case 'p10.select-restaurant':
                return this.selectRestaurant(intent.payload.restaurantIndex);
            case 'p10.set-level-page': {
                if (!Number.isInteger(intent.payload.page) || intent.payload.page < 0) {
                    return failure({ code: 'INVALID_INTENT', message: 'page must be non-negative integer' });
                }
                this.state.selection = {
                    ...this.state.selection,
                    levelPage: intent.payload.page,
                };
                return success(this.read());
            }
            case 'p10.set-story-page': {
                if (!Number.isInteger(intent.payload.page) || intent.payload.page < 0) {
                    return failure({ code: 'INVALID_INTENT', message: 'page must be non-negative integer' });
                }
                this.state.selection = {
                    ...this.state.selection,
                    storyPage: intent.payload.page,
                };
                return success(this.read());
            }
            case 'p10.select-level':
                return this.selectLevel(intent.payload.levelIndex);
            case 'p10.start-level':
                return this.beginLevelAt(this.state.selection.restaurantIndex, intent.payload.levelIndex ?? this.state.selection.levelIndex,
                    intent.payload.attemptId ?? this.idGenerator(`${this.config.idPrefix}-attempt-${this.clock()}`));
            case 'p10.serve-dish':
                return this.serveDish(intent.payload.dishId);
            case 'p10.pause':
                this.state.isPaused = true;
                return success(this.read());
            case 'p10.resume':
                this.state.isPaused = false;
                return success(this.read());
            case 'p10.restart':
                return this.restart(intent.payload.reason);
            case 'p10.abandon':
                this.core.abandonCheckpoint();
                this.state.kitchen = null;
                this.state.isPaused = false;
                return success(this.read());
            case 'p10.next-after-result':
                return this.nextAfterResult();
            case 'p10.purchase-upgrade':
                return this.purchaseUpgrade(intent.payload.restaurantId, intent.payload.stationId);
            case 'p10.toggle-setting':
                return this.toggleSetting(intent.payload.key, intent.payload.value);
            case 'p10.resume-checkpoint':
                return this.resumeCheckpoint();
            case 'p10.reset-save':
                return this.resetSave();
            default:
                return this.consumeQuery(intent);
        }
    }

    private consumeQuery(intent: P10Query): Result<P10BusinessReadModel, P10ApplicationError> {
        if (intent.type !== 'p10.read') {
            return failure({ code: 'INVALID_INTENT', message: `unsupported intent ${intent.type}` });
        }
        return success(this.read());
    }

    private selectRestaurant(index: number): Result<P10BusinessReadModel, P10ApplicationError> {
        const restaurant = this.restaurantCatalog.restaurants[index];
        if (restaurant === undefined) {
            return failure({ code: 'INVALID_OPERATION', message: `restaurant index out of range: ${index}` });
        }

        const progress = this.core.progress.restaurants[restaurant.id];
        if (!progress?.unlocked) {
            return failure({ code: 'INVALID_OPERATION', message: `restaurant is locked: ${restaurant.id}` });
        }

        this.state.selection = {
            restaurantIndex: index,
            levelIndex: 0,
            levelPage: 0,
            storyPage: 0,
        };
        this.state.level = resolveLevel(this.restaurantCatalog.levels, restaurant.levelIds[0]);
        this.state.result = null;
        this.state.lastSuccess = false;
        this.state.error = null;
        this.refreshUpgradeQuotes();
        return success(this.read());
    }

    private selectLevel(levelIndex: number): Result<P10BusinessReadModel, P10ApplicationError> {
        const restaurant = this.restaurantCatalog.restaurants[this.state.selection.restaurantIndex];
        const levelId = restaurant?.levelIds[levelIndex];
        if (levelId === undefined) {
            return failure({ code: 'INVALID_OPERATION', message: `level index out of range: ${levelIndex}` });
        }

        const level = resolveLevel(this.restaurantCatalog.levels, levelId);
        if (level === null) {
            return failure({ code: 'RUNTIME', message: `missing level config: ${levelId}` });
        }

        this.state.selection = {
            ...this.state.selection,
            levelIndex,
            levelPage: Math.floor(levelIndex / 6),
        };
        this.state.level = level;
        this.state.result = null;
        this.state.lastSuccess = false;
        this.refreshUpgradeQuotes();
        return success(this.read());
    }

    private startLevel(attemptId: string): Result<P10BusinessReadModel, P10ApplicationError> {
        if (this.state.level === null) {
            return failure({ code: 'INVALID_OPERATION', message: 'no level selected' });
        }

        const levelProgress = this.core.progress.levels[this.state.level.id];
        if (!levelProgress?.unlocked) {
            return failure({ code: 'INVALID_OPERATION', message: `level locked: ${this.state.level.id}` });
        }

        try {
            const run = this.core.startLevel(this.state.level.id, attemptId);
            this.state.kitchen = run;
            this.state.isPaused = false;
            this.state.result = null;
            this.state.lastSuccess = false;
            return success(this.read());
        } catch (error) {
            return failure({ code: 'RUNTIME', message: String(error) });
        }
    }

    private serveDish(dishId: string): Result<P10BusinessReadModel, P10ApplicationError> {
        if (this.state.kitchen === null) {
            return failure({ code: 'INVALID_OPERATION', message: 'no active kitchen run' });
        }

        const snapshot = this.state.kitchen.snapshot;
        const pendingOrders = snapshot.orders.filter((candidate) => candidate.state === 'Pending');
        if (pendingOrders.length === 0) {
            return failure({ code: 'INVALID_OPERATION', message: 'no pending order' });
        }

        const order = pendingOrders.find((candidate) => candidate.dishId === dishId);
        try {
            if (order === undefined) {
                this.state.kitchen.tick(3);
            } else {
                this.state.kitchen.serveOrder(order.id);
            }
        } catch (error) {
            return failure({ code: 'RUNTIME', message: String(error) });
        }

        const settledSnapshot = this.state.kitchen.snapshot;
        if (settledSnapshot.status !== RunStatus.Running) {
            const settlementId = this.idGenerator(`settlement-${settledSnapshot.levelId}-${settledSnapshot.attemptId}`);
            const receipt = this.core.settle(this.state.kitchen, settlementId);
            this.state.result = receipt;
            this.state.lastSuccess = receipt.success;
            this.state.kitchen = null;
            this.state.isPaused = true;
            this.publishEvent({
                type: 'p10.settlement-applied',
                payload: {
                    settlementId,
                    success: receipt.success,
                    stars: receipt.stars,
                },
            });
        }
        return success(this.read());
    }

    private restart(reason: string): Result<P10BusinessReadModel, P10ApplicationError> {
        if (!this.state.level) {
            return failure({ code: 'INVALID_OPERATION', message: 'no level selected' });
        }
        if (!reason.trim()) {
            return failure({ code: 'INVALID_INTENT', message: 'restart reason required' });
        }

        this.state.result = null;
        this.state.lastSuccess = false;
        this.state.kitchen = null;
        return this.startLevel(this.idGenerator(`restart-${reason}-${Math.floor(this.clock())}`));
    }

    private nextAfterResult(): Result<P10BusinessReadModel, P10ApplicationError> {
        if (this.state.result === null || this.state.level === null) {
            return failure({ code: 'INVALID_OPERATION', message: 'no settled level to continue' });
        }

        const restaurant = this.restaurantCatalog.restaurants[this.state.selection.restaurantIndex];
        if (restaurant === undefined) {
            return failure({ code: 'RUNTIME', message: 'selected restaurant is missing' });
        }

        if (this.state.lastSuccess && this.state.selection.levelIndex >= restaurant.levelIds.length - 1) {
            this.state.result = null;
            this.state.lastSuccess = false;
            return success(this.read());
        }

        if (this.state.lastSuccess) {
            const selected = this.selectLevel(this.state.selection.levelIndex + 1);
            if (!selected.ok) {
                return selected;
            }
        }

        return this.startLevel(this.idGenerator(`${this.config.idPrefix}-attempt-${this.clock()}`));
    }

    private resumeCheckpoint(): Result<P10BusinessReadModel, P10ApplicationError> {
        const resumed = this.core.resumeCheckpoint();
        if (!resumed) {
            return failure({ code: 'INVALID_OPERATION', message: 'no checkpoint available' });
        }
        this.syncCheckpointLevel(resumed.snapshot.levelId);
        this.state.kitchen = resumed;
        this.state.isPaused = false;
        this.state.result = null;
        return success(this.read());
    }

    private syncCheckpointLevel(levelId: string): void {
        const restaurantIndex = this.restaurantCatalog.restaurants.findIndex(restaurant => restaurant.levelIds.includes(levelId));
        const restaurant = this.restaurantCatalog.restaurants[restaurantIndex];
        const level = this.restaurantCatalog.levels.find(candidate => candidate.id === levelId);
        if (!restaurant || !level) throw new Error(`Checkpoint level is unavailable: ${levelId}`);
        const levelIndex = restaurant.levelIds.indexOf(levelId);
        this.state.selection = { restaurantIndex, levelIndex, levelPage: Math.floor(levelIndex / 6), storyPage: 0 };
        this.state.level = level;
        this.refreshUpgradeQuotes();
    }

    private purchaseUpgrade(restaurantId: string, stationId: string): Result<P10BusinessReadModel, P10ApplicationError> {
        const transactionId = this.idGenerator(`${this.config.idPrefix}-${restaurantId}-${stationId}`);
        try {
            const receipt = this.core.purchaseUpgrade(restaurantId, stationId, transactionId);
            this.refreshUpgradeQuotes();
            this.publishEvent({ type: 'p10.upgrade-applied', payload: { receipt: clone(receipt) } });
            return success(this.read());
        } catch (error) {
            return failure({ code: 'RUNTIME', message: String(error) });
        }
    }

    private toggleSetting(key: keyof GameSettings, value: number | boolean): Result<P10BusinessReadModel, P10ApplicationError> {
        const updated: Partial<GameSettings> = { [key]: value };
        try {
            this.core.updateSettings(updated);
            this.refreshUpgradeQuotes();
            return success(this.read());
        } catch (error) {
            return failure({ code: 'RUNTIME', message: String(error) });
        }
    }

    private resetSave(): Result<P10BusinessReadModel, P10ApplicationError> {
        this.saveCoordinator.clearSectionError();
        this.core = P10GameCore.createNew();
        this.state = this.createDefaultState();
        this.state.selection = this.resolveSelectionFromProgress(this.state.selection);
        this.refreshUpgradeQuotes();
        return success(this.read());
    }

    private syncFromCoreProgress(): void {
        const restaurant = this.restaurantCatalog.restaurants[this.state.selection.restaurantIndex] ?? this.restaurantCatalog.restaurants[0];
        const levelId = restaurant?.levelIds[this.state.selection.levelIndex];
        const resolvedLevelId = levelId && this.core.progress.levels[levelId]?.unlocked
            ? levelId
            : findLastUnlockedLevelId(restaurant, this.state.selection.levelIndex, this.core.progress.levels);

        this.state.level = resolvedLevelId ? resolveLevel(this.restaurantCatalog.levels, resolvedLevelId) : null;
        this.state.selection.levelIndex = this.state.level === null
            ? 0
            : Math.max(0, restaurant.levelIds.indexOf(this.state.level.id));
        this.state.selection.levelPage = Math.floor(this.state.selection.levelIndex / 6);
        this.refreshUpgradeQuotes();
    }

    private resolveSelectionFromProgress(current: P10Selection): P10MutableSelection {
        const firstUnlockedRestaurantId = this.restaurantCatalog.restaurants.find((candidate) => {
            return this.core.progress.restaurants[candidate.id]?.unlocked;
        });
        const fallbackRestaurant = firstUnlockedRestaurantId ? this.restaurantCatalog.restaurants.indexOf(firstUnlockedRestaurantId) : 0;

        let restaurantIndex = current.restaurantIndex;
        if (!this.restaurantCatalog.restaurants[restaurantIndex]
            || !this.core.progress.restaurants[this.restaurantCatalog.restaurants[restaurantIndex].id]?.unlocked) {
            restaurantIndex = fallbackRestaurant;
        }

        const restaurant = this.restaurantCatalog.restaurants[restaurantIndex] ?? this.restaurantCatalog.restaurants[fallbackRestaurant] ?? this.restaurantCatalog.restaurants[0];
        const lastLevelIndex = restaurant
            ? restaurant.levelIds.findIndex((levelId) => !this.core.progress.levels[levelId]?.unlocked)
            : 0;
        const levelIndex = Math.max(0, (lastLevelIndex > 0 ? lastLevelIndex - 1 : 0));

        return {
            restaurantIndex,
            levelIndex,
            levelPage: Math.floor(levelIndex / 6),
            storyPage: Math.max(0, Math.floor(current.storyPage)),
        };
    }

    private refreshUpgradeQuotes(): void {
        const restaurant = this.restaurantCatalog.restaurants[this.state.selection.restaurantIndex];
        if (restaurant === undefined) {
            this.state.upgradeQuotes = {};
            return;
        }
        this.state.upgradeQuotes = buildUpgradeQuotes(this.core, restaurant);
    }

    private persist(): Result<string, P10ApplicationError> {
        const saved = this.saveCoordinator.save();
        if (!saved.ok) {
            this.state.saveStatus = this.toSaveStatus('error', [mapSectionError(saved.error)]);
            this.state.error = { code: 'SAVE', message: `${saved.error.code}: ${saved.error.cause ?? ''}` };
            this.savePending = true;
            return failure({ code: 'SAVE', message: this.state.error.message });
        }
        this.savePending = false;
        this.state.error = null;
        this.state.saveStatus = this.toSaveStatus('ready');
        this.publishEvent({
            type: 'p10.save-status-changed',
            payload: { state: this.state.saveStatus.state },
        });
        return success(saved.value);
    }

    private toSaveStatus(
        state: SaveStatus,
        sectionErrors: readonly SaveSectionProblem[] = this.collectSectionErrors(),
    ): SaveStatusView {
        return {
            state,
            details: {
                key: this.saveScope.primaryKey,
                sectionErrors,
            },
        };
    }

    private collectSectionErrors(): Array<SaveSectionProblem> {
        const sectionError = this.saveCoordinator.lastSectionError();
        return sectionError === null ? [] : [mapSectionError(sectionError)];
    }

    private publishEvent(event: P10Event): void {
        this.messageBus.publish(event);
    }

    private validateConfig(input: unknown): Result<P10Config, ConfigValidationError> {
        if (typeof input !== 'object' || input === null) {
            return failure({ code: 'INVALID_CONFIG', path: '$', message: 'config must be object' });
        }
        const source = input as Record<string, unknown>;
        const autoResumeCheckpoint = source.autoResumeCheckpoint;
        const idPrefix = source.idPrefix;

        if (autoResumeCheckpoint !== undefined && typeof autoResumeCheckpoint !== 'boolean') {
            return failure({ code: 'INVALID_CONFIG', path: '$.autoResumeCheckpoint', message: 'must be boolean' });
        }
        if (idPrefix !== undefined && (typeof idPrefix !== 'string' || idPrefix.trim().length === 0)) {
            return failure({ code: 'INVALID_CONFIG', path: '$.idPrefix', message: 'must be non-empty string' });
        }

        return success({
            autoResumeCheckpoint: autoResumeCheckpoint ?? DEFAULT_P10_APP_CONFIG.autoResumeCheckpoint,
            idPrefix: idPrefix ?? DEFAULT_P10_APP_CONFIG.idPrefix,
        });
    }

    private normalizeDispatchError(
        error: MessageHandlerMissingError,
        intent: P10Intent | P10Query,
    ): P10ApplicationError {
        if (error.code === 'MESSAGE_HANDLER_MISSING') {
            return { code: 'INVALID_INTENT', message: `no handler for ${error.messageType}` };
        }
        return { code: 'INVALID_OPERATION', message: intent.type };
    }

    private createDefaultState(): P10RuntimeState {
        return {
            selection: {
                restaurantIndex: 0,
                levelIndex: 0,
                levelPage: 0,
                storyPage: 0,
            },
            level: null,
            kitchen: null,
            result: null,
            lastSuccess: false,
            saveStatus: this.toSaveStatus('unknown', []),
            error: null,
            isPaused: false,
            upgradeQuotes: {},
        };
    }
}

function buildUpgradeQuotes(core: P10GameCore, restaurant: RestaurantConfig): Record<string, UpgradeQuote> {
    const quote: Record<string, UpgradeQuote> = {};
    for (const stationId of ['grill', 'prep', 'tray']) {
        quote[stationId] = core.getUpgradeQuote(restaurant.id, stationId);
    }
    return quote;
}

function resolveLevel(levels: readonly LevelConfig[], levelId: string): LevelConfig | null {
    return levels.find((candidate) => candidate.id === levelId) ?? null;
}

function findLastUnlockedLevelId(
    restaurant: RestaurantConfig,
    fromIndex: number,
    levels: Readonly<Record<string, { readonly unlocked: boolean }>>,
): string {
    const start = Math.max(0, Math.min(fromIndex, restaurant.levelIds.length - 1));
    for (let index = start; index >= 0; index -= 1) {
        const levelId = restaurant.levelIds[index];
        if (levels[levelId]?.unlocked) {
            return levelId;
        }
    }
    return restaurant.levelIds[0];
}

function mapSectionError(error: { readonly code: string; readonly sectionId: string; readonly cause?: string }): SaveSectionProblem {
    return {
        code: error.code as SaveSectionProblem['code'],
        sectionId: error.sectionId,
        cause: error.cause,
    };
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}
