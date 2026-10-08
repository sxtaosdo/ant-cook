import type { GameColor } from '../application/levelCatalog';
import { Button, Component, director, Director, game, Game, Label, Node, ResolutionPolicy, Sprite, UITransform, UIOpacity, view } from 'cc';
import { PREVIEW } from 'cc/env';
import type { ColonySceneBootstrap } from '../bootstrap/colonySceneBootstrap';
import { ColonyUtil } from '../colonyUtil';
import type { ColonyTransportEvidence } from '../presentation/pageStates/playState';
import { PlayState } from '../presentation/pageStates/playState';
import { ConstructionState } from '../presentation/pageStates/constructionState';
import { ColonyProgressView } from '../../popups/progress/script/progressView';
import { ColonyPopupView } from '../../popups/progress/script/popupView';
import { ColonyLeaderboardView } from '../../popups/leaderboard/script/leaderboardView';
import { ColonySocialPopupView } from '../../popups/social/script/socialPopupView';
import { ColonyShopView } from '../../popups/shop/script/shopView';
import { ColonyCommunityView } from '../../popups/progress/script/communityView';
import { ColonyToastView } from '../../popups/toast/script/toastView';
import { ColonySettingsView } from '../../popups/settings/script/settingsView';
import { colonyTestLevelTrace } from './colonyTestTraces';
import { ProgressPresentation, type ProgressSection } from '../presentation/progressPresentation';
import { createProgressPreviewFixture, createProgressPreviewSession } from './progressPreviewFixture';
import { swallowMkInterrupt } from '../../popups/resultPopupNav';
import { RewardedAds, type RewardedVideo } from '../application/rewardedAds';
import { FREE_BOOST_MS } from '../application/speedBoost';
import { mountPage } from '../presentation/pageNodes';
import { UserSettings } from '../application/userSettings';
import { GmTestSession } from './gmTestSession';

declare global {
  var __COLONY_FLOW_TEST__: ColonyTestBridge | undefined;
  var __GAME_TEST_BRIDGE__: ColonyTestBridge | undefined;
  var __COCOS_GAME_TEST__: ColonyTestBridge | undefined;
}

const EMPTY_TRANSPORT_EVIDENCE: ColonyTransportEvidence = {
  movementScale: 1,
  boostMultiplier: 1,
  movingWorkers: 0,
  outboundCrawls: 0,
  returnsToHole: 0,
  activeWorkers: 0,
  maxConcurrentColors: 0,
  spawnedByColor: {},
};

/** Preview/自动化测试桥：挂到 globalThis，转发 PlayState 与表现证据。 */
export class ColonyTestBridge {
  private leaderboardPreview: ReturnType<typeof createProgressPreviewSession> | null = null;
  public constructor(private readonly ctx: ColonySceneBootstrap) {}

  /** 清除全局测试桥引用。 */
  public static clear(): void {
    globalThis.__COLONY_FLOW_TEST__ = undefined;
    globalThis.__GAME_TEST_BRIDGE__ = undefined;
    globalThis.__COCOS_GAME_TEST__ = undefined;
  }

  /** 安装到多个全局别名。 */
  public install(): void {
    this.ctx.gm = new GmTestSession(this.ctx);
    globalThis.__COLONY_FLOW_TEST__ = this;
    globalThis.__GAME_TEST_BRIDGE__ = this;
    globalThis.__COCOS_GAME_TEST__ = this;
  }

  public get ready(): boolean { return this.ctx.play != null && !this.ctx.destroyed && !this.ctx.bootPromise && !this.ctx.navigating; }

  public isReady(): boolean { return this.ready; }

  /**
   * 复用已打开的预览页时回到首页并关掉弹层。
   * 试玩器发现此方法后不再整页刷新，从而不必重新启动引擎。
   */
  public async resetForPlaytest(): Promise<void> {
    this.hideLoadingPreview();
    if (this.ctx.progressPopup) {
      await swallowMkInterrupt(Promise.resolve(this.ctx.progressPopup.close()));
      this.ctx.progressPopup = null;
    }
    this.ctx.inputLocked = false;
    this.leaderboardPreview = null;
    await this.goHome();
  }

