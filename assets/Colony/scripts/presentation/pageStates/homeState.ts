import type { IState } from 'db://shidai3/index';
import type { ColonySceneBootstrap } from '../../bootstrap/colonySceneBootstrap';
import { PlayState } from './playState';
import { ProgressPresentation } from '../progressPresentation';

/** 首页：展示开始按钮，进入第 1 关 Play。 */
export class HomeState implements IState<ColonySceneBootstrap> {
  public context!: ColonySceneBootstrap;

  /** A failed dynamic mount must leave a visible, retryable page. */
  public static async recover(session: ColonySceneBootstrap, message: string, entered = false): Promise<void> {
    if (session.destroyed || (!entered && (session.playRoot || session.constructionView))) return;
    await session.StateMachine.changeState(HomeState);
    session.homeView?.setFeedback(message);
  }

  /** 显示首页并绑定开始关卡。 */
  public enter(): void {
    const session = this.context;
    session.hudView?.hideLevelRail();
    if (session.playRoot) session.playRoot.active = false;
    session.homeView!.setVisible(true);
    session.inputLocked = false;
    if (session.progress) {
      session.homeView!.tutorial = session.progress.takeTutorial() ?? session.homeView!.tutorial;
      session.homeView!.refresh(session.progress);
    }
    session.homeView!.bind(() => {
      void PlayState.enterLevel(session, session.progress?.nextLevel() ?? 1);
    }, (section) => {
      void ProgressPresentation.open(session, section).then(() => {
        if (session.homeView?.node.activeInHierarchy && session.app.error) session.homeView.setFeedback(session.app.error.message);
      });
    });
  }

  /** 隐藏首页。 */
  public exit(): void {
    this.context.toast.clear();
    this.context.homeView!.setVisible(false);
  }
}
