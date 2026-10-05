import type { Node } from 'cc';
import mk from 'mk';
import { ColonyUtil } from '../../../scripts/colonyUtil';
import type { ProgressNavigation } from '../../progress/script/progressControl';
import { swallowMkInterrupt } from '../../resultPopupNav';
import { ToolModel } from './toolModel';
import { ColonyToolView } from './toolView';

export class ToolControl extends mk.MVCControlBase<ToolModel, ColonyToolView> {
  private busy = false;

  public constructor(private readonly parent: Node, private readonly navigation: ProgressNavigation) { super(); }

  protected async open(): Promise<void> {
    this._model = await ToolModel.new();
    this._model.page = this.navigation.read();
    const view = await mk.uiManage.open(ColonyToolView, { init: this._model, parent: this.parent });
    if (!(view instanceof ColonyToolView)) throw new Error('Tool popup could not be opened');
    this._view = view;
    ColonyUtil.applyUiLayer(view.node);
    view.event.on('action', this.act, this);
    view.event.on('close', this.dismiss, this);
  }

  private async act(value: unknown): Promise<void> {
    if (typeof value !== 'string') return;
    const action = value;
    if (this.busy) return;
    this.busy = true;
    try {
      this._model.feedback = (await this.navigation.act(action)) ?? '';
      this._model.page = this.navigation.read();
    } catch (cause) {
      this._model.feedback = cause instanceof Error ? cause.message : String(cause);
    } finally {
      this.busy = false;
      if (this._view?.isAvailable()) this._view.render();
    }
  }

  private async dismiss(): Promise<void> {
    if (this.busy) return;
    if (this.navigation.canClose?.() === false) {
      this._model.feedback = '奖励待保存，请重试领取，无需再看视频';
      this._view.render();
      return;
    }
    await this.forceClose();
  }

  public async forceClose(): Promise<void> {
    if (this._view?.isAvailable()) {
      this._view.event.off('action', this.act, this);
      this._view.event.off('close', this.dismiss, this);
    }
    await swallowMkInterrupt(Promise.resolve(this.close()));
    this.navigation.closed();
  }
}