  public getState(): unknown { return this.snapshot(); }

  public start(): Promise<void> { return this.goLevel(1); }

  public startLevel(level: number): Promise<void> { return this.goLevel(level); }

  public startDaily(): Promise<void> { return PlayState.enterDaily(this.ctx); }

  public tapStack(stackId: string): Promise<void> { return this.playPage()?.tapStack(stackId) ?? Promise.resolve(); }

  public retry(): Promise<void> { return this.goLevel(PlayState.read(this.ctx).currentLevel); }

  public nextLevel(): Promise<void> {
    const read = PlayState.read(this.ctx);
    return this.goLevel(Math.min(read.currentLevel + 1, read.maxLevel));
  }

  public home(): Promise<void> { return this.goHome(); }

  public getProgress(): unknown { return this.ctx.progress?.snapshot(); }
  public getSpeedEvidence(): unknown { return { selected: this.playPage()?.speedEvidence, transport: this.playPage()?.transportEvidence }; }
  public getInstallationId(): string | null { return this.ctx.identity?.read() ?? null; }
  public profileEvidencePreview(): unknown {
    if (!PREVIEW) throw new Error('Preview only');
    const settings = this.ctx.popupRoot?.getComponentInChildren(ColonySettingsView);
    const nickname = (node?: Node): unknown => node?.getComponentsInChildren(Label).filter(label => ['ProfileNickname', 'ProfileBuildVersion'].includes(label.node.name)).map(label => ({ name: label.node.name, text: label.string, size: label.node.getComponent(UITransform)?.contentSize, position: label.node.worldPosition }));
    return { profile: this.ctx.profile?.snapshot(), hud: nickname(this.ctx.hudView?.node), home: nickname(this.ctx.homeView?.node),
      settings: settings?.node.activeInHierarchy ? { nickname: settings.nicknameEdit?.string, playerId: settings.userIdLabel?.string,
        registered: settings.registeredLabel?.string, avatar: settings.profileAvatar?.color, feedback: settings.noticeLabel?.string } : null,
      projectedSelf: this.ctx.profile && this.ctx.progress && this.ctx.leaderboardConfig ? this.ctx.profile.leaderboard(this.ctx.progress.readLeaderboard(), this.ctx.leaderboardConfig.avatarColors).find(entry => entry.isSelf) : null };
  }
  public async enterGmPreview(): Promise<void> { if (!PREVIEW) throw new Error('Preview only'); await this.ctx.gm!.enter(); }
  public async gmActionPreview(action: string, level?: number): Promise<void> { if (!PREVIEW) throw new Error('Preview only'); await this.ctx.gm!.run(action, level); }

  public claimStarterDiamonds(): unknown {
    this.ctx.progress?.claimStarterDiamonds();
    return this.ctx.progress?.snapshot();
  }

  public openProgress(section: ProgressSection = 'market'): Promise<void> { return ProgressPresentation.open(this.ctx, section); }

  public clickSocialTabPreview(): void {
    if (!PREVIEW) throw new Error('Preview only');
    const tab = this.ctx.popupRoot?.getComponentInChildren(ColonyCommunityView)?.socialTab;
    if (!tab?.activeInHierarchy || !tab.getComponent(Button)?.interactable) throw new Error('Social tab is unavailable');
    tab.emit(Button.EventType.CLICK);
  }
  /** Isolated browser fixture only; never emits Creator's persistent device option change. */
  public fitToastViewportPreview(): void {
    if (!PREVIEW) throw new Error('Preview only');
    for (const element of [game.frame, game.container]) if (element) {
      element.style.width = '750px'; element.style.height = '1334px';
      element.style.position = 'fixed'; element.style.left = '0'; element.style.top = '0';
      element.style.margin = '0'; element.style.transform = 'none';
    }
    view.setFrameSize(750, 1334);
    view.setDesignResolutionSize(750, 1334, ResolutionPolicy.FIXED_WIDTH);
    if (game.canvas) { game.canvas.style.width = '750px'; game.canvas.style.height = '1334px'; }
    const canvas = this.ctx.node.parent;
    canvas?.getComponent(UITransform)?.setContentSize(750, 1334);
    canvas?.setWorldPosition(375, 667, 0);
    if (this.ctx.mainCamera) {
      this.ctx.mainCamera.orthoHeight = 667;
      this.ctx.mainCamera.node.setWorldPosition(375, 667, 1000);
    }
  }
  public showToastPreview(text: string, object = ''): void {
    if (!PREVIEW) throw new Error('Preview only');
    this.ctx.toast.show(text, 'preview', object);
  }
  public toastEvidencePreview(): unknown {
    if (!PREVIEW) throw new Error('Preview only');
    const rect = game.canvas?.getBoundingClientRect();
    return { visibleSize: view.getVisibleSize(), canvasSize: rect ? { width: rect.width, height: rect.height } : null,
      cameraHeight: this.ctx.mainCamera?.orthoHeight, inputLocked: this.ctx.inputLocked,
      toasts: this.ctx.popupRoot?.getComponentsInChildren(ColonyToastView).filter(item => item.node.activeInHierarchy)
        .map(item => ({ text: item.caption?.string, position: item.node.worldPosition.clone(),
          size: item.node.getComponent(UITransform)?.contentSize, components: item.node.getComponents(Component).map(component => component.constructor.name) })) ?? [] };
  }

