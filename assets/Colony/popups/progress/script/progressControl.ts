import type { Node } from 'cc';
import mk from 'mk';
import { ColonyUtil } from '../../../scripts/colonyUtil';
import { ProgressModel, type ProgressPage } from './progressModel';
import { ColonyProgressView } from './progressView';
import { ColonyPopupView } from './popupView';
import { ColonyLeaderboardView } from '../../leaderboard/script/leaderboardView';
import { ColonySettingsView } from '../../settings/script/settingsView';
import { ColonyConfirmView } from '../../confirm/script/confirmView';
import { ColonySocialPopupView } from '../../social/script/socialPopupView';
import { ColonyShopView } from '../../shop/script/shopView';
import { swallowMkInterrupt } from '../../resultPopupNav';
import { ColonyCommunityView } from './communityView';

export interface ProgressNavigation {
  read(): ProgressPage;
  act(action: string): Promise<string | void> | string | void;
  closed(): void;
  closing?(): void;
  canClose?(): boolean;
  cleanupFailed?(cause: unknown, retryAvailable: boolean): void;
}

export type ProgressViewType = typeof ColonyProgressView | typeof ColonyLeaderboardView | typeof ColonySettingsView | typeof ColonyConfirmView | typeof ColonySocialPopupView | typeof ColonyShopView | typeof ColonyCommunityView;

export class ProgressControl extends mk.MVCControlBase<ProgressModel, ColonyPopupView> {
  private busy = false;
  private notified = false;

  public constructor(private readonly parent: Node, private readonly navigation: ProgressNavigation,
    public readonly viewType: ProgressViewType = ColonyProgressView) { super(); }

  protected async open(): Promise<void> {
    this._model = await ProgressModel.new();
    this._model.page = this.navigation.read();
    const view = await mk.uiManage.open(this.viewType, { init: this._model, parent: this.parent });
    if (!(view instanceof this.viewType)) throw new Error('Progress popup could not be opened');
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

  public refresh(): void {
    if (!this.isClosing && !this.busy && this._view?.isAvailable()) { this._model.page = this.navigation.read(); this._view.render(); }
  }
  public async navigateToShop(): Promise<void> {
    try { await this.whenOpened(); } catch { return; }
    if (!this.isClosing) await this.act('section:shop');
  }
  public suspend(): void { this._view?.suspend(); }

  private async dismiss(): Promise<void> {
    if (this.busy || this.isClosing) return;
    if (this.navigation.canClose?.() === false) {
      this._model.feedback = '奖励待保存，请重试领取，无需再看视频';
      this._view.render();
      return;
    }
    await this.forceClose();
  }

  /** Terminal gameplay may supersede an operation popup while ants keep moving. */
  public async forceClose(): Promise<void> {
    this.navigation.closing?.();
    await swallowMkInterrupt(Promise.resolve(this.close()));
    if (!this.notified) { this.notified = true; this.navigation.closed(); }
  }
}
