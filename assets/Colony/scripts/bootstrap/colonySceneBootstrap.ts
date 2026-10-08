import {
  _decorator,
  Camera,
  Canvas,
  Component,
  director,
  Director,
  game,
  Game,
  Layers,
  Node,
  ResolutionPolicy,
  SpriteFrame,
  sys,
  UITransform,
  view,
} from 'cc';
import { StateMachine } from 'db://shidai3/index';
import { ModuleEntryGate, type GameplayModule, type LeaveStatus, type ModuleEntry, type SaveOutcome } from '../../../shell/contracts';
import mk from 'mk';
import GlobalConfig from 'GlobalConfig';
import { ColonyResultFailView } from '../../popups/resultFail/script/resultFailView';
import { ColonyResultSuccessView } from '../../popups/resultSuccess/script/resultSuccessView';
import { AppModel } from '../application/appModel';
import { PlayerProgress, PROGRESS_SAVE_KEY, PROGRESS_BACKUP_KEY, type ProgressRound } from '../application/playerProgress';
import { PlayerProfile } from '../application/playerProfile';
import { COLONY_BUILD_VERSION } from '../application/buildInfo';
import type { LeaderboardConfig } from '../application/leaderboard/leaderboard';
import type { SocialConfig } from '../application/social/social';
import { RewardedAds, type WeChatAdsPort } from '../application/rewardedAds';
import { UserSettings } from '../application/userSettings';
import { InstallationIdentity } from '../application/installationIdentity';
import type { GmTestSession } from '../testing/gmTestSession';
import { ProgressControl } from '../../popups/progress/script/progressControl';
import { ColonyProgressView } from '../../popups/progress/script/progressView';
import { ColonyCommunityView } from '../../popups/progress/script/communityView';
import { CommunityControl } from '../../popups/progress/script/communityControl';
import { ColonySettingsView } from '../../popups/settings/script/settingsView';
import { ColonyConfirmView } from '../../popups/confirm/script/confirmView';
import { ColonyShopView } from '../../popups/shop/script/shopView';
import { ColonyToastView } from '../../popups/toast/script/toastView';
import { ToastPresentation } from '../presentation/toastPresentation';
import type { ToolControl } from '../../popups/tool/script/toolControl';
import { ColonyToolView } from '../../popups/tool/script/toolView';
import type { DevelopmentLevelCatalog } from '../application/levelCatalog';
import { ColonyUtil } from '../colonyUtil';
import { ColonyFlowModel } from '../gameModel';
import type { ColonySoundName } from '../presentation/colonyViews';
import { LoadingState } from '../presentation/pageStates/loadingState';
import { PlayState } from '../presentation/pageStates/playState';
import { DailyActivityPresentation } from '../presentation/dailyActivityPresentation';
import { ColonyTestBridge } from '../testing/colonyTestBridge';
import { ColonyBoardView } from '../views/boardView';
import { ColonyHomeView } from '../views/homeView';
import { ColonyConstructionView } from '../views/constructionView';
import { ColonyHudView } from '../views/hudView';
import type { ColonyCurrencyOverlayView } from '../views/currencyOverlayView';
import { ColonyLoadingView } from '../views/loadingView';
import { ColonySlotView } from '../views/slotView';
import { ColonyToolBarView } from '../views/toolBarView';

const { ccclass, property } = _decorator;

@ccclass('ColonySceneBootstrap')
/** ColonyGame 场景 Context：绑定 Prefab、持有 StateMachine 与玩法 Model。 */
export class ColonySceneBootstrap extends Component implements GameplayModule {
  public readonly id = 'ant' as const;
  private moduleEntry: ModuleEntry | null = null;
  private ready = false;
  private exitSaveFailed = false;
  private closePromise: Promise<void> | null = null;
  @property(SpriteFrame)
  antCourierFrame: SpriteFrame | null = null;

  @property(SpriteFrame)
  cellFrame: SpriteFrame | null = null;

  @property(ColonyLoadingView)
  loadingView: ColonyLoadingView | null = null;

  @property(ColonyHomeView)
  homeView: ColonyHomeView | null = null;

  @property(ColonyConstructionView)
  constructionView: ColonyConstructionView | null = null;

  @property(Node)
  playRoot: Node | null = null;