  /** Observe the real release tween during legal level-one transport in an isolated Preview. */
  public async zeroExitEvidencePreview(): Promise<unknown> {
    if (!PREVIEW || !this.ctx.gm?.active || !this.playPage() || this.ctx.play?.snapshot().level !== 1) throw new Error('Isolated level-one Preview required');
    const samples: Array<{ node: string; scale: number; occupied: number }> = [];
    let frames = 0;
    const observe = (): void => {
      ++frames;
      for (const node of this.ctx.slotView?.content.children ?? []) {
        if (node.activeInHierarchy && node.name.startsWith('slot-token-') && node.getComponentInChildren(Label)?.string === '0' && samples.length < 200) {
          samples.push({ node: node.uuid, scale: node.scale.x, occupied: this.ctx.play?.snapshot().slots.filter(Boolean).length ?? 0 });
        }
      }
    };
    director.on(Director.EVENT_AFTER_DRAW, observe, this);
    try {
      const stack = this.ctx.play?.snapshot().stacks.find(item => item.accessible && !item.selected);
      if (!stack) throw new Error('No available stack for zero-exit observation');
      await this.playPage()?.tapStack(stack.id);
      await this.playPage()?.waitForTransportIdle();
      await ColonyUtil.delay(0.4);
      return { samples, frames, result: this.ctx.play?.snapshot().result,
        remainingZeroNodes: this.ctx.slotView?.content.children.filter(node => node.activeInHierarchy && node.name.startsWith('slot-token-') && node.getComponentInChildren(Label)?.string === '0').length ?? 0 };
    } finally { director.off(Director.EVENT_AFTER_DRAW, observe, this); }
  }

  public previewSettings(): void {
    if (!PREVIEW) throw new Error('Preview only');
    const memory = new Map<string, string>();
    this.ctx.settings = new UserSettings({ read: key => memory.get(key) ?? null, write: (key, value) => { memory.set(key, value); } });
    this.ctx.applyAudioSettings();
  }

  /** 仅 Preview：在内存测试档中指定主题和选中物品。 */
  public openConstructionPreview(themeIndex = 0, itemId?: string): Promise<void> {
    if (!PREVIEW) throw new Error('Preview only');
    return ConstructionState.open(this.ctx, themeIndex, itemId);
  }

  /** 仅 Creator Preview 的界面样例；所有进度留在内存，不写入玩家存档。 */
  public async previewOperations(clearedLevels = 60, dayKey = '2026-09-25'): Promise<void> {
    if (!PREVIEW) throw new Error('Preview only');
    await this.closeProgressPreview();
    await this.ctx.gm!.enter();
    await PlayState.goHome(this.ctx);
    this.leaderboardPreview = null;
    this.ctx.progress = createProgressPreviewFixture(clearedLevels, dayKey, this.ctx.leaderboardConfig!, this.ctx.socialConfig!);
    await PlayState.goHome(this.ctx);
  }

