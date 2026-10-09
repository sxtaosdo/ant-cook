import { _decorator, Camera, Canvas, Component, director, Director, Label, Layers, Node, ResolutionPolicy, sys, UITransform, view } from 'cc';
import { StateMachine, type IState } from 'db://shidai3/index';
import mk from 'mk';
import { BUILD_MODES } from './buildModes';
import { ModuleEntryGate, type ModeId, type SceneDriver, type EntrySource } from './contracts';
import { ShellPromotion } from './promotion';
import { SwitchCoordinator } from './switchCoordinator';
import { ProductNavigationView } from './productNavigationView';
import { PRODUCT_BUILD_VERSION } from './buildInfo';
import { TelemetryClient } from './observability/telemetryClient';
import { LocalRecordingAdapter } from './observability/telemetryAdapters';

const { ccclass, property } = _decorator;
const SHELL_LAYER = 1 << 19;

abstract class ShellState implements IState<ProductBootstrap> {
  context!: ProductBootstrap;
  abstract enter(): void;
  exit(): void {}
}
export class ShellBootState extends ShellState { enter() { this.context.setStatus('准备双玩法入口'); } }
export class ShellEntryState extends ShellState { enter() { this.context.setStatus('选择玩法'); } }
export class ShellRunningState extends ShellState { enter() { this.context.setStatus('可随时继续当前玩法'); this.context.hideNavigation(); } }
export class ShellSwitchingState extends ShellState { enter() { this.context.setStatus('正在准备玩法，请稍候'); } }
export class ShellRecoverState extends ShellState { enter() { this.context.setStatus('切换未完成，可重试保存或重新选择'); } }

/** The one persistent product entry. Gameplay scenes retain their own page StateMachine. */
@ccclass('ProductBootstrap')
export class ProductBootstrap extends Component {
  @property(ProductNavigationView) public navigationView: ProductNavigationView | null = null;
  @property(Camera) public shellCamera: Camera | null = null;
  @property(Canvas) public shellCanvas: Canvas | null = null;
  // Opt-in local diagnosis requires real source/build metadata; empty values fail closed.
  @property public recordLocalTelemetry = false;
  @property public telemetrySourceCommit = '';
  @property public telemetryBuildId = '';
  readonly StateMachine = new StateMachine<ProductBootstrap>(this);
  private telemetry: TelemetryClient | null = null;
  private readonly telemetryRecords = new LocalRecordingAdapter();
  private telemetrySessionId = '';
  private telemetryStartedAt = 0;
  private telemetryReadyRecorded = false;
  private coordinator: SwitchCoordinator | null = null;
  private status: Label | null = null;
  private transitioning = false;
  private navigationRoot: Node | null = null;
  private navigationEpoch = 0;
  private promotions: ShellPromotion | null = null;
  private promotion: { source: ModeId; target: ModeId } | null = null;

  protected onLoad(): void { void this.boot().catch(cause => this.setStatus(String(cause))); }

  private async boot(): Promise<void> {
    if (this.node.parent !== director.getScene()) throw new Error('Bootstrap root must be a direct scene child');
    Layers.addLayer('ProductShell', 19);
    this.node.layer = SHELL_LAYER;
    director.addPersistRootNode(this.node);
    view.setDesignResolutionSize(750, 1334, ResolutionPolicy.FIXED_WIDTH);
    this.initializeTelemetry();
    this.initializeNavigation();
    await this.StateMachine.changeState(ShellBootState);
    const driver: SceneDriver = {
      preflight: async descriptor => {
        const bundle = await mk.bundle.load(descriptor.bundleName);
        if (!bundle) throw new Error(`玩法资源未就绪：${descriptor.id}`);
        await new Promise<void>((resolve, reject) => bundle.preloadScene(descriptor.sceneName, err => err ? reject(err) : resolve()));
      },
      enter: async (descriptor, entry) => {
        ModuleEntryGate.bind({ ...entry,
          requestNavigation: () => entry.isCurrent() && this.showNavigation(),
          isNavigationCovered: () => this.navigationRoot?.activeInHierarchy ?? false,
        });
        // Completion of loadScene is deliberately separate from the gameplay moduleReady report.
        const scene = await mk.bundle.loadScene(descriptor.sceneName, { bundleStr: descriptor.bundleName, launchGuardFunc: entry.isCurrent });
        if (!scene) throw new Error(`玩法场景未进入：${descriptor.id}`);
      },
    };
    this.coordinator = new SwitchCoordinator(BUILD_MODES, driver, sys.localStorage, undefined, this.telemetry ?? undefined);
    this.promotions = new ShellPromotion(sys.localStorage);
    await this.StateMachine.changeState(ShellEntryState);
    const launch = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('mode');
    const requested = launch === 'ant' || launch === 'cook' ? launch : this.coordinator.lastPlayed;
    const mode = BUILD_MODES.some(d => d.id === requested) ? requested! : BUILD_MODES[0].id;
    await this.openMode(mode, 'launch');
    if (BUILD_MODES.length > 1) this.schedule(this.checkPromotion, 1);
  }

