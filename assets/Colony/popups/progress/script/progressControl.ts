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
import { ColonySpeedView } from '../../speed/script/speedView';
import { swallowMkInterrupt } from '../../resultPopupNav';
import { ColonyCommunityView } from './communityView';
import { UNAVAILABLE_ACCOUNT, type ProductAccountAction, type ProductAccountProjection } from '../../../../shell/contracts';

export interface ProgressNavigation {
  readAccount?(): ProductAccountProjection;
  actAccount?(action: ProductAccountAction): void;
  read(): ProgressPage;
  act(action: string): Promise<string | void> | string | void;
  closed(): void;
  closing?(): void;
  canClose?(): boolean;
  cleanupFailed?(cause: unknown, retryAvailable: boolean): void;
}

export type ProgressViewType = typeof ColonyProgressView | typeof ColonyLeaderboardView | typeof ColonySettingsView | typeof ColonyConfirmView | typeof ColonySocialPopupView | typeof ColonyShopView | typeof ColonySpeedView | typeof ColonyCommunityView;

export class ProgressControl extends mk.MVCControlBase<ProgressModel, ColonyPopupView> {
  private busy = false;
  private notified = false;
  private queuedProfileAction: string | null = null;
  private profileSaveInFlight = false;
  private activeProfileAction: string | null = null;
  private closeAfterProfileSave = false;

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
    if (view instanceof ColonySettingsView) {
      view.event.on('account-action', this.actAccount, this);
      view.event.on('account-refresh', this.refreshAccount, this);
      this.refreshAccount();
    }
  }

  private actAccount(value: unknown): void {
    if (this.isClosing || !(this._view instanceof ColonySettingsView) || !this._view.isAvailable()) return;
    if (!this._view.hasAccountBindings()) return;
    if (value !== 'login' && value !== 'cancel' && value !== 'logout') return;
    this.navigation.actAccount?.(value);
    this.refreshAccount();
  }

  /** This lane never reads a gameplay snapshot, saves a profile or holds popup busy. */
  public refreshAccount(): void {
    if (this.isClosing || !(this._view instanceof ColonySettingsView) || !this._view.isAvailable()) return;
    if (!this._view.hasAccountBindings()) { this._view.renderAccount(UNAVAILABLE_ACCOUNT); return; }
    const account = this.navigation.readAccount?.();
    if (account) this._view.renderAccount(account);
  }

  private async act(value: unknown): Promise<void> {
    if (typeof value !== 'string') return;
    const action = value;
    if (this.isClosing) return;
    if (this.busy) {
      if (action.startsWith('profile-save:') && this._view instanceof ColonySettingsView) {
        this.queuedProfileAction = action === this.activeProfileAction ? null : action;
      }
      return;
    }
    const model = this._model, view = this._view;
    const speedView = model.page.layout === 'speed' ? view as ColonySpeedView : null;
    this.busy = true;
    this.profileSaveInFlight = action.startsWith('profile-save:');
    this.activeProfileAction = this.profileSaveInFlight ? action : null;
    let failed = false;
    try {
      speedView?.setActionPending(true);
      const feedback = await this.navigation.act(action);
      if (this.isClosing || this._model !== model || this._view !== view || !view.isAvailable()) return;
      model.feedback = feedback ?? '';
      model.page = this.navigation.read();
    } catch (cause) {
      failed = true;
      if (!this.isClosing && view.isAvailable()) model.feedback = cause instanceof Error ? cause.message : String(cause);
    } finally {
      this.busy = false;
      this.profileSaveInFlight = false;
      this.activeProfileAction = null;
      if (!this.isClosing && view.isAvailable()) {
        if (speedView) speedView.setActionPending(false);
        else view.render();
      }
      const queued = this.queuedProfileAction;
      this.queuedProfileAction = null;
      if (!this.isClosing && view.isAvailable()) {
        if (queued) await this.act(queued);
        else if (this.closeAfterProfileSave) {
          this.closeAfterProfileSave = false;
          if (!failed) await this.dismiss();
        }
      } else this.closeAfterProfileSave = false;
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
    if (this.isClosing) return;
    if (this.busy) {
      if (this.profileSaveInFlight || this.queuedProfileAction) this.closeAfterProfileSave = true;
      return;
    }
    if (this.navigation.canClose?.() === false) {
      this._model.feedback = '奖励待保存，请重试领取，无需再看视频';
      this._view.render();
      return;
    }
    await this.forceClose();
  }

  /** Terminal gameplay may supersede an operation popup while ants keep moving. */
  public async forceClose(): Promise<void> {
    this.queuedProfileAction = null; this.closeAfterProfileSave = false;
    this.navigation.closing?.();
    await swallowMkInterrupt(Promise.resolve(this.close()));
    if (!this.notified) { this.notified = true; this.navigation.closed(); }
  }
}
