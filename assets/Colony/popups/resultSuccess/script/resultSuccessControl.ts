import type { Node } from 'cc';
import mk from 'mk';
import {
  resolveResultPopupAction,
  swallowMkInterrupt,
  type ResultPopupNav,
  type ResultPopupSeed,
} from '../../resultPopupNav';
import { ColonyUtil } from '../../../scripts/colonyUtil';
import { ResultSuccessModel } from './resultSuccessModel';
import { ColonyResultSuccessView } from './resultSuccessView';

/** 胜利结算 Control：打开弹窗并解释 primary/home 导航。 */
export class ResultSuccessControl extends mk.MVCControlBase<ResultSuccessModel, ColonyResultSuccessView> {
  private _seed!: ResultPopupSeed;
  private _parent!: Node;
  private _nav!: ResultPopupNav;
  private finishing = false;
  private adBusy = false;

  public constructor(seed: ResultPopupSeed, parent: Node, nav: ResultPopupNav) {
    super();
    this._seed = seed;
    this._parent = parent;
    this._nav = nav;
  }

  /** 创建 Model、打开 View 并订阅按钮事件。 */
  protected async open(): Promise<void> {
    this._model = await ResultSuccessModel.new();
    this._model.level = this._seed.level;
    this._model.transported = this._seed.transported;
    this._model.hasNextLevel = this._seed.hasNextLevel;
    this._model.rewardText = this._seed.rewardText ?? '';
    this._model.daily = this._seed.daily ?? false;
    this._model.adAvailable = this._seed.adAvailable ?? false;
    this._model.firstBuild = this._seed.firstBuild ?? false;
    this._model.collection = this._seed.collection;

    const opened = await mk.uiManage.open(ColonyResultSuccessView, {
      init: this._model,
      parent: this._parent,
    });
    if (!opened || !(opened instanceof ColonyResultSuccessView)) {
      throw new Error('Failed to open result success view');
    }
    this._view = opened;
    ColonyUtil.applyUiLayer(opened.node);
    opened.event.on('primary', this.onPrimary, this);
    opened.event.on('home', this.onHome, this);
    opened.event.on('ad', this.onAd, this);
  }

  private async onAd(): Promise<void> {
    if (this.isClosing || this.adBusy || !this._model.adAvailable || !this._nav.onAd) return;
    const model = this._model, view = this._view;
    this.adBusy = true;
    try {
      model.adAvailable = false;
      view.refreshReward();
      const rewardText = await this._nav.onAd();
      if (this.isClosing || this._model !== model || this._view !== view || !view.isAvailable()) return;
      model.rewardText = rewardText;
      model.adAvailable = this._nav.canAd?.() ?? false;
      view.refreshReward();
    } finally { this.adBusy = false; }
  }

  /** 主按钮：每日可再挑战；主线有下一关则继续，否则回首页。 */
  private async onPrimary(): Promise<void> {
    await this.finish(resolveResultPopupAction('success', 'primary', this._seed.hasNextLevel, this._seed.daily));
  }

  /** 回首页按钮。 */
  private async onHome(): Promise<void> {
    await this.finish(resolveResultPopupAction('success', 'home', this._seed.hasNextLevel));
  }

  /** 关闭弹窗后执行导航。 */
  private async finish(action: 'continue' | 'home'): Promise<void> {
    if (this.isClosing || this.finishing || this.adBusy) return;
    if (this._nav.canNavigate?.() === false) {
      this._model.rewardText = '奖励待保存，请重试领取，无需再看视频';
      this._view.refreshReward();
      return;
    }
    this.finishing = true;
    const navigation = this._nav;
    await swallowMkInterrupt(Promise.resolve(this.close()));
    if (navigation.canNavigate?.() === false) return;
    if (action === 'continue') await navigation.onContinue();
    else await navigation.onHome();
  }
}