  public enterAnt(): void { void this.openMode('ant'); }
  public enterCook(): void { void this.openMode('cook'); }
  public retrySave(): void {
    if (this.transitioning) return;
    if (this.StateMachine.is(ShellRunningState)) {
      if (this.coordinator?.hasPendingMetadata) { const ok = this.coordinator.retryMetadata(); this.setStatus(ok ? '入口记录已保存' : '入口记录仍待保存，可继续当前玩法'); this.revealNavigation(); }
      return;
    }
    if (!this.StateMachine.is(ShellRecoverState)) return;
    if (this.coordinator?.cleanupBlockedMode) {
      void this.coordinator.retryCleanup().then(ok => this.setStatus(ok ? '清理完成，可重新选择玩法' : '玩法清理未完成，请重试清理'));
    } else void this.coordinator?.retrySave().then(async ok => {
      const businessReady = ok || !!this.coordinator?.onlyMetadataPending;
      if (businessReady) { await this.StateMachine.changeState(ShellRunningState); this.recordSessionReady(); }
      this.setStatus(businessReady ? (this.coordinator?.hasPendingMetadata ? '存档已恢复，入口记录待保存；可继续当前玩法' : '保存和页面恢复完成，可继续或切换') : '保存或页面恢复未完成，可重试或重新选择玩法');
      if (!ok) this.revealNavigation();
    });
  }

  private async openMode(mode: ModeId, source: EntrySource = 'manual'): Promise<void> {
    if (!this.coordinator || this.transitioning) return;
    this.transitioning = true;
    this.promotion = null;
    try {
      await this.StateMachine.changeState(ShellSwitchingState);
      this.revealNavigation();
      const result = await this.coordinator.switchTo(mode, source);
      await this.StateMachine.changeState(result.ok || (!result.ok && (result.recoveredMode || result.canContinue)) ? ShellRunningState : ShellRecoverState);
      this.recordSessionReady();
      if (!result.ok) {
        const reasons: Record<string, string> = { playing: '当前关卡进行中，完成后可切换', adShowing: '广告播放中，请结束后再试', rewardPending: '奖励处理中，请稍候', saveFailed: '存档尚未保存，请重试保存' };
        const message = reasons[result.reason] ?? (this.coordinator.cleanupBlockedMode ? '玩法清理未完成，请重试清理' : result.canContinue || result.recoveredMode ? '目标玩法暂未准备好，稍后可重试' : '保存或页面恢复未完成，请重试');
        this.setStatus(`${result.canContinue || result.recoveredMode ? '可继续当前玩法' : '玩法尚未就绪'}；${message}`); this.revealNavigation();
      }
      else if (result.metadataPending) this.setStatus('玩法已就绪，入口记录待保存');
    } finally { this.transitioning = false; }
  }

