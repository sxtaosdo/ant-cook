import type { IState } from 'db://shidai3/index';
import mk from 'mk';
import { ColonyToastView } from '../../../popups/toast/script/toastView';
import { JsonAsset, SpriteFrame } from 'cc';
import { readLevelDifficulty } from '../../application/levelDifficulty';
import GlobalConfig from 'GlobalConfig';
import { readLeaderboardConfig } from '../../application/leaderboard/leaderboard';
import { readSocialConfig } from '../../application/social/social';
import { ColonyResultFailView } from '../../../popups/resultFail/script/resultFailView';
import { ColonyResultSuccessView } from '../../../popups/resultSuccess/script/resultSuccessView';
import { createOperationalCatalog } from '../../application/operationalLevels';
import { ColonyProgressView } from '../../../popups/progress/script/progressView';
import { ColonyCommunityView } from '../../../popups/progress/script/communityView';
import { ColonySettingsView } from '../../../popups/settings/script/settingsView';
import { ColonyConfirmView } from '../../../popups/confirm/script/confirmView';
import { ColonyShopView } from '../../../popups/shop/script/shopView';
import { ColonyToolView } from '../../../popups/tool/script/toolView';
import type { ColonySceneBootstrap } from '../../bootstrap/colonySceneBootstrap';
import { ColonyFlowModel } from '../../gameModel';
import type { ColonySoundName } from '../colonyViews';
import { HomeState } from './homeState';
import { mountPage } from '../pageNodes';
import { mountCurrencyOverlay } from '../currencyOverlay';

/** 启动页：加载音频、关卡目录与结算弹窗注册，完成后进入 Home。 */
export class LoadingState implements IState<ColonySceneBootstrap> {
  public context!: ColonySceneBootstrap;

  /** 显示 Loading，并启动异步 boot。 */
  public enter(): void {
    const session = this.context;
    session.homeView?.setVisible(false);
    session.constructionView?.setVisible(false);
    session.bootPromise = this.boot();
  }

  /** 准备启动资源；成功则切 Home，失败写入 AppModel 错误。 */
  public async boot(): Promise<void> {
    const session = this.context;
    try {
      if (!await mountPage(session, 'loading', () => session.StateMachine.current === this)) return;
      session.loadingView!.setProgress(0.15);
      const config = await mk.asset.get('db://assets/Colony/config/leaderboard.json', JsonAsset, session.node);
      if (session.destroyed) return;
      if (!config) throw new Error('排行榜配置未加载');
      session.leaderboardConfig = readLeaderboardConfig(config.json);
      const social = await mk.asset.get('db://assets/Colony/config/social.json', JsonAsset, session.node);
      if (session.destroyed) return;
      if (!social) throw new Error('虚拟伙伴配置未加载');
      session.socialConfig = readSocialConfig(social.json);
      const difficulty = await mk.asset.get('db://assets/Colony/config/level-difficulty.json', JsonAsset, session.node);
      if (session.destroyed) return;
      if (!difficulty) throw new Error('难度配置未加载');
      for (const [level, kind] of readLevelDifficulty(difficulty.json)) session.difficultyKinds.set(level, kind);
      session.prepareProgress();
      const preparation = this.prepareBootAssets(session);
      session.loadingView!.setProgress(0.55);
      await preparation;
      if (session.destroyed) return;
      await mountCurrencyOverlay(session);
      if (session.destroyed) return;
      session.loadingView!.setProgress(1);
      if (!session.destroyed && session.play && session.catalog) {
        session.app.clearError();
        session.generation += 1;
        await session.StateMachine.changeState(HomeState);
        session.inputLocked = false;
        session.reportModuleReady();
      }
    } catch (cause) {
      if (session.destroyed) return;
      const message = cause instanceof Error ? cause.message : String(cause);
      session.app.setError({ code: 'CONFIG', message });
      if (session.loadingView) session.loadingView.setError(message.includes('存档') ? message : '补给准备失败，请重新进入');
      else { session.homeView!.setVisible(true); session.homeView!.setFeedback('补给准备失败，请重新进入'); }
      console.error(`[Colony] startup failed: ${message}`);
      session.reportModuleFailure(cause);
    } finally {
      if (session.bootPromise) session.bootPromise = null;
    }
  }