  public async previewLeaderboard(clearedLevels = 0, dayKey = '2026-10-04'): Promise<void> {
    if (!PREVIEW) throw new Error('Preview only');
    await this.closeProgressPreview();
    await this.ctx.gm!.enter();
    await PlayState.goHome(this.ctx);
    this.leaderboardPreview = createProgressPreviewSession(clearedLevels, dayKey, this.ctx.leaderboardConfig!, this.ctx.socialConfig!);
    this.ctx.progress = this.leaderboardPreview.progress;
    await PlayState.goHome(this.ctx);
  }
  /** PREVIEW-only isolated balance and SDK completion; never grants a real player's time. */
  public async previewSpeedBoost(remainingMs = FREE_BOOST_MS, completion = 'complete'): Promise<void> {
    if (!PREVIEW || !Number.isSafeInteger(remainingMs) || remainingMs < 0 || remainingMs > FREE_BOOST_MS || !['complete', 'cancel', 'unavailable'].includes(completion)) throw new Error('Invalid speed Preview');
    await this.previewLeaderboard(0);
    for (let ms = FREE_BOOST_MS - remainingMs; ms > 0; ms -= Math.min(ms, 1000)) this.ctx.progress!.reserveSpeedBoost(Math.min(ms, 1000));
    this.ctx.ads?.dispose();
    this.ctx.ads = new RewardedAds(completion === 'unavailable' ? null : { createRewardedVideoAd: () => {
      let close: (result?: { isEnded?: boolean }) => void = () => {};
      const video: RewardedVideo = { load: async () => {}, show: async () => { setTimeout(() => close({ isEnded: completion === 'complete' }), 300); },
        onClose: callback => { close = callback; }, offClose: () => {}, onError: () => {}, offError: () => {} };
      return video;
    } }, { speed: 'preview-only' }, () => this.ctx.round?.id ?? '');
  }
  public clickSpeedPreview(): void {
    if (!PREVIEW) throw new Error('Preview only');
    this.ctx.hudView?.node.getChildByName('TopBarRoot')!.getChildByName('SpeedButton')!.emit(Button.EventType.CLICK);
  }
  public backgroundSpeedPreview(hidden: boolean): void {
    if (!PREVIEW || !this.leaderboardPreview) throw new Error('Isolated speed Preview required');
    if (hidden) { game.emit(Game.EVENT_HIDE); game.pause(); }
    else { game.resume(); game.emit(Game.EVENT_SHOW); }
  }

  public async restartLeaderboardPreview(days = 0): Promise<void> {
    if (!PREVIEW || !this.leaderboardPreview) throw new Error('Isolated leaderboard Preview required');
    await this.closeProgressPreview();
    await PlayState.goHome(this.ctx);
    this.ctx.progress = this.leaderboardPreview.restart(days);
    await PlayState.goHome(this.ctx);
  }

  public getLeaderboard(): unknown { return this.ctx.progress?.readLeaderboard(); }
  public getSocial(): unknown { return this.ctx.progress?.readSocial(); }
  public async socialActionPreview(action: string): Promise<void> {
    if (!PREVIEW || !this.leaderboardPreview || !this.ctx.progressPopup) throw new Error('Isolated partner popup required');
    await (this.ctx.progressPopup as unknown as { act(action: string): Promise<void> }).act(action);
  }
  public advanceSocialPreview(hours: number): void {
    if (!PREVIEW || !this.leaderboardPreview) throw new Error('Isolated partner Preview required');
    this.ctx.progress = this.leaderboardPreview.advanceHours(hours);
    this.ctx.homeView?.refresh(this.ctx.progress);
    this.ctx.constructionView?.refreshSocialNotice(this.ctx.progress.readSocial().unread);
    if (this.ctx.progressPopup && 'refresh' in this.ctx.progressPopup) this.ctx.progressPopup.refresh();
  }

  public async closeProgressPreview(): Promise<void> {
    if (!PREVIEW) throw new Error('Preview only');
    if (this.ctx.progressPopup) await swallowMkInterrupt(Promise.resolve(this.ctx.progressPopup.close()));
    this.ctx.progressPopup = null;
    this.ctx.inputLocked = false;
  }

