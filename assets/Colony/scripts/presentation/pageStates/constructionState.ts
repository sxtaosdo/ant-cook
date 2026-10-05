import type { IState } from 'db://shidai3/index';
import type { ColonySceneBootstrap } from '../../bootstrap/colonySceneBootstrap';
import { readConstruction, type ConstructionModel } from '../constructionPresentation';
import { HomeState } from './homeState';
import { PlayState } from './playState';
import { ProgressPresentation } from '../progressPresentation';
import { mountPage } from '../pageNodes';

/** 独立建设页；视图只接收投影和动作回调。 */
export class ConstructionState implements IState<ColonySceneBootstrap> {
  public context!: ColonySceneBootstrap;
  private themeIndex = -1;
  private selected = -1;
  private feedback = '';
  private lastModel: ConstructionModel | null = null;
  private busy = false;
  private static readonly opening = new WeakSet<ColonySceneBootstrap>();

  public static current(session: ColonySceneBootstrap): ConstructionState | null {
    return session.StateMachine.current instanceof ConstructionState ? session.StateMachine.current : null;
  }

  public static async open(session: ColonySceneBootstrap, themeIndex = -1, itemId?: string): Promise<void> {
    if (session.destroyed || !session.progress || session.navigating || this.opening.has(session)) return;
    if (session.ads?.hasPendingReward()) {
      session.hudView?.setFeedback('奖励待保存，请先重试领取');
      return;
    }
    this.opening.add(session);
    session.navigating = true; let entered = false;
    try {
      // 日期滚动或终局结算写入失败时，先保留当前页面。
      session.progress.snapshot();
      const settleTerminal = (): void => {
        const snapshot = session.play?.snapshot();
        if (snapshot && snapshot.result !== 'PLAYING' && session.round) {
          session.progress!.settleRound(session.round.id, snapshot.result, snapshot.transported, [...session.play!.usedToolList()]);
        }
      };
      settleTerminal();
      if (session.progressPopup) await session.progressPopup.forceClose();
      // 搬运可能在关闭弹窗期间结束，取消旧页面异步任务前补记结算。
      settleTerminal();
      if (!this.current(session)) {
        session.ads?.cancel();
        session.generation += 1;
        entered = true; await session.StateMachine.changeState(ConstructionState);
      }
      const state = this.current(session);
      if (state && themeIndex >= 0) {
        state.themeIndex = themeIndex;
        state.selected = itemId ? readConstruction(session.progress.snapshot(), themeIndex).items.findIndex(item => item.id === itemId) : -1;
      }
      state?.refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      session.app.setError({ code: 'INVALID_OPERATION', message });
      session.hudView?.setFeedback(message);
      this.current(session)?.refresh(message);
      await HomeState.recover(session, message, entered);
    } finally {
      session.navigating = false;
      this.opening.delete(session);
    }
  }

  public async enter(): Promise<void> {
    const session = this.context;
    if (!await mountPage(session, 'construction', () => session.StateMachine.current === this)) return;
    session.hudView?.hideLevelRail();
    if (session.playRoot) session.playRoot.active = false;
    session.homeView?.setVisible(false);
    session.inputLocked = false;
    session.constructionView!.bind(action => { void ConstructionState.onAction(session, action); });
    session.constructionView!.setVisible(true);
    this.refresh();
  }

  public exit(): void {
    this.context.constructionView?.setVisible(false);
    this.context.constructionView?.node.destroy(); this.context.constructionView = null;
  }

  public refresh(feedback = this.feedback): void {
    const session = this.context;
    if (!session?.progress || !session.constructionView) return;
    this.feedback = feedback;
    try {
      const model = readConstruction(session.progress.snapshot(), this.themeIndex, this.selected);
      this.themeIndex = model.themeIndex;
      this.selected = model.selected;
      this.lastModel = { ...model, feedback };
      session.constructionView.render(this.lastModel);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      session.app.setError({ code: 'INVALID_OPERATION', message });
      if (this.lastModel) session.constructionView.render({ ...this.lastModel, feedback: `保存未完成：${message}，请重试` });
    }
  }

  public static async onAction(session: ColonySceneBootstrap, action: string): Promise<void> {
    const state = this.current(session);
    if (!state || state.busy || session.progressPopup || session.destroyed || !session.progress) return;
    state.busy = true;
    try {
      const progress = session.progress;
      const model = readConstruction(progress.snapshot(), state.themeIndex, state.selected);
      const [kind, value] = action.split(':');
      const index = Number(value);
      if (kind === 'select') {
        if (!model.items.some(item => item.index === index)) return;
        state.selected = index;
        state.feedback = '';
      } else if (kind === 'theme') {
        if (!Number.isInteger(index) || index < 0 || index > 4) return;
        state.themeIndex = index;
        state.selected = -1;
        state.feedback = '';
      } else if (kind === 'home') {
        session.navigating = true;
        try { await session.StateMachine.changeState(HomeState); } finally { session.navigating = false; }
      } else if (kind === 'social') {
        await ProgressPresentation.open(session, 'social', () => state.refresh());
      } else if (kind === 'level') {
        if (!model.primary.enabled || model.primary.action !== action) return;
        await PlayState.enterLevel(session, index);
        if (this.current(session)) state.feedback = session.app.error?.message ?? '';
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      state.feedback = `保存未完成：${message}，请重试`;
      session.app.setError({ code: 'INVALID_OPERATION', message });
    } finally {
      await Promise.resolve();
      state.busy = false;
      if (this.current(session) === state) state.refresh();
    }
  }
}
