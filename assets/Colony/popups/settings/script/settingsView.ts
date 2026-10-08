import { _decorator, Color, EditBox, Label, Layout, Node, Sprite, SpriteFrame } from 'cc';
import { ColonyPopupView } from '../../progress/script/popupView';

const { ccclass, property } = _decorator;

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
  private profileKey = '';
  private selectedAvatar = 0;
  @property(SpriteFrame) public musicOnFrame: SpriteFrame | null = null;
  @property(SpriteFrame) public musicOffFrame: SpriteFrame | null = null;
  @property(SpriteFrame) public soundOnFrame: SpriteFrame | null = null;
  @property(SpriteFrame) public soundOffFrame: SpriteFrame | null = null;
  @property public homeSpacing = 84;
  @property public roundSpacing = 24;

  protected prepareOpen(): void { this.profileKey = ''; }

  public render(): void {
    const settings = this._model.page.settings;
    if (!settings || !this.settingsRoot || !this.controlsLayout || !this.musicButton || !this.soundButton
      || !this.homeButton || !this.restartButton || !this.musicIcon || !this.soundIcon || !this.feedbackButton
      || !this.agreementButton || !this.privacyButton || !this.closeButton || !this.productNavigationButton
      || !this.gmButton || !this.versionLabel || !this.userIdLabel || !this.noticeLabel || !this.musicOnFrame
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
    this.bind(this.closeButton, true, () => this.event.emit('close'));
    this.versionLabel.string = settings.version;
    this.userIdLabel.string = `本地玩家ID：${settings.userId}`;
    const profile = settings.profile;
    if (profile) {
      if (!this.nicknameEdit || !this.profileAvatar || !this.profileInitial || !this.registeredLabel || !this.avatarButton || !this.saveProfileButton) throw new Error('Settings profile bindings are missing');
      const key = JSON.stringify([profile.playerId, profile.nickname, profile.avatar]);
      if (key !== this.profileKey) {
        this.profileKey = key; this.nicknameEdit.string = profile.nickname; this.selectedAvatar = profile.avatar;
        this.profileAvatar.color = new Color(profile.avatarColor);
      }
      this.profileInitial.string = [...profile.nickname][0] ?? '我';
      this.registeredLabel.string = `注册时间：${profile.registeredAt === null ? '未记录' : new Date(profile.registeredAt + 8 * 3600000).toISOString().slice(0, 10)}`;
      this.bind(this.avatarButton, true, () => {
        this.selectedAvatar = (this.selectedAvatar + 1) % profile.avatarColors.length;
        this.profileAvatar!.color = new Color(profile.avatarColors[this.selectedAvatar]);
      });
      this.bind(this.saveProfileButton, true, () => this.event.emit('action', `profile-save:${encodeURIComponent(JSON.stringify({ nickname: this.nicknameEdit!.string, avatar: this.selectedAvatar }))}`));
    }
    this.gmButton.active = settings.gmAvailable;
    this.bind(this.gmButton, settings.gmAvailable, () => this.event.emit('action', 'section:gm'));
    this.noticeLabel.node.active = Boolean(this._model.feedback);
    this.noticeLabel.string = this._model.feedback;
  }
}
