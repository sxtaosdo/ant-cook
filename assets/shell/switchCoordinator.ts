import type { GameplayModule, LocalStoragePort, ModeId, ModuleDescriptor, ModuleEntry, ModuleReady,
  SceneDriver, SwitchResult, EntrySource, ProductTelemetryPort } from './contracts';
import { ProductStorage } from './productStorage';

interface Navigation { version: 1; lastPlayed?: ModeId; }
class StartupSaveBlocked extends Error {}

/** Serializes product mode transitions. UI pages remain owned by their P0002 state machines. */
export class SwitchCoordinator {
  private active: GameplayModule | null = null;
  private entry: ModuleEntry | null = null;
  private generation = 0;
  private flight: { target: ModeId; promise: Promise<SwitchResult> } | null = null;
  private navigation: Navigation = { version: 1 };
  private pendingNavigation: Navigation | null = null;
  private pendingStart: { module: GameplayModule; mode: ModeId; ready: Promise<GameplayModule> } | null = null;
  private retryingSave = false;
  /** Remains true through save/page recovery rejection, even if canLeave says playing. */
  private businessRecoveryPending = false;
  private cleanupBlocked: { module: GameplayModule; mode: ModeId; cause: unknown } | null = null;
  private cleanupRetry: Promise<boolean> | null = null;
  public navigationWarning: string | null = null;
  private readonly shellStorage: ProductStorage;

