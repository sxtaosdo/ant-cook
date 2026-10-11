import { _decorator, Color, EditBox, Label, Layout, Node, Sprite, SpriteFrame } from 'cc';
import { ColonyPopupView } from '../../progress/script/popupView';
import { PlayerProfile } from '../../../scripts/application/playerProfile';
import { UNAVAILABLE_ACCOUNT, type ProductAccountAction, type ProductAccountProjection } from '../../../../shell/contracts';

const { ccclass, property } = _decorator;
const ACCOUNT_UI_UNAVAILABLE = '登录界面暂不可用，离线玩法可继续';

@ccclass('ColonySettingsView')
export class ColonySettingsView extends ColonyPopupView {
  @property(Node) public settingsRoot: Node | null = null;
  @property(Layout) public controlsLayout: Layout | null = null;
  @property(Node) public musicButton: Node | null = null;
  @property(Node) public soundButton: Node | null = null;
  @property(Node) public homeButton: Node | null = null;
  @property(Node) public restartButton: Node | null = null;
  @property(Sprite) public musicIcon: Sprite | null = null;
  @property(Sprite) public soundIcon: Sprite | null = null;
  @property(Node) public feedbackButton: Node | null = null;
  @property(Node) public agreementButton: Node | null = null;
  @property(Node) public privacyButton: Node | null = null;
  @property(Node) public closeButton: Node | null = null;
  @property(Node) public productNavigationButton: Node | null = null;
  // Preserve existing serialized controls until the pending Creator removal is saved.
  @property(Node) public gmButton: Node | null = null;
  @property(Label) public versionLabel: Label | null = null;
  @property(Label) public userIdLabel: Label | null = null;
  @property(Label) public noticeLabel: Label | null = null;
  @property(EditBox) public nicknameEdit: EditBox | null = null;
  @property(Sprite) public profileAvatar: Sprite | null = null;
  @property(Label) public profileInitial: Label | null = null;
  @property(Label) public registeredLabel: Label | null = null;
  @property(Node) public avatarButton: Node | null = null;
  @property(Node) public saveProfileButton: Node | null = null;
  @property(Label) public accountStatusLabel: Label | null = null;
  @property(Node) public accountActionButton: Node | null = null;
  @property(Label) public accountActionLabel: Label | null = null;
  private accountRefreshElapsed = 0;
  private accountBindingKey = '';
  private accountUiDiagnosed = false;
  private profileKey = '';
  private persistedDraftKey = '';
  private lastSubmittedProfile: string | null = null;
  private profileEditNode: Node | null = null;
  private selectedAvatar = 0;
  @property(SpriteFrame) public musicOnFrame: SpriteFrame | null = null;
  @property(SpriteFrame) public musicOffFrame: SpriteFrame | null = null;
  @property(SpriteFrame) public soundOnFrame: SpriteFrame | null = null;
  @property(SpriteFrame) public soundOffFrame: SpriteFrame | null = null;
  @property public homeSpacing = 84;
  @property public roundSpacing = 24;

  protected prepareOpen(): void {
    this.accountRefreshElapsed = 0;
    this.accountBindingKey = '';
    this.profileKey = ''; this.persistedDraftKey = ''; this.lastSubmittedProfile = null;
    this.clearProfileBindings();
    const node = this.profileEditNode = this.nicknameEdit?.node ?? null;
    node?.on(EditBox.EventType.EDITING_DID_ENDED, this.submitProfile, this);
    node?.on(EditBox.EventType.EDITING_RETURN, this.submitProfile, this);
  }
  private submitProfile(): void {
    if (!this.isAvailable() || !this.nicknameEdit) return;
    const nickname = this.nicknameEdit.string, avatar = this.selectedAvatar;
    const key = JSON.stringify([nickname.normalize('NFC').trim(), avatar]);
    if (key === this.lastSubmittedProfile || (key === this.persistedDraftKey && this.lastSubmittedProfile === null)) return;
    this.lastSubmittedProfile = key;
    this.event.emit('action', `profile-save:${encodeURIComponent(JSON.stringify({ nickname, avatar }))}`);
  }
  private clearProfileBindings(): void {
    if (this.profileEditNode?.isValid) this.profileEditNode.targetOff(this);
    this.profileEditNode = null;
  }
  public close(): void { this.clearProfileBindings(); super.close(); }
  public suspend(): void { this.clearProfileBindings(); super.suspend(); }
  protected onDisable(): void { this.clearProfileBindings(); super.onDisable(); }
  protected onDestroy(): void { this.clearProfileBindings(); super.onDestroy(); }

  protected update(dt: number): void {
    if (!this.isAvailable()) return;
    this.accountRefreshElapsed += dt;
    if (this.accountRefreshElapsed >= 1) {
      this.accountRefreshElapsed = 0;
      this.event.emit('account-refresh');
    }
  }

  public hasAccountBindings(): boolean {
    return !!this.accountStatusLabel && !!this.accountActionButton && !!this.accountActionLabel;
  }