  /** 隐藏 Loading 视图。 */
  public exit(): void {
    this.context.loadingView?.node.destroy(); this.context.loadingView = null;
  }

  /** 并行预加载音频、关卡与结算 UI。 */
  protected async prepareBootAssets(session: ColonySceneBootstrap): Promise<void> {
    const colonyLoad = { loadConfig: { bundleStr: 'Colony' }, parent: session.popupRoot!,
      poolInitFillNum: 0, poolMinHoldNum: 0, poolMaxHoldNum: 0 };
    await Promise.all([
      this.preloadAudio(session),
      this.loadLevelCatalog(session),
      this.loadCollectionFrames(session),
      mk.uiManage.regis(ColonyResultSuccessView, 'popups/resultSuccess/prefab/resultSuccess', session.popupRoot!, colonyLoad),
      mk.uiManage.regis(ColonyResultFailView, 'popups/resultFail/prefab/resultFail', session.popupRoot!, colonyLoad),
      mk.uiManage.regis(ColonyProgressView, 'popups/progress/progress', session.popupRoot!, colonyLoad),
      mk.uiManage.regis(ColonyCommunityView, 'popups/progress/community', session.popupRoot!, colonyLoad),
      mk.uiManage.regis(ColonySettingsView, 'popups/settings/prefab/settings', session.popupRoot!, colonyLoad),
      mk.uiManage.regis(ColonyConfirmView, 'popups/confirm/prefab/confirm', session.popupRoot!, colonyLoad),
      mk.uiManage.regis(ColonyShopView, 'popups/shop/prefab/shop', session.popupRoot!, colonyLoad),
      mk.uiManage.regis(ColonyToolView, 'popups/tool/tool', session.popupRoot!, colonyLoad),
      mk.uiManage.regis(ColonyToastView, 'popups/toast/prefab/toast', session.popupRoot!, colonyLoad),
    ]);
  }

  /** 预加载 click/success/fail 音效。 */
  private async preloadAudio(session: ColonySceneBootstrap): Promise<void> {
    const names: ColonySoundName[] = ['click', 'success', 'fail'];
    await Promise.all(names.map(async (name) => {
      const unit = await mk.audio.add(
        `audio/${name}`,
        session.popupRoot!,
        { type: GlobalConfig.Audio.Type.Effect, loadConfig: { bundleStr: 'Colony' } },
      );
      if (unit) session.audioUnits.set(name, unit);
    }));
  }
  private async loadCollectionFrames(session: ColonySceneBootstrap): Promise<void> {
    const orb = await mk.asset.get('db://assets/Colony/art/toy-market/ui/r07/energy-orb.png', SpriteFrame, session.node);
    if (session.destroyed) return;
    if (!orb) throw new Error('搬运反馈素材未加载');
    session.collectionFrames = { orb };
    const chain = await mk.asset.get('db://assets/Colony/art/toy-market/ui/r10/locked-chains-padlock.png', SpriteFrame, session.node);
    if (session.destroyed) return;
    if (!chain) throw new Error('锁链素材未加载');
    session.stackChainFrame = chain;
  }

  /** 加载开发关卡目录并构建 ColonyFlowModel。 */
  private async loadLevelCatalog(session: ColonySceneBootstrap): Promise<void> {
    try {
      const catalog = createOperationalCatalog();
      session.catalog = catalog;
      session.play = new ColonyFlowModel(catalog);
    } catch (cause) {
      session.play = null;
      session.catalog = null;
      throw cause instanceof Error ? cause : new Error(String(cause));
    }
  }
}