  constructor(private readonly descriptors: readonly ModuleDescriptor[], private readonly driver: SceneDriver,
    private readonly backend: LocalStoragePort, private readonly readyTimeoutMs = 30000,
    private readonly telemetry?: ProductTelemetryPort) {
    if (descriptors.length === 0 || new Set(descriptors.map(d => d.id)).size !== descriptors.length)
      throw new Error('Build must contain distinct gameplay descriptors');
    this.shellStorage = new ProductStorage(backend, 'shell');
    try {
    const raw = this.shellStorage.getItem('navigation');
    if (raw) {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1)
        throw new Error('Invalid shell navigation');
      const lastPlayed = 'lastPlayed' in value ? value.lastPlayed : undefined;
      if (lastPlayed !== undefined && lastPlayed !== 'ant' && lastPlayed !== 'cook') throw new Error('Invalid last played mode');
      this.navigation = { version: 1, ...(lastPlayed && descriptors.some(d => d.id === lastPlayed) ? { lastPlayed } : {}) };
    }
    } catch (cause) {
      this.navigationWarning = `Entry record unavailable: ${String(cause)}`;
      // Only shell metadata is discarded in memory. Gameplay namespaces remain untouched.
      this.navigation = { version: 1 };
    }
  }

  get currentMode(): ModeId | null { return this.active?.id ?? null; }
  get isSwitching(): boolean { return this.flight !== null; }
  get lastPlayed(): ModeId | undefined { return this.navigation.lastPlayed; }
  get cleanupBlockedMode(): ModeId | null { return this.cleanupBlocked?.mode ?? null; }
  get hasPendingMetadata(): boolean { return this.pendingNavigation !== null; }
  get onlyMetadataPending(): boolean { return !!this.pendingNavigation && !!this.active && !this.pendingStart && !this.cleanupBlocked && !this.businessRecoveryPending && this.active.canLeave() !== 'saveFailed'; }

  switchTo(target: ModeId, source: EntrySource = 'manual'): Promise<SwitchResult> {
    if (this.cleanupBlocked || this.cleanupRetry) return Promise.resolve({ ok: false, reason: `Cleanup incomplete: ${this.cleanupBlocked?.mode ?? 'retry in progress'}` });
    if (this.retryingSave) return Promise.resolve({ ok: false, reason: 'A save retry is already running' });
    if (this.pendingStart) return Promise.resolve({ ok: false, reason: 'Initial gameplay save is pending; retry save first' });
    if (this.flight) return this.flight.target === target ? this.flight.promise
      : Promise.resolve({ ok: false, reason: 'A mode transition is already running' });
    if (!this.descriptors.some(d => d.id === target)) return Promise.resolve({ ok: false, reason: 'Mode is not included in this build' });
    if (this.active?.id === target) {
      if (this.businessRecoveryPending || this.active.canLeave() === 'saveFailed') {
        this.businessRecoveryPending = true;
        return Promise.resolve({ ok: false, reason: 'Save or page recovery is pending', canContinue: false });
      }
      return Promise.resolve({ ok: true, mode: target, metadataPending: this.pendingNavigation !== null });
    }
    const promise = this.performSwitch(target, source);
    this.flight = { target, promise };
    void promise.finally(() => { if (this.flight?.promise === promise) this.flight = null; });
    return promise;
  }

  async retrySave(): Promise<boolean> {
    if (this.flight || this.retryingSave || this.cleanupBlocked || this.cleanupRetry) return false;
    if (this.onlyMetadataPending) return this.retryMetadata();
    const module = this.pendingStart?.module ?? this.active;
    const mode = this.pendingStart?.mode ?? this.active?.id;
    if (!module || !mode) return false;
    this.retryingSave = true;
    this.businessRecoveryPending = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Save readiness retry timed out')), this.readyTimeoutMs); });
      const saved = await Promise.race([module.flush(), timeout]);
      if (saved.ok && this.pendingStart) {
        this.active = await Promise.race([this.pendingStart.ready, timeout]);
        this.recordSwitchCompleted('shell', this.active.id);
        this.pendingStart = null;
        this.pendingNavigation = { version: 1, lastPlayed: this.active.id };
        this.retryMetadata();
      }
      if (saved.ok) { module.resumeInput(); this.businessRecoveryPending = false; }
      return saved.ok && this.retryMetadata();
    } catch {
      if (this.pendingStart) {
        this.pendingStart = null;
        this.entry = null;
        try { await this.closeOwned(module, 'recovery', mode); } catch { /* retained for explicit cleanup retry */ }
      }
      return false;
    }
    finally { if (timer) clearTimeout(timer); this.retryingSave = false; }
  }

  /** Cleanup has no timeout: only successful settlement permits another instance to enter. */
  retryCleanup(): Promise<boolean> {
    if (this.cleanupRetry) return this.cleanupRetry;
    if (this.flight || this.retryingSave || !this.cleanupBlocked) return Promise.resolve(false);
    const { module: owner, mode } = this.cleanupBlocked;
    const task = (async () => {
      try { await this.closeOwned(owner, 'recovery', mode); return true; }
      catch { return false; }
    })().finally(() => { if (this.cleanupRetry === task) this.cleanupRetry = null; });
    this.cleanupRetry = task;
    return task;
  }

  private async closeOwned(module: GameplayModule, reason: 'switch' | 'recovery', mode: ModeId): Promise<void> {
    this.entry = null;
    this.active = null;
    try {
      await module.close(reason);
      if (this.cleanupBlocked?.module === module) this.cleanupBlocked = null;
    } catch (cause) {
      this.cleanupBlocked = { module, mode, cause };
      throw cause;
    }
  }

  retryMetadata(): boolean {
    if (!this.pendingNavigation) return true;
    try {
      this.shellStorage.setItem('navigation', JSON.stringify(this.pendingNavigation));
      this.navigation = this.pendingNavigation;
      this.pendingNavigation = null;
      return true;
    } catch { return false; }
  }

  private async performSwitch(target: ModeId, source: EntrySource): Promise<SwitchResult> {
    const previous = this.active;
    const previousMode = previous?.id ?? null; // Cocos destruction can clear component fields.
    let closeStarted = false;
    try {
      const descriptor = this.descriptor(target);
      await this.bounded(this.driver.preflight(descriptor), 'Gameplay preload timed out');
      if (previous) {
        if (!previousMode) return { ok: false, reason: 'Source gameplay identity unavailable', canContinue: false };
        const leave = previous.canLeave();
        if (this.businessRecoveryPending || leave !== 'ready') {
          if (leave === 'saveFailed') this.businessRecoveryPending = true;
          return { ok: false, reason: leave, canContinue: !this.businessRecoveryPending };
        }
        this.businessRecoveryPending = true;
        const prepared = await previous.prepareExit();
        if (prepared !== 'ready') { previous.resumeInput(); this.businessRecoveryPending = prepared === 'saveFailed'; return { ok: false, reason: prepared, canContinue: !this.businessRecoveryPending }; }
        const saved = await previous.flush();
        if (!saved.ok) return { ok: false, reason: saved.reason, canContinue: false };
        this.businessRecoveryPending = false;
        closeStarted = true;
        this.entry = null;
        // A cleanup timeout cannot prove global registrations have been released.
        // Keep the transaction serialized until cleanup settles before reusing a mode's keys.
        await this.closeOwned(previous, 'switch', previousMode);
        this.active = null;
      }
      this.active = await this.enterReady(descriptor, source, previous === null);
      this.recordSwitchCompleted(previousMode ?? 'shell', this.active.id);
      this.businessRecoveryPending = false;
      this.pendingNavigation = { version: 1, lastPlayed: target };
      return { ok: true, mode: target, metadataPending: !this.retryMetadata() };
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      if (cause instanceof StartupSaveBlocked && this.pendingStart) return { ok: false, reason };
      if (this.cleanupBlocked) return { ok: false, reason: `${reason}; cleanup incomplete: ${this.cleanupBlocked.mode}` };
      if (!closeStarted && previous) { if (!this.businessRecoveryPending) previous.resumeInput(); return { ok: false, reason, canContinue: !this.businessRecoveryPending && previous.canLeave() !== 'saveFailed' }; }
      this.active = null;
      if (previous && previousMode) {
        try {
          await this.bounded(this.driver.preflight(this.descriptor(previousMode)), 'Source recovery preload timed out');
          this.active = await this.enterReady(this.descriptor(previousMode), 'recovery');
          this.businessRecoveryPending = false;
          return { ok: false, reason, recoveredMode: previousMode };
        } catch (recoveryError) {
          return { ok: false, reason: `${reason}; source recovery failed: ${String(recoveryError)}` };
        }
      }
      return { ok: false, reason };
    }
  }

  private recordSwitchCompleted(from: ModeId | 'shell', to: ModeId): void {
    const entry = this.entry;
    if (from === to || !entry || entry.mode !== to || !entry.isCurrent()) return;
    try { this.telemetry?.track('gameplay_switch_completed', { from, to }, { factId: entry.transactionId }); }
    catch { /* Instrumentation cannot turn an activated gameplay into a failed switch. */ }
  }

  private descriptor(mode: ModeId): ModuleDescriptor {
    const descriptor = this.descriptors.find(d => d.id === mode);
    if (!descriptor) throw new Error('Excluded gameplay');
    return descriptor;
  }

  private async bounded<T>(operation: Promise<T>, message: string): Promise<T> {
    let timer!: ReturnType<typeof setTimeout>;
    try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), this.readyTimeoutMs); })]); }
    finally { clearTimeout(timer); }
  }

  private async enterReady(descriptor: ModuleDescriptor, source: EntrySource, keepInitialSave = false): Promise<GameplayModule> {
    const generation = ++this.generation;
    const transactionId = `switch-${generation}`;
    let attached: GameplayModule | null = null;
    let completion!: Promise<GameplayModule>;
    let resolveReady!: (module: GameplayModule) => void;
    let rejectReady!: (cause: unknown) => void;
    let settled = false;
    const ready = new Promise<GameplayModule>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    let rejectBlocked!: (cause: StartupSaveBlocked) => void;
    const blocked = new Promise<never>((_, reject) => { rejectBlocked = reject; });
    void blocked.catch(() => undefined);
    void ready.catch(() => undefined);
    const entry: ModuleEntry = {
      mode: descriptor.id, transactionId, generation, source,
      storage: new ProductStorage(this.backend, descriptor.id),
      isCurrent: () => this.entry === entry,
      attach: module => {
        if (this.entry !== entry || module.id !== descriptor.id || (attached && attached !== module)) throw new Error('Stale or duplicate module');
        attached = module;
      },
      ready: (report: ModuleReady) => {
        if (settled || this.entry !== entry || report.transactionId !== transactionId || report.mode !== descriptor.id) return;
        if (attached && report.businessReady && report.firstFrameReady) { settled = true; resolveReady(attached); }
      },
      saveBlocked: cause => {
        if (this.entry !== entry || !attached) return;
        const error = new StartupSaveBlocked(String(cause));
        if (keepInitialSave) this.pendingStart = { module: attached, mode: descriptor.id, ready: completion };
        rejectBlocked(error);
      },
      fail: cause => { if (!settled && this.entry === entry) { settled = true; rejectReady(cause); } },
    };
    this.entry = entry;
    let timeout!: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Gameplay readiness timed out')), this.readyTimeoutMs); });
    const readinessFailure = ready.then(() => new Promise<never>(() => undefined));
    // Defer entry invocation until this same combined promise is available to saveBlocked.
    completion = Promise.resolve().then(() => this.driver.enter(descriptor, entry)).then(() => ready);
    void completion.catch(() => undefined);
    try {
      return await Promise.race([completion, readinessFailure, blocked, deadline]);
    } catch (cause) {
      if (cause instanceof StartupSaveBlocked && keepInitialSave && this.pendingStart) throw cause;
      if (this.entry === entry) this.entry = null;
      const failedModule = attached as GameplayModule | null;
      if (failedModule) await this.closeOwned(failedModule, 'recovery', descriptor.id);
      throw cause;
    } finally { clearTimeout(timeout); }
  }
}
