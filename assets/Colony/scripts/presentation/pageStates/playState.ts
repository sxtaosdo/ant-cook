import type { IState } from 'db://shidai3/index';
import mk from 'mk';
import type { ColonyTool, ColonyReadModel } from '../../application/contracts';
import type { ColonySceneBootstrap } from '../../bootstrap/colonySceneBootstrap';
import { ColonyUtil } from '../../colonyUtil';
import { ColonyFlowModel, EMPTY_GAME_SNAPSHOT, type ObservableEvent } from '../../gameModel';
import { createChallengeCatalog, themeForLevel } from '../../application/operationalLevels';
import type { Settlement, SupplyTool } from '../../application/playerProgress';
import { ProgressPresentation } from '../progressPresentation';
import { ConstructionState } from './constructionState';
import { readCollectionFeedback } from '../constructionPresentation';
import { ResultFailControl } from '../../../popups/resultFail/script/resultFailControl';
import { ColonyResultFailView } from '../../../popups/resultFail/script/resultFailView';
import { swallowMkInterrupt } from '../../../popups/resultPopupNav';
import { ResultSuccessControl } from '../../../popups/resultSuccess/script/resultSuccessControl';
import { ColonyResultSuccessView } from '../../../popups/resultSuccess/script/resultSuccessView';
import { BoardPresentation } from '../boardPresentation';
import type { ColonySoundName } from '../colonyViews';
import { CollectionFlightPresentation } from '../collectionFlightPresentation';
import { TransportPresentation } from '../transportPresentation';
import { SpeedBoostPresentation } from '../speedBoostPresentation';
import { prepareThemePresentation, refreshThemeCollection } from '../themePresentation';
import { HomeState } from './homeState';
import { layoutPlay, mountPage, unmountPlay } from '../pageNodes';
import { HardLevelNotice } from '../hardLevelNotice';

export type ColonyTransportEvidence = Readonly<import('../transportPresentation').TransportEvidence>;
const EMPTY_TRANSPORT_EVIDENCE: ColonyTransportEvidence = { movementScale: 1, boostMultiplier: 1, movingWorkers: 0,
  outboundCrawls: 0, returnsToHole: 0, activeWorkers: 0, maxConcurrentColors: 0, spawnedByColor: {} };
type ResultControl = ResultSuccessControl | ResultFailControl;