  private initializeTelemetry(): void {
    try {
      this.telemetryStartedAt = Date.now();
      this.telemetrySessionId = `shell-${this.telemetryStartedAt.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      this.telemetry = new TelemetryClient({ enabled: this.recordLocalTelemetry, adapter: this.telemetryRecords,
        context: { product: 'ant-cook', gameplay: 'shell', environment: 'development',
          platform: sys.isNative ? 'native' : sys.platform === sys.Platform.WECHAT_GAME ? 'wechat' : 'web',
          sessionId: this.telemetrySessionId, release: PRODUCT_BUILD_VERSION,
          commit: this.telemetrySourceCommit, buildId: this.telemetryBuildId } });
      this.telemetry.track('session_started', { entry: 'launch' }, { factId: this.telemetrySessionId });
      this.telemetry.flush();
    } catch { /* Diagnosis never blocks product initialization. */ }
  }

  private recordSessionReady(): void {
    if (!this.coordinator?.currentMode || !this.StateMachine.is(ShellRunningState)) return;
    try {
      if (!this.telemetryReadyRecorded) {
        this.telemetryReadyRecorded = true;
        this.telemetry?.track('session_ready', { durationMs: Math.min(86400000, Math.max(0, Date.now() - this.telemetryStartedAt)) },
          { factId: this.telemetrySessionId });
      }
      this.telemetry?.flush();
    } catch { /* A telemetry failure cannot cover or interrupt ready gameplay. */ }
  }

  public setStatus(text: string): void { if (this.status) this.status.string = text; }

  public showNavigation(): boolean {
    if (this.transitioning || !this.StateMachine.is(ShellRunningState)) return false;
    if (!this.promotion) this.revealNavigation();
    return true;
  }

  private readonly checkPromotion = (): void => {
    // Cook's update promise settles between frames. Read before the next update,
    // retaining its real page-task guard instead of treating an in-flight page as safe.
    director.once(Director.EVENT_BEFORE_UPDATE, this.offerPromotion, this);
  };

  private readonly offerPromotion = (): void => {
    if (!this.isValid || !this.enabledInHierarchy) return;
    if (this.transitioning || !this.StateMachine.is(ShellRunningState) || this.navigationRoot?.activeInHierarchy) return;
    const source = this.coordinator?.promotionSource;
    if (!source || !this.promotions?.canOffer(source)) return;
    const target: ModeId = source === 'ant' ? 'cook' : 'ant';
    if (!BUILD_MODES.some(mode => mode.id === target)) return;
    this.promotion = { source, target };
    this.revealNavigation(); this.navigationView!.recommend(target);
    this.setStatus(source === 'ant' ? '已首次通关18关，试试星际美食家？' : '首家餐厅已完成，试试蚂蚁搬搬搬？');
    this.promotions.markShown(source);
  };

  private continueCurrent(): void {
    if (this.transitioning || !this.StateMachine.is(ShellRunningState)) return;
    if (this.promotion) {
      try { this.promotions!.decline(this.promotion.source); }
      catch { this.setStatus('暂缓记录未保存，请再次点击暂时不玩重试'); return; }
      this.promotion = null;
    }
    this.hideNavigation();
  }

  protected onDestroy(): void {
    this.unschedule(this.checkPromotion);
    director.off(Director.EVENT_BEFORE_UPDATE, this.offerPromotion, this);
  }

  private revealNavigation(): void {
    this.navigationEpoch++;
    const root = this.navigationRoot;
    if (!root) return;
    const size = view.getVisibleSize(), safe = sys.getSafeAreaRect(false);
    const running = this.StateMachine.is(ShellRunningState);
    this.navigationView!.reveal(BUILD_MODES.map(mode => mode.id), this.coordinator?.currentMode ?? null,
      running, this.StateMachine.is(ShellRecoverState) || !!this.coordinator?.hasPendingMetadata,
      running ? '重试入口记录' : '重试保存与恢复', size.width, size.height,
      safe.x + safe.width / 2 - size.width / 2, safe.y + safe.height / 2 - size.height / 2);
    this.shellCamera!.orthoHeight = size.height / 2;
  }

  public hideNavigation(): void {
    if (this.transitioning && !this.StateMachine.is(ShellRunningState)) return;
    const epoch = ++this.navigationEpoch;
    // Cook uses global input: retain the modal guard until this touch finishes.
    director.once(Director.EVENT_AFTER_DRAW, () => {
      if (epoch === this.navigationEpoch && this.navigationRoot?.isValid) this.navigationRoot.active = false;
    });
  }

  private initializeNavigation(): void {
    if (!this.navigationView || !this.shellCamera || !this.shellCanvas) throw new Error('Bootstrap UI bindings are incomplete');
    this.navigationRoot = this.navigationView.node;
    this.status = this.navigationView.statusLabel;
    this.shellCanvas.cameraComponent = this.shellCamera;
    const size = view.getVisibleSize();
    this.node.getComponent(UITransform)?.setContentSize(size.width, size.height);
    this.shellCamera.orthoHeight = size.height / 2;
    this.navigationView.configure({
      enter: mode => {
        if (this.promotion && mode !== this.promotion.target) { this.continueCurrent(); return; }
        void this.openMode(mode, this.promotion ? 'promotion' : 'manual');
      },
      continueCurrent: () => this.continueCurrent(),
      retry: () => this.retrySave(),
    });
    this.revealNavigation();
  }
}