  /** 沿真实点选、搬运、结算路径验收，不注入奖励或通关状态。 */
  public async solveCurrent(stopBeforeLast = false): Promise<unknown> {
    const startedAt = Date.now();
    for (const stack of this.ctx.play?.snapshot().stacks ?? []) {
      if (this.ctx.play?.snapshot().result !== 'PLAYING') break;
      if (this.ctx.play?.snapshot().stacks.find(item => item.id === stack.id)?.selected) continue;
      if (stopBeforeLast && this.ctx.play?.snapshot().stacks.filter(item => !item.selected).length === 1) break;
      await this.playPage()?.tapStack(stack.id);
      let idle = false;
      const settled = this.playPage()?.waitForTransportIdle().then(() => { idle = true; });
      await Promise.race([settled, this.waitFor(() => idle
        || !this.ctx.play?.snapshot().slots.some(slot => slot?.stackId === stack.id), 1200)]);
      if (!idle && this.ctx.play?.snapshot().slots.some(slot => slot?.stackId === stack.id)) await settled;
    }
    await this.playPage()?.waitForTransportIdle();
    return { game: this.ctx.play?.snapshot(), progress: this.ctx.progress?.snapshot(), elapsedMs: Date.now() - startedAt };
  }

  /** 按轨迹自动点选数字组并等待搬运空闲。 */
  public async runTrace(trace: 'success' | 'failure'): Promise<unknown> {
    const read = PlayState.read(this.ctx);
    const level = read.currentLevel;
    const catalog = this.ctx.catalog;
    if (!catalog) return read.snapshot;
    await this.goLevel(level);
    for (const stackId of colonyTestLevelTrace(catalog, level, trace)) {
      const playPage = this.playPage();
      await playPage?.tapStack(stackId);
      await playPage?.waitForTransportIdle();
    }
    return PlayState.read(this.ctx).snapshot;
  }

  public waitForActiveWorker(): Promise<unknown> { return this.waitFor(() => this.evidence().activeWorkers >= 1); }

  public waitForWorkerCount(minimum: number): Promise<unknown> {
    return this.waitFor(() => this.evidence().activeWorkers >= minimum);
  }

  public waitForTransportEvidence(): Promise<unknown> { return this.waitFor(() => this.evidence().returnsToHole >= 1); }

  public waitForConcurrentColors(): Promise<unknown> { return this.waitFor(() => this.evidence().maxConcurrentColors >= 2); }

  public waitForColorSpawn(color: GameColor): Promise<unknown> {
    return this.waitFor(() => Boolean(this.evidence().spawnedByColor[color]));
  }

  public usePowerUp(tool: 'trowel' | 'slot' | 'compass'): Promise<void> {
    return this.playPage()?.usePowerUp(tool) ?? Promise.resolve();
  }

  /** 直接打开胜负结算预览。 */
  public async showResultPreview(result: 'SUCCESS' | 'FAIL'): Promise<unknown> {
    if (!this.playPage()) await this.goLevel(PlayState.read(this.ctx).currentLevel || 1);
    await this.playPage()?.showResult(result === 'SUCCESS');
    return this.uiEvidence();
  }

  public async showLoadingPreview(): Promise<void> {
    if (!this.ctx.loadingView) await mountPage(this.ctx, 'loading', () => !this.ctx.destroyed);
    if (!this.ctx.loadingView) return;
    this.ctx.loadingView.setProgress(0.68);
    this.ctx.loadingView!.setVisible(true);
  }

  public hideLoadingPreview(): void {
    if (this.ready) { this.ctx.loadingView?.node.destroy(); this.ctx.loadingView = null; }
  }