/** 对局页：投影 ReadModel、处理输入、驱动棋盘/搬运表现与结算导航。 */
export class PlayState implements IState<ColonySceneBootstrap> {
  public context!: ColonySceneBootstrap;
  private board: BoardPresentation | null = null;
  private transport: TransportPresentation | null = null;
  private collectionFlight: CollectionFlightPresentation | null = null;
  private speedBoost: SpeedBoostPresentation | null = null;
  private transportLoop: Promise<void> | null = null;
  private readonly transportTasks = new Set<Promise<void>>();
  private resultControl: ResultControl | null = null;
  private pendingSelections = 0;
  private readonly waitingStacks = new Set<string>();
  private readonly hardNotice = new HardLevelNotice();
  public static readonly transportDispatchIntervalMs = 60;
  /** 导航之前先重试当前终局的持久结算，写入失败不得丢弃棋盘。 */
  public static settleCurrent(context: ColonySceneBootstrap): Settlement | null {
    if (context.ads?.hasPendingReward()) throw new Error('视频奖励待保存，请先重试领取');
    const snapshot = context.play?.snapshot();
    if (!snapshot || snapshot.result === 'PLAYING' || !context.progress || !context.round) return null;
    return context.progress.settleRound(context.round.id, snapshot.result, snapshot.transported, [...context.play!.usedToolList()]);
  }
  /** 从 Context 组装只读投影。 */
  public static read(context: ColonySceneBootstrap): ColonyReadModel {
    const snapshot = context.play?.snapshot() ?? EMPTY_GAME_SNAPSHOT;
    return {
      currentLevel: snapshot.level,
      maxLevel: context.catalog?.levels.length ?? 0,
      usedTools: context.play?.usedToolList() ?? [],
      result: snapshot.result,
      snapshot,
      lastEvents: context.play?.lastEventList() ?? [],
      lastDispatchRound: context.play?.lastDispatchRoundList() ?? [],
      suggestedStackId: context.play?.suggestedStack() ?? null,
      error: context.app.error === null ? null : { ...context.app.error },
    };
  }
  /** 重置指定关卡并进入 PlayState。 */
  public static async enterLevel(context: ColonySceneBootstrap, level: number): Promise<void> {
    if (context.destroyed || !context.play || context.navigating) return;
    context.navigating = true; let entered = false;
    try {
      if (!context.catalog || !context.progress) return;
      PlayState.settleCurrent(context);
      PlayState.current(context)?.prepareNavigation();
      context.ads?.cancel();
      context.round = context.progress.startRound(level, 'main');
      context.play = new ColonyFlowModel(context.catalog);
      context.play.reset(level);
      context.app.clearError();
      context.generation += 1;
      entered = true; await context.StateMachine.changeState(PlayState);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      context.app.setError({ code: 'INVALID_OPERATION', message });
      context.hudView?.setFeedback('保存未完成，请释放存储空间后重试');
      await HomeState.recover(context, message, entered);
    } finally { context.navigating = false; }
  }
  public static async enterDaily(context: ColonySceneBootstrap): Promise<void> {
    if (!context.progress || context.destroyed || context.navigating) return;
    context.navigating = true; let entered = false;
    try {
    PlayState.settleCurrent(context);
    PlayState.current(context)?.prepareNavigation();
    context.ads?.cancel();
    context.round = context.progress.startRound(context.progress.dailyChallengeIndex() + 1, 'daily');
    context.play = new ColonyFlowModel(createChallengeCatalog(context.round.day));
    context.generation += 1;
    context.app.clearError();
    entered = true; await context.StateMachine.changeState(PlayState);
    } catch (cause) { await HomeState.recover(context, String(cause), entered); throw cause;
    } finally { context.navigating = false; }
  }
  /** 重置后返回 HomeState。 */
  public static async goHome(context: ColonySceneBootstrap): Promise<void> {
    if (context.destroyed || !context.play || context.navigating) return;
    context.navigating = true;
    try {
      PlayState.settleCurrent(context);
      PlayState.current(context)?.prepareNavigation();
      context.ads?.cancel();
      if (context.catalog) context.play = new ColonyFlowModel(context.catalog);
      context.play.reset(context.progress?.nextLevel() ?? 1);
      context.round = null;
      context.app.clearError();
      context.generation += 1;
      await context.StateMachine.changeState(HomeState);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      context.app.setError({ code: 'INVALID_OPERATION', message });
      context.hudView?.setFeedback('保存未完成，请释放存储空间后重试');
    } finally { context.navigating = false; }
  }
  /** 若当前状态机页为 Play 则返回实例。 */
  public static current(context: ColonySceneBootstrap): PlayState | null {
    return context.StateMachine.current instanceof PlayState ? context.StateMachine.current : null;
  }

  public get transportEvidence(): ColonyTransportEvidence {
    return this.transport?.evidence ?? EMPTY_TRANSPORT_EVIDENCE;
  }
  public get pooledCount(): number {
    return (this.board?.pooledCount ?? 0) + (this.transport?.pooledCount ?? 0);
  }
  public get speedEvidence(): { multiplier: number; source: string; remainingMs: number } | null { return this.speedBoost?.evidence ?? null; }
  private checkFreeFinish(): void {
    if (!this.context.destroyed && PlayState.current(this.context) === this && this.pendingSelections === 0 && this.context.play?.selectableQueueExhausted) this.speedBoost?.startFreeFinish();
  }
  public prepareNavigation(): void { this.speedBoost?.stopForNavigation(); }
  public refreshBoostBalance(): void { this.speedBoost?.refreshBalance(); }
  public async showResultPreview(success: boolean): Promise<void> {
    if (!this.context.gm?.active) throw new Error('GM test profile required'); await this.showResult(success, true);
  }

