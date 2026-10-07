import { _decorator, Color, Label, Node, Sprite, UITransform, view, Widget } from 'cc';
import { ColonyPopupView } from './popupView';
const { ccclass, property } = _decorator;

@ccclass('ColonyCommunityView')
export class ColonyCommunityView extends ColonyPopupView {
  @property(UITransform) public panel: UITransform | null = null;
  @property(Node) public contentRoot: Node | null = null;
  @property(Node) public leaderboardTab: Node | null = null;
  @property(Node) public socialTab: Node | null = null;
  @property(Node) public closeButton: Node | null = null;
  @property(Node) public loadingRoot: Node | null = null;
  @property(Label) public loadingLabel: Label | null = null;
  @property(Node) public retryButton: Node | null = null;
  @property(Label) public feedbackLabel: Label | null = null;
  private loading = false;
  private failure = '';

  public contentParent(): Node {
    if (!this.contentRoot?.isValid) throw new Error('Community content mount is missing');
    return this.contentRoot;
  }
  public setContentState(loading: boolean, failure = ''): void {
    this.loading = loading; this.failure = failure;
    if (this.isAvailable()) this.render();
  }
  public render(): void {
    if (!this.panel || !this.contentRoot || !this.leaderboardTab || !this.socialTab || !this.closeButton
      || !this.loadingRoot || !this.loadingLabel || !this.retryButton || !this.feedbackLabel) throw new Error('Community shell binding is missing');
    this.panel.height = Math.min(1200, view.getVisibleSize().height - 100);
    this.contentRoot.getComponent(Widget)!.updateAlignment();
    this.loadingRoot.getComponent(Widget)!.updateAlignment();
    const social = this._model.page.layout === 'social';
    this.leaderboardTab.getComponent(Sprite)!.color = new Color(social ? '#FFF9EB' : '#FFE2A7');
    this.socialTab.getComponent(Sprite)!.color = new Color(social ? '#FFE2A7' : '#FFF9EB');
    this.bind(this.leaderboardTab, true, () => this.event.emit('action', 'community-tab:leaderboard'));
    this.bind(this.socialTab, true, () => this.event.emit('action', 'community-tab:social'));
    this.bind(this.closeButton, true, () => this.event.emit('action', 'community-close'));
    this.bind(this.retryButton, Boolean(this.failure), () => this.event.emit('action', 'community-retry'));
    this.loadingRoot.active = this.loading || Boolean(this.failure);
    this.loadingLabel.string = this.failure || '页面加载中…';
    this.retryButton.active = Boolean(this.failure);
    this.feedbackLabel.string = this._model.feedback;
  }
}