  @property(ColonyHudView)
  hudView: ColonyHudView | null = null;

  @property(ColonyBoardView)
  boardView: ColonyBoardView | null = null;

  @property(ColonySlotView)
  slotView: ColonySlotView | null = null;

  @property(ColonyToolBarView)
  toolBarView: ColonyToolBarView | null = null;

  @property(Node)
  stackRoot: Node | null = null;

  @property(Node)
  transportRoot: Node | null = null;

  @property(Node)
  popupRoot: Node | null = null;

  @property(Camera)
  mainCamera: Camera | null = null;

  public readonly app = new AppModel();
  public readonly StateMachine = new StateMachine<ColonySceneBootstrap>(this);
  public play: ColonyFlowModel | null = null;
  public progress: PlayerProgress | null = null;
  public settings: UserSettings | null = null;
  public identity: InstallationIdentity | null = null;
  public profile: PlayerProfile | null = null;
  public currencyView: ColonyCurrencyOverlayView | null = null;
  public gm: GmTestSession | null = null;
  public dailyActivity: DailyActivityPresentation | null = null;
  public readonly difficultyKinds = new Map<number, 'E' | 'S' | 'H'>();
  public collectionFrames: { orb: SpriteFrame } | null = null;
  public stackChainFrame: SpriteFrame | null = null;
  public round: ProgressRound | null = null;
  public ads: RewardedAds | null = null;
  public progressPopup: ProgressControl | ToolControl | CommunityControl | null = null;
  public readonly toast = new ToastPresentation(this);

  @property
  public clearAdUnitId = '';

  @property
  public supplyAdUnitId = '';
  @property
  public speedAdUnitId = '';

  @property public feedbackUrl = '';
  @property public userAgreementUrl = '';
  @property public privacyPolicyUrl = '';

  public applyAudioSettings(): void {
    const settings = this.settings?.snapshot();
    mk.audio.getGroup(GlobalConfig.Audio.Type.Effect).volumeNum = settings?.soundEnabled === false ? 0 : 1;
    mk.audio.getGroup(GlobalConfig.Audio.Type.Music).volumeNum = settings?.musicEnabled === false ? 0 : 1;
  }

  public openSettingsLink(kind: 'feedback' | 'agreement' | 'privacy'): string {
    const url = { feedback: this.feedbackUrl, agreement: this.userAgreementUrl, privacy: this.privacyPolicyUrl }[kind];
    const unavailable = { feedback: '反馈渠道暂未开放', agreement: '用户协议暂未公布', privacy: '隐私政策暂未公布' }[kind];
    if (!url) return unavailable;
    try { if (new URL(url).protocol !== 'https:') return '链接暂不可用'; }
    catch { return '链接暂不可用'; }
    sys.openURL(url);
    return '';
  }

  public get hasAds(): boolean {
    return Boolean((globalThis as typeof globalThis & { wx?: WeChatAdsPort }).wx && this.supplyAdUnitId);
  }

  public leaderboardConfig: LeaderboardConfig | null = null;
  public socialConfig: SocialConfig | null = null;
  public prepareProgress(): void {
    // MK storage.set queues writes and cannot report a disk failure. This synchronous port
    // lets the product transaction retain its previous snapshot if persistence fails.
    const storage = this.requireEntry().storage;
    const legacyPlayer = Boolean(storage.getItem(PROGRESS_SAVE_KEY) || storage.getItem(PROGRESS_BACKUP_KEY));
    this.progress = new PlayerProgress({
      read: (key) => storage.getItem(key),
      write: (key, value) => storage.setItem(key, value),
    }, { now: () => Date.now() }, this.leaderboardConfig!, this.socialConfig!);
    this.settings = new UserSettings({
      read: (key) => storage.getItem(key),
      write: (key, value) => storage.setItem(key, value),
    });
    this.identity = new InstallationIdentity({
      read: key => storage.getItem(key), write: (key, value) => storage.setItem(key, value),
    }, () => globalThis.crypto.getRandomValues(new Uint8Array(16)));
    this.identity.read();
    this.profile = new PlayerProfile({ read: key => storage.getItem(key), write: (key, value) => storage.setItem(key, value) },
      this.leaderboardConfig!.avatarColors.length,
      () => `local-${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')}`,
      () => Date.now(), legacyPlayer);
    this.dailyActivity = new DailyActivityPresentation(this);
    this.applyAudioSettings();
    const platform = (globalThis as typeof globalThis & { wx?: WeChatAdsPort }).wx ?? null;
    this.ads = new RewardedAds(platform, { clear: this.clearAdUnitId, supply: this.supplyAdUnitId, speed: this.speedAdUnitId || this.supplyAdUnitId }, () => this.round?.id ?? '');
    game.on(Game.EVENT_HIDE, this.cancelAd, this);
    game.on(Game.EVENT_SHOW, this.advanceSocial, this);
    this.schedule(this.advanceSocial, 30);
  }