  public async enter(): Promise<void> {
    const session = this.context;
    if (!await mountPage(session, 'playRoot', () => session.StateMachine.current === this)) return;
    const read = PlayState.read(session);
    const boardView = session.boardView!;
    const slotView = session.slotView!;
    const hudView = session.hudView!;
    const toolBarView = session.toolBarView!;
    if (!session.cellFrame) throw new Error('Missing serialized board cell SpriteFrame');
    this.board = new BoardPresentation(
      boardView.content,
      slotView.content,
      slotView.slots,
      slotView.stackSpriteFrame,
      session.cellFrame,
      session.stackRoot!,
      (stackId) => { void this.tapStack(stackId); },
    );
    this.transport = new TransportPresentation(
      session.transportRoot!,
      boardView.content,
      session.antCourierFrame,
      session.cellFrame,
    );
    this.collectionFlight = new CollectionFlightPresentation(hudView, session.collectionFrames!, read.snapshot.board.length, index => session.slotView!.slots[index]!);
    this.transport.configureMovement(session.round?.mode ?? 'main', read.currentLevel);
    session.homeView!.setVisible(false);
    session.inputLocked = true;
    session.playRoot!.active = true;
    layoutPlay(session);
    hudView.setLevel(read.currentLevel);
    const themeTarget = session.round?.mode === 'main' ? themeForLevel(read.currentLevel) : null;
    slotView.setFirstLevelSkin(null);
    toolBarView.setFirstLevelSkin(false);
    toolBarView.setUsed(read.usedTools);
    this.speedBoost = new SpeedBoostPresentation(session, this.transport);
    toolBarView.bind((tool) => {
      if (session.inputLocked) return;
      void ProgressPresentation.open(session, `tool-${tool}`);
    });
    const board = this.board;
    const transport = this.transport;
    await prepareThemePresentation(session, board, transport, read, themeTarget, () => this.board === board && this.transport === transport);
    if (this.board !== board || session.destroyed) return;
    const hard = session.round?.mode === 'main' && session.difficultyKinds.get(read.currentLevel) === 'H';
    hudView.setDifficulty(hard);
    if (hard) {
      session.inputLocked = true;
      await this.hardNotice.show(session.node, session.popupRoot!, () => this.board === board && !session.destroyed);
      if (this.board === board && !session.destroyed) session.inputLocked = false;
    }
  }

  /** 退出对局：回收表现、关闭结算弹窗。 */
  public async exit(): Promise<void> {
    const session = this.context;
    session.generation++; this.hardNotice.dispose(); this.waitingStacks.clear();
    this.transportLoop = null;
    this.collectionFlight?.dispose(); this.collectionFlight = null;
    this.speedBoost?.dispose(); this.speedBoost = null;
    this.transportTasks.clear();
    this.board?.dispose();
    this.transport?.dispose();
    this.board = null;
    this.transport = null;
    await this.closeResultPopups();
    unmountPlay(session);
  }

  /** 点击数字组：入槽动画后启动搬运循环。 */
  public async tapStack(stackId: string): Promise<void> {
    const session = this.context;
    const board = this.board;
    const play = session.play;
    if (!board || !play || session.destroyed || session.inputLocked) return;
    try {
      play.selectStack(stackId);
    } catch {
      session.hudView?.setFeedback('先选择本列前方方块');
      return;
    }
    const generation = session.generation;
    const read = PlayState.read(session);
    const events = read.lastEvents;
    const slot = events.find((event) => event.phase === 'SLOT');
    board.markMoving(stackId, true);
    this.waitingStacks.add(stackId);
    this.pendingSelections += 1;
    try {
    void this.playSound('click');
    board.applySelection(events, read);
    if (slot?.slotIndex !== undefined) {
      await board.moveStackToSlot(stackId, slot.slotIndex);
      await board.pulseSlot(slot.slotIndex);
    }
    if (generation !== session.generation || session.destroyed) return;
    board.markMoving(stackId, false);
    this.waitingStacks.delete(stackId);
    if (events.some((event) => event.phase === 'FAIL')) await this.showResult(false);
    else if (events.some((event) => event.phase === 'SUCCESS')) await this.showResult(true);
    else void this.runTransportLoop();
    } finally {
      this.pendingSelections -= 1;
      if (generation === session.generation) this.checkFreeFinish();
    }
  }