  public renderAccount(account: ProductAccountProjection): void {
    // Older saved Prefabs retain the original Settings page and fail closed for account actions.
    if (!this.hasAccountBindings()) {
      this.accountBindingKey = '';
      if (this.accountActionButton) this.bind(this.accountActionButton, false, () => {});
      if (this.accountActionLabel) this.accountActionLabel.string = '不可用';
      if (this.accountStatusLabel) this.accountStatusLabel.string = ACCOUNT_UI_UNAVAILABLE;
      if (!this._model.feedback && this.noticeLabel) {
        this.noticeLabel.node.active = true;
        this.noticeLabel.string = ACCOUNT_UI_UNAVAILABLE;
      }
      if (!this.accountUiDiagnosed) { this.accountUiDiagnosed = true; console.warn('SETTINGS_ACCOUNT_UI_UNAVAILABLE'); }
      return;
    }
    let text = '游客，可离线游玩', caption = '登录', action: ProductAccountAction = 'login';
    let enabled = account.canRequestLogin;
    if (account.authStatus === 'pending') { text = '正在登录，离线玩法可继续'; caption = '取消'; action = 'cancel'; enabled = true; }
    else if (account.authStatus === 'active') { text = '已登录'; caption = '退出'; action = 'logout'; enabled = true; }
    else if (account.feedback === 'unavailable') text = '登录暂不可用，离线玩法可继续';
    else if (account.feedback === 'cancelled') text = '已取消登录';
    else if (account.feedback === 'timeout') text = '登录超时，请重试';
    else if (account.feedback === 'failed') text = '本次登录未完成';
    else if (account.authStatus === 'expired') text = '登录已过期';
    this.accountStatusLabel!.string = text;
    this.accountActionLabel!.string = caption;
    const bindingKey = `${action}:${enabled}`;
    if (bindingKey !== this.accountBindingKey) {
      this.accountBindingKey = bindingKey;
      this.bind(this.accountActionButton!, enabled, () => { if (enabled) this.event.emit('account-action', action); });
    }
  }

  public render(): void {
    const settings = this._model.page.settings;
    if (!settings || !this.settingsRoot || !this.controlsLayout || !this.musicButton || !this.soundButton
      || !this.homeButton || !this.restartButton || !this.musicIcon || !this.soundIcon || !this.feedbackButton
      || !this.agreementButton || !this.privacyButton || !this.closeButton || !this.productNavigationButton
      || !this.versionLabel || !this.userIdLabel || !this.noticeLabel || !this.musicOnFrame
      || !this.musicOffFrame || !this.soundOnFrame || !this.soundOffFrame) {
      throw new Error('Settings popup binding is missing');
    }
    this.homeButton.active = settings.inRound;
    this.restartButton.active = settings.inRound;
    this.controlsLayout.spacingX = settings.inRound ? this.roundSpacing : this.homeSpacing;
    this.controlsLayout.updateLayout();
    this.musicIcon.spriteFrame = settings.musicEnabled ? this.musicOnFrame : this.musicOffFrame;
    this.soundIcon.spriteFrame = settings.soundEnabled ? this.soundOnFrame : this.soundOffFrame;
    for (const [button, action] of [[this.musicButton, 'toggle-music'], [this.soundButton, 'toggle-sound'],
      [this.homeButton, 'section:confirm-home'], [this.restartButton, 'section:confirm-restart'],
      [this.feedbackButton, 'settings-link:feedback'], [this.agreementButton, 'settings-link:agreement'],
      [this.privacyButton, 'settings-link:privacy'], [this.productNavigationButton, 'product-navigation']] as const) {
      this.bind(button, true, () => this.event.emit('action', action));
    }
    this.bind(this.closeButton, true, () => { this.submitProfile(); this.event.emit('close'); });
    this.versionLabel.string = settings.version;
    this.userIdLabel.string = `ID：${PlayerProfile.displayId(settings.userId)}`;
    const profile = settings.profile;
    if (profile) {
      if (!this.nicknameEdit || !this.profileAvatar || !this.profileInitial || !this.registeredLabel || !this.avatarButton) throw new Error('Settings profile bindings are missing');
      const key = JSON.stringify([profile.playerId, profile.nickname, profile.avatar]);
      const savedDraftKey = JSON.stringify([profile.nickname, profile.avatar]);
      const currentDraftKey = JSON.stringify([this.nicknameEdit.string.normalize('NFC').trim(), this.selectedAvatar]);
      // A completed older save must not overwrite text/avatar edited while it was pending.
      if (!this.profileKey || (key !== this.profileKey && ((this.lastSubmittedProfile === null && currentDraftKey === this.persistedDraftKey) || currentDraftKey === savedDraftKey))) {
        this.nicknameEdit.string = profile.nickname; this.selectedAvatar = profile.avatar;
        this.profileAvatar.color = new Color(profile.avatarColor);
      }
      this.profileKey = key; this.persistedDraftKey = savedDraftKey;
      if (this.lastSubmittedProfile === savedDraftKey || this._model.feedback) this.lastSubmittedProfile = null;
      this.profileInitial.string = [...this.nicknameEdit.string.trim()][0] ?? '我';
      this.registeredLabel.string = `注册时间：${profile.registeredAt === null ? '未记录' : new Date(profile.registeredAt + 8 * 3600000).toISOString().slice(0, 10)}`;
      this.bind(this.avatarButton, true, () => {
        this.selectedAvatar = (this.selectedAvatar + 1) % profile.avatarColors.length;
        this.profileAvatar!.color = new Color(profile.avatarColors[this.selectedAvatar]);
        this.submitProfile();
      });
      if (this.saveProfileButton) this.bind(this.saveProfileButton, true, this.submitProfile.bind(this));
    }
    if (this.gmButton) {
      this.gmButton.active = settings.gmAvailable;
      this.bind(this.gmButton, settings.gmAvailable, () => this.event.emit('action', 'section:gm'));
    }
    this.noticeLabel.node.active = Boolean(this._model.feedback);
    this.noticeLabel.string = this._model.feedback;
    this.renderAccount(settings.account ?? UNAVAILABLE_ACCOUNT);
  }
}