  public refreshProfile(): void {
    const profile = this.profile?.snapshot();
    if (!profile) return;
    this.hudView?.setProfile(profile.nickname, COLONY_BUILD_VERSION);
    this.homeView?.setProfile(profile.nickname, COLONY_BUILD_VERSION);
    this.currencyView?.setProfile(profile.nickname, COLONY_BUILD_VERSION);
  }

  private cancelAd(): void { if (!this.ads?.isShowingSpeed()) this.ads?.cancel(); }
  private advanceSocial(): void {
    if (this.destroyed || !this.progress) return;
    try {
      if (this.progress.advanceSocial()) {
        this.homeView?.refresh(this.progress);
        this.constructionView?.refreshSocialNotice(this.progress.readSocial().unread);
        if (this.progressPopup instanceof ProgressControl || this.progressPopup instanceof CommunityControl) this.progressPopup.refresh();
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      this.app.setError({ code: 'INVALID_OPERATION', message });
      this.homeView?.setFeedback(`伙伴动态保存未完成：${message}`);
    }
  }
  public readonly audioUnits = new Map<ColonySoundName, mk.Audio_.Unit>();
  public catalog: DevelopmentLevelCatalog | null = null;
  public generation = 0;
  public inputLocked = false;
  public navigating = false;
  public destroyed = false;
  public bootPromise: Promise<void> | null = null;

  /** 配置分辨率与相机，安装测试桥，进入 LoadingState。 */
  protected async onLoad(): Promise<void> {
    try {
    this.moduleEntry = ModuleEntryGate.require('ant');
    this.moduleEntry.attach(this);
    view.setDesignResolutionSize(750, 1334, ResolutionPolicy.FIXED_WIDTH);
    this.configureUiCamera();
    new ColonyTestBridge(this).install();
    await this.StateMachine.changeState(LoadingState);
    const boot = this.bootPromise;
    if (boot) await boot;
    if (this.play != null) console.info('[Colony] MKFramework scene ready');
    } catch (cause) { this.reportModuleFailure(cause); console.error(cause); }
  }

  /** 标记销毁、关闭结算弹窗并清理测试桥。 */
  protected onDestroy(): void {
    void this.close('recovery').catch(cause => console.error('[Ant] cleanup failed', cause));
  }

  private requireEntry(): ModuleEntry {
    if (!this.moduleEntry || !this.moduleEntry.isCurrent()) throw new Error('Ant entry expired');
    return this.moduleEntry;
  }

  public reportModuleReady(): void {
    const entry = this.requireEntry();
    director.once(Director.EVENT_AFTER_DRAW, () => {
      if (!entry.isCurrent() || this.destroyed) return;
      this.ready = true;
      entry.ready({ mode: 'ant', transactionId: entry.transactionId, businessReady: true, firstFrameReady: true });
    });
  }
  public reportModuleFailure(cause: unknown): void { this.moduleEntry?.fail(cause); }

  public canLeave(): LeaveStatus {
    if (this.ads?.hasPendingReward()) return 'rewardPending';
    if (this.ads?.isShowing()) return 'adShowing';
    if (this.exitSaveFailed) return 'saveFailed';
    if (!this.ready || this.navigating || (PlayState.current(this) && this.play?.snapshot().result === 'PLAYING')) return 'playing';
    return 'ready';
  }

  public async prepareExit(): Promise<LeaveStatus> {
    const status = this.canLeave();
    if (status !== 'ready') return status;
    this.inputLocked = true;
    return 'ready';
  }

  public async flush(): Promise<SaveOutcome> {
    try {
      if (this.ads?.hasPendingReward() || this.ads?.isShowing()) throw new Error('Video reward is pending');
      PlayState.settleCurrent(this);
      PlayState.current(this)?.prepareNavigation();
      this.dailyActivity?.flushForExit();
      this.progress?.flushCurrent();
      this.exitSaveFailed = false;
      return { ok: true };
    } catch (cause) {
      this.exitSaveFailed = true;
      return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  public resumeInput(): void { if (!this.destroyed && !this.exitSaveFailed) this.inputLocked = !!this.progressPopup || this.navigating; }

  public close(_reason: 'switch' | 'recovery'): Promise<void> {
    if (!this.closePromise) this.closePromise = Promise.resolve().then(() => this.closeModule()).catch(cause => { this.closePromise = null; throw cause; });
    return this.closePromise;
  }

  private cleanupSteps: Map<string, () => void | Promise<void>> | null = null;

  private async closeModule(): Promise<void> {
    this.destroyed = true;
    this.toast.clear();
    this.generation += 1;
    this.inputLocked = true;
    if (!this.cleanupSteps) this.cleanupSteps = new Map<string, () => void | Promise<void>>([
      ['daily', () => this.dailyActivity?.dispose(false)],
      ['events', () => { game.off(Game.EVENT_HIDE, this.cancelAd, this); game.off(Game.EVENT_SHOW, this.advanceSocial, this); this.unschedule(this.advanceSocial); }],
      ['ads', () => this.ads?.dispose()], ['progressPopup', () => this.progressPopup?.forceClose()],
      ['states', () => this.StateMachine.releaseAllStates()],
      ['currency', () => { this.currencyView?.node.destroy(); this.currencyView = null; }],
      ['success', () => mk.uiManage.unregis(ColonyResultSuccessView, this.popupRoot)], ['fail', () => mk.uiManage.unregis(ColonyResultFailView, this.popupRoot)],
      ['progress', () => mk.uiManage.unregis(ColonyProgressView, this.popupRoot)], ['community', () => mk.uiManage.unregis(ColonyCommunityView, this.popupRoot)], ['settings', () => mk.uiManage.unregis(ColonySettingsView, this.popupRoot)], ['confirm', () => mk.uiManage.unregis(ColonyConfirmView, this.popupRoot)], ['shop', () => mk.uiManage.unregis(ColonyShopView, this.popupRoot)], ['tools', () => mk.uiManage.unregis(ColonyToolView, this.popupRoot)],
      ['testBridge', () => ColonyTestBridge.clear()],
      ['toast', async () => { await this.toast.flush(); await mk.uiManage.unregis(ColonyToastView, this.popupRoot); }],
    ]);
    const errors: unknown[] = [];
    for (const phase of [['daily', 'events', 'ads'], ['progressPopup', 'states'], ['success', 'fail', 'progress', 'community', 'settings', 'confirm', 'shop', 'tools', 'toast', 'testBridge', 'currency']]) {
      await Promise.all(phase.map(async key => {
        const operation = this.cleanupSteps!.get(key);
        if (!operation) return;
        try { await operation(); this.cleanupSteps!.delete(key); } catch (cause) { errors.push(cause); }
      }));
      // Controls must close before their registrations/pools are removed.
      if (errors.length) break;
    }
    if (errors.length) throw new AggregateError(errors, 'Ant cleanup did not complete');
  }

  /** 将主相机对齐 Canvas，设为 UI_2D 正交相机。 */
  private configureUiCamera(): void {
    const canvasNode = this.node.parent;
    const camera = this.mainCamera;
    const canvas = canvasNode?.getComponent(Canvas);
    const transform = canvasNode?.getComponent(UITransform);
    if (!canvasNode || !canvas || !transform || !camera) {
      throw new Error('ColonyGame requires Canvas, UITransform, and mainCamera bindings');
    }
    const center = canvasNode.worldPosition;
    ColonyUtil.applyUiLayer(canvasNode);
    camera.node.setWorldPosition(center.x, center.y, 1000);
    camera.node.setRotationFromEuler(0, 0, 0);
    camera.projection = Camera.ProjectionType.ORTHO;
    camera.orthoHeight = transform.height / 2;
    camera.visibility = Layers.Enum.UI_2D;
    canvas.cameraComponent = camera;
  }
}