  /** 使用一次性道具（扩槽 / 铲子 / 指南针）。 */
  public async usePowerUp(tool: ColonyTool): Promise<void> {
    const session = this.context;
    const board = this.board;
    const play = session.play;
    let read = PlayState.read(session);
    if (!board || !play || session.destroyed || session.inputLocked || read.usedTools.includes(tool)) {
      return;
    }
    try {
      if (tool === 'slot') play.useExtraSlot();
      else if (tool === 'trowel') play.useTrowel();
      else play.useCompass();
    } catch {
      return;
    }
    const generation = session.generation;
    read = PlayState.read(session); if (session.round) session.dailyActivity?.tool(session.round.id, tool);
    session.toolBarView!.setUsed(read.usedTools);
    void this.playSound('click');
    if (tool === 'slot') {
      board.addExtraSlot(read);
      return;
    }
    if (tool === 'compass') {
      if (read.suggestedStackId) await this.tapStack(read.suggestedStackId);
      return;
    }
    const toolEvents = read.lastEvents;
    this.collectionFlight?.accept(toolEvents);
    const interaction = toolEvents.find((event) => event.phase === 'INTERACT');
    if (interaction?.cellId) await board.clearCell(interaction.cellId);
    if (generation !== session.generation || session.destroyed) return;
    const afterClear = PlayState.read(session);
    board.applyCounts(toolEvents, afterClear); this.checkFreeFinish();
    if (afterClear.result !== 'PLAYING') await this.showResult(afterClear.result === 'SUCCESS');
  }

  public async presentExtraSupply(tool: SupplyTool): Promise<void> {
    const session = this.context;
    if (!session.play || !this.board) return;
    const generation = session.generation;
    const read = PlayState.read(session); if (session.round) session.dailyActivity?.tool(session.round.id, tool);
    if (tool === 'compass' && read.suggestedStackId) await this.tapStack(read.suggestedStackId);
    else {
      this.collectionFlight?.accept(read.lastEvents);
      const event = read.lastEvents.find(item => item.phase === 'INTERACT');
      if (event?.cellId) await this.board.clearCell(event.cellId);
      if (generation !== session.generation || session.destroyed || PlayState.current(session) !== this) return;
      this.board.applyCounts(read.lastEvents, read);
      this.checkFreeFinish();
      if (read.result !== 'PLAYING') await this.showResult(read.result === 'SUCCESS');
    }
  }