  public getUiEvidence(): unknown { return this.uiEvidence(); }
  public getFeedbackEvidence(): unknown {
    if (!this.ctx.hudView || !this.ctx.stackRoot || !this.ctx.slotView) return { mounted: false };
    const c = this.ctx, rail = c.hudView!.node.children.find(n => n.getChildByName('RailViewport'));
    const sprite = (node: Node) => {
      const s = node.getComponent(Sprite), lock = node.getChildByName('UnlockHint'), number = node.getComponentInChildren(Label);
      return { name: node.name, active: node.activeInHierarchy, angle: node.angle, frame: s?.spriteFrame?.uuid,
        color: s ? { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a } : null,
        lock: Boolean(lock?.activeInHierarchy), numberAboveLock: Boolean(lock && number && number.node.getSiblingIndex() > lock.getSiblingIndex()) };
    };
    return {
      titleVisible: c.hudView!.node.getChildByName('LevelLabel')!.activeInHierarchy,
      itemVisible: c.hudView!.node.getChildByName('ThemeTargetIcon')!.activeInHierarchy,
      railPosition: rail?.position, railWidth: rail?.getChildByName('RailViewport')?.getComponent(UITransform)?.width,
      themeOpacity: rail?.getChildByName('RailViewport')?.getChildByName('RailContent')?.getChildByName('ThemeStrips')?.children.map(n => n.getComponent(UIOpacity)?.opacity),
      percent: rail?.getComponentsInChildren(Label).find(label => label.node.name === 'Percent')?.string,
      cards: c.stackRoot!.children.map(sprite), slots: c.slotView!.slots.flatMap(n => n.children.filter(child => child.name.startsWith('slot-token-')).map(sprite)),
      flights: c.hudView!.node.children.filter(n => n.name === 'flying-icon' && n.activeInHierarchy).map(n => ({ position: n.worldPosition })),
    };
  }

  /** 汇总屏幕、锁输入与玩法快照。 */
  public snapshot(): unknown {
    const { play, destroyed } = this.ctx;
    const screen = ConstructionState.current(this.ctx) ? 'CONSTRUCTION' : this.playPage() ? 'PLAY' : play && !destroyed ? 'HOME' : 'LOADING';
    return {
      screen,
      inputLocked: this.ctx.inputLocked,
      toast: PREVIEW ? this.toastEvidencePreview() : undefined,
      settings: this.ctx.settings?.snapshot(),
      speed: { remainingMs: this.ctx.progress?.readSpeedBoost().remainingMs,
        labels: this.ctx.hudView?.node.getChildByName('TopBarRoot')!.getChildByName('SpeedButton')!.getComponentsInChildren(Label).map(label => ({ name: label.node.name, text: label.string, active: label.node.activeInHierarchy })),
        position: this.ctx.hudView?.node.getChildByName('TopBarRoot')!.getChildByName('SpeedButton')!.worldPosition },
      transportEvidence: this.evidence(),
      progression: this.ctx.progress?.snapshot(),
      progressPanelFeedback: this.ctx.progressPopup?.model?.feedback ?? '',
      progressPanelPage: this.ctx.progressPopup?.model?.page,
      ...PlayState.read(this.ctx).snapshot,
    };
  }

  private playPage(): PlayState | null {
    return PlayState.current(this.ctx);
  }

  private async goHome(): Promise<void> {
    await PlayState.goHome(this.ctx);
  }

  private async goLevel(level: number): Promise<void> {
    await PlayState.enterLevel(this.ctx, level);
  }

  private evidence(): ColonyTransportEvidence {
    return this.playPage()?.transportEvidence ?? EMPTY_TRANSPORT_EVIDENCE;
  }

  /** 轮询等待条件满足后返回搬运证据。 */
  private async waitFor(ready: () => boolean, attempts = 200): Promise<unknown> {
    for (let attempt = 0; attempt < attempts && !ready(); attempt += 1) await ColonyUtil.delay(0.05);
    return this.evidence();
  }

