import type { Node } from 'cc';
import mk from 'mk';
import { ColonyUtil } from '../../../scripts/colonyUtil';
import type { ProgressNavigation } from '../../progress/script/progressControl';
import { swallowMkInterrupt } from '../../resultPopupNav';
import { ToolModel } from './toolModel';
import { ColonyToolView } from './toolView';

export class ToolControl extends mk.MVCControlBase<ToolModel, ColonyToolView> {
  private busy = false;
  private notified = false;

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
    if (this.busy || this.isClosing) return;
    const model = this._model, view = this._view;
    this.busy = true;
    try {
      const feedback = await this.navigation.act(action);
      if (this.isClosing || this._model !== model || this._view !== view || !view.isAvailable()) return;
      model.feedback = feedback ?? '';
      model.page = this.navigation.read();
    } catch (cause) {
      if (!this.isClosing && view.isAvailable()) model.feedback = cause instanceof Error ? cause.message : String(cause);
    } finally {
      this.busy = false;
      if (!this.isClosing && view.isAvailable()) view.render();
    }
  }

  private async dismiss(): Promise<void> {
    if (this.busy || this.isClosing) return;
    if (this.navigation.canClose?.() === false) {
      this._model.feedback = '奖励待保存，请重试领取，无需再看视频';
      this._view.render();
      return;
    }
    await this.forceClose();
  }

  public async navigateToShop(): Promise<void> {
    try { await this.whenOpened(); } catch { return; }
    if (!this.isClosing) await this.act('section:shop');
  }

  public async forceClose(): Promise<void> {
    this.navigation.closing?.();
    try { await swallowMkInterrupt(Promise.resolve(this.close())); }
    catch (cause) {
      const retryAvailable = this.offerCleanupRetry();
      this.navigation.cleanupFailed?.(cause, retryAvailable);
      throw cause;
    }
    if (!this.notified) { this.notified = true; this.navigation.closed(); }
  }

  public offerCleanupRetry(): boolean {
    return this._view?.showCleanupRetry(() => this.forceClose()) ?? false;
  }
}