  public async showResult(success: boolean, preview = false): Promise<void> {
    const session = this.context;
    const generation = session.generation;
    const read = PlayState.read(session);
    let reward: Settlement | null = null;
    let collection: ReturnType<typeof readCollectionFeedback>;
    // Result previews never settle a live puzzle. Only the model's terminal state can award.
    if (!preview && session.progress && session.round && read.result === (success ? 'SUCCESS' : 'FAIL')) {
      try {
        reward = PlayState.settleCurrent(session);
        if (reward?.firstClear) collection = readCollectionFeedback(session.progress.snapshot(), read.currentLevel, true, session.round.mode === 'daily');
      } catch (cause) {
        session.hudView!.setFeedback('保存失败，请腾出空间后从设置重新开始');
        session.app.setError({ code: 'RUNTIME', message: String(cause) });
        return;
      }
    }
    session.inputLocked = true;
    const collectedTarget = reward?.firstClear && session.round?.mode === 'main' ? themeForLevel(read.currentLevel) : null;
    refreshThemeCollection(session, read, collectedTarget);
    if (success && !preview) await this.collectionFlight?.drain();
    if (generation !== session.generation || session.destroyed) return;
    session.hudView!.setFeedback(success ? '补给完成' : '暂存槽已满');
    void this.playSound(success ? 'success' : 'fail');
    if (generation !== session.generation || session.destroyed) return;
    if (session.progressPopup) await session.progressPopup.forceClose();
    await this.closeResultPopups();
    if (generation !== session.generation || session.destroyed) return;
    const seed = {
      level: read.currentLevel,
      transported: read.snapshot.transported,
      hasNextLevel: session.round?.mode !== 'daily' && read.currentLevel < read.maxLevel,
      rewardText: preview ? 'GM预览 · 不结算' : reward?.firstClear ? `${collectedTarget && !collection ? `${collectedTarget.item.name}${read.currentLevel === 1 ? '已收集，开摊后摆上' : '已放入摊位'} · ` : ''}金币 +${reward.coins}` : '免费重玩 · 首次奖励不重复发放',
      daily: session.round?.mode === 'daily',
      adAvailable: Boolean(session.round && session.clearAdUnitId && session.progress?.isAdEligible(session.round.id, 'clear')),
      firstBuild: Boolean(collectedTarget?.item.kind === 'stall'),
      collection,
    };
    const parent = session.popupRoot!;
    let control: ResultControl | null = null;
    const release = (): void => { if (control !== null && this.resultControl === control) this.resultControl = null; };
    const nav = {
      onContinue: async () => {
        release();
        if (success && !seed.daily && (seed.firstBuild || !seed.hasNextLevel)) {
          await PlayState.goHome(session);
          await ConstructionState.open(session, themeForLevel(seed.level)!.themeIndex, seed.collection?.itemId);
          return;
        }
        if (session.round?.mode === 'daily') {
          await PlayState.enterDaily(session);
          return;
        }
        if (success) {
          await PlayState.enterLevel(session, Math.min(seed.level + 1, read.maxLevel));
          return;
        }
        await PlayState.enterLevel(session, seed.level);
      },
      onHome: async () => {
        release();
        await PlayState.goHome(session);
        if (success && !seed.daily && !seed.firstBuild) await ConstructionState.open(session, themeForLevel(seed.level)!.themeIndex, seed.collection?.itemId);
      },
      onAd: async (): Promise<string> => {
        const round = session.round;
        if (!round || !session.ads || !session.progress) return '视频暂不可用';
        if (!session.ads.hasPendingReward() && !session.progress.isAdEligible(round.id, 'clear')) return '本次奖励已领取或今日次数已用完';
        const status = await session.ads.request('clear', () => {
          session.progress!.grantAdReward(`${round.id}:clear`, round.id, 'clear');
        });
        return status === 'completed' ? '额外获得40金币，已保存' : status === 'pending' ? '奖励待保存，请重试领取，无需再看视频' : status === 'failed' ? '视频加载或奖励保存失败，请稍后重试' : '视频未完成，奖励与资源不变';
      },
      canAd: (): boolean => Boolean(session.ads?.hasPendingReward() || (session.round && session.progress?.isAdEligible(session.round.id, 'clear'))),
      canNavigate: (): boolean => !session.destroyed && generation === session.generation && !session.ads?.hasPendingReward() && !session.ads?.isShowing(),
    };
    control = success
      ? new ResultSuccessControl(seed, parent, nav)
      : new ResultFailControl(seed, parent, nav);
    if (generation !== session.generation || session.destroyed) {
      await swallowMkInterrupt(Promise.resolve(control.close()));
      return;
    }
    this.resultControl = control;
  }

