import type { Node } from 'cc';
import mk from 'mk';
import {
  resolveResultPopupAction,
  swallowMkInterrupt,
  type ResultPopupNav,
  type ResultPopupSeed,
} from '../../resultPopupNav';
import { ColonyUtil } from '../../../scripts/colonyUtil';
import { ResultFailModel } from './resultFailModel';
import { ColonyResultFailView } from './resultFailView';

/** 失败结算 Control：打开弹窗并解释 primary/home 导航。 */
export class ResultFailControl extends mk.MVCControlBase<ResultFailModel, ColonyResultFailView> {
  private _seed!: ResultPopupSeed;
  private _parent!: Node;
  private _nav!: ResultPopupNav;

  public constructor(seed: ResultPopupSeed, parent: Node, nav: ResultPopupNav) {
    super();
    this._seed = seed;
    this._parent = parent;
    this._nav = nav;
  }

  /** 创建 Model、打开 View 并订阅按钮事件。 */
  protected async open(): Promise<void> {
    this._model = await ResultFailModel.new();
    this._model.level = this._seed.level;
    this._model.transported = this._seed.transported;
    this._model.hasNextLevel = this._seed.hasNextLevel;

    const opened = await mk.uiManage.open(ColonyResultFailView, {
      init: this._model,
      parent: this._parent,
    });
    if (!opened || !(opened instanceof ColonyResultFailView)) {
      throw new Error('Failed to open result fail view');
    }
    this._view = opened;
    ColonyUtil.applyUiLayer(opened.node);
    opened.event.on('primary', this.onPrimary, this);
    opened.event.on('home', this.onHome, this);
  }

  /** 主按钮：重试本关。 */
  private async onPrimary(): Promise<void> {
    await this.finish(resolveResultPopupAction('fail', 'primary', this._seed.hasNextLevel));
  }

  /** 回首页按钮。 */
  private async onHome(): Promise<void> {
    await this.finish(resolveResultPopupAction('fail', 'home', this._seed.hasNextLevel));
  }

  /** 关闭弹窗后执行导航。 */
  private async finish(action: 'continue' | 'home'): Promise<void> {
    await swallowMkInterrupt(Promise.resolve(this.close()));
    if (action === 'continue') await this._nav.onContinue();
    else await this._nav.onHome();
  }
}