  /** UI/对象池相关验收证据。 */
  private uiEvidence(): unknown {
    const popup = this.ctx.popupRoot?.getComponentsInChildren(ColonyPopupView).find(popup => popup.isAvailable());
    const progress = popup instanceof ColonyProgressView ? popup : null;
    const leaderboard = popup instanceof ColonyLeaderboardView ? popup : null;
    const ranking = leaderboard?.leaderboardList;
    const self = leaderboard?.leaderboardSelf?.node;
    const social = popup instanceof ColonySocialPopupView && popup.socialView?.node.activeInHierarchy ? popup.socialView : null;
    const list = ranking ?? (social?.list?.node.activeInHierarchy ? social.list : popup instanceof ColonyShopView ? popup.list : progress?.list);
    const construction = this.ctx.constructionView;
    return {
      progressList: list ? { totalCount: list.totalCount, pooledNodes: list.content?.children.length,
        activeNodes: list.content?.children.filter(node => node.active).length } : null,
      popupButtons: this.ctx.popupRoot?.getComponentsInChildren(Button).filter(button => button.node.activeInHierarchy).map(button => ({
        name: button.node.name, labels: button.node.getComponentsInChildren(Label).map(label => label.string), position: button.node.worldPosition,
      })),
      leaderboard: ranking ? { self: self!.getComponentsInChildren(Label).map(label => ({ name: label.node.name, text: label.string })),
        selfWorldY: self!.worldPosition.y,
        rows: ranking.content!.children.filter(node => node.active).map(node => node.getComponentsInChildren(Label).map(label => ({ name: label.node.name, text: label.string }))) } : null,
      inputLocked: this.ctx.inputLocked,
      social: social ? {
        labels: social.node.getComponentsInChildren(Label).filter(label => label.node.activeInHierarchy).map(label => ({ name: label.node.name, text: label.string })),
        displayedItems: social.node.getChildByName('Profile')!.getChildByName('Street')!.children.filter(node => node.activeInHierarchy && node.getComponent(Sprite)).map(node => ({ name: node.name, frame: Boolean(node.getComponent(Sprite)?.spriteFrame) })),
      } : null,
      construction: construction ? { active: construction.node.activeInHierarchy,
        displayedItems: construction.node.getChildByName('Street')?.getComponentsInChildren(Sprite).filter(sprite => sprite.node.activeInHierarchy).map(sprite => ({ name: sprite.node.name, frame: Boolean(sprite.spriteFrame) })),
        labels: construction.node.getComponentsInChildren(Label).map(label => ({ name: label.node.name, text: label.string, active: label.node.activeInHierarchy })) } : null,
      antFrameReady: Boolean(this.ctx.antCourierFrame?.texture),
      cellFrameReady: Boolean(this.ctx.cellFrame?.texture),
      boardCellFrame: this.ctx.boardView?.content.children.find(node => node.active && node.name.startsWith('cell-'))?.getComponent(Sprite)?.spriteFrame?.uuid ?? null,
      hudLabels: this.ctx.hudView?.node.getComponentsInChildren(Label).filter(label => ['LevelLabel', 'HeaderSubtitle', 'BoardTitle', 'BoardCount'].includes(label.node.name)).map(label => ({ name: label.node.name, text: label.string, active: label.node.activeInHierarchy })),
      boardContentLocalY: this.ctx.boardView?.content.position.y,
      layout: {
        visibleHeight: view.getVisibleSize().height,
        boardY: this.ctx.boardView?.node.position.y,
        slotY: this.ctx.slotView?.node.position.y,
        stackY: this.ctx.stackRoot?.position.y,
        toolY: this.ctx.toolBarView?.node.position.y,
        hudY: this.ctx.hudView?.node.position.y,
        holeY: this.ctx.boardView?.node.getChildByName('AntHole')?.worldPosition.y,
      },
      visibleSlots: this.ctx.slotView?.slots.filter((node) => node.active && node.getComponent(Sprite)?.enabled).length,
      slotTrayVisible: Boolean(this.ctx.slotView?.node.getComponent(Sprite)?.enabled),
      stackSizes: this.ctx.stackRoot?.children.map((node) => {
        const size = node.getComponent(UITransform)!.contentSize;
        return { name: node.name, width: size.width, height: size.height };
      }),
      stackLayout: this.ctx.stackRoot?.children.map((node) => ({
        name: node.name, x: node.position.x, y: node.position.y, active: node.active,
      })),
      zones: { board: this.ctx.boardView?.node.name, slots: this.ctx.slotView?.node.name },
      pooledNodes: this.playPage()?.pooledCount ?? 0,
      resultPrefabs: [
        'db://assets/Colony/popups/resultSuccess/prefab/resultSuccess.prefab',
        'db://assets/Colony/popups/resultFail/prefab/resultFail.prefab',
      ],
      dispatchIntervalMs: PlayState.transportDispatchIntervalMs,
      forcedCenterWaypoint: false,
    };
  }
}