  /** 等待当前搬运循环结束（测试用）。 */
  public async waitForTransportIdle(): Promise<void> {
    while (this.transportLoop || this.pendingSelections > 0) {
      if (this.transportLoop) await this.transportLoop;
      else await ColonyUtil.delay(0.02);
    }
  }

  /** 关闭并清理胜负结算弹窗。 */
  private async closeResultPopups(): Promise<void> {
    const control = this.resultControl;
    if (control) {
      await swallowMkInterrupt(Promise.resolve(control.close()));
      if (this.resultControl === control) this.resultControl = null;
    }
    await Promise.all([
      mk.uiManage.close(ColonyResultSuccessView),
      mk.uiManage.close(ColonyResultFailView),
    ]);
  }

  /** 按间隔派发就绪槽位，并驱动蚂蚁搬运直至空闲或胜负。 */
  private async runTransportLoop(): Promise<void> {
    if (this.transportLoop) return this.transportLoop;
    const session = this.context;
    const board = this.board;
    const transport = this.transport;
    const play = session.play;
    if (!board || !transport || !play) return;
    const generation = session.generation;
    this.transportLoop = (async () => {
      while (generation === session.generation && PlayState.current(session) === this) {
        if (this.transportTasks.size >= 20) {
          await ColonyUtil.delay(PlayState.transportDispatchIntervalMs / 1000);
          continue;
        }
        play.dispatchReady(undefined, this.waitingStacks);
        const read = PlayState.read(session);
        const round = read.lastDispatchRound;
        if (round.length === 0) {
          if (this.transportTasks.size === 0) break;
          await ColonyUtil.delay(PlayState.transportDispatchIntervalMs / 1000);
          continue;
        }
        const colors = new Set(round.flatMap((events) => events
          .filter((event) => event.phase === 'SPAWN' && event.color)
          .map((event) => event.color!)));
        transport.recordSpawn(colors);
        this.collectionFlight?.accept(round.flat());
        board.applyCounts(round.flat(), read);
        for (const events of round) this.launchWorker(session, board, transport, events, generation);
        await ColonyUtil.delay(PlayState.transportDispatchIntervalMs / 1000);
      }
      if (this.transportTasks.size > 0) await Promise.all([...this.transportTasks]);
      if (generation !== session.generation) return;
      const settled = PlayState.read(session);
      if (settled.result === 'SUCCESS') await this.showResult(true);
      else if (settled.result === 'FAIL') await this.showResult(false);
      else session.hudView!.setFeedback('');
    })().finally(() => {
      if (generation === session.generation) {
        session.inputLocked = Boolean(session.progressPopup) || PlayState.read(session).result !== 'PLAYING';
        this.transportLoop = null;
      }
    });
    return this.transportLoop;
  }

  /** 根据 MOVE 事件启动一只蚂蚁的搬运动画任务。 */
  private launchWorker(
    session: ColonySceneBootstrap,
    board: BoardPresentation,
    transport: TransportPresentation,
    events: readonly ObservableEvent[],
    generation: number,
  ): void {
    const move = events.find((event) => event.phase === 'MOVE');
    if (!move?.color || !move.cellId || move.slotIndex === undefined || !move.route) return;
    const play = session.play;
    if (!play) return;
    const task = transport.animate(
      move.color,
      move.cellId,
      board.getSlotWorldPosition(move.slotIndex),
      move.route,
      () => generation === session.generation,
      (cellId) => board.clearCell(cellId),
      (cellId) => {
        play.completeTransport(cellId);
        const read = PlayState.read(session);
        this.collectionFlight?.accept(read.lastEvents);
        board.applyCounts(read.lastEvents, read);
      },
    ).finally(() => this.transportTasks.delete(task));
    this.transportTasks.add(task);
  }
  /** 播放预加载音效。 */
  private async playSound(name: ColonySoundName): Promise<void> {
    if (this.context.settings?.snapshot().soundEnabled === false) return;
    const unit = this.context.audioUnits.get(name);
    if (unit) await mk.audio.play(unit, { volumeNum: 0.72 });
  }
}
