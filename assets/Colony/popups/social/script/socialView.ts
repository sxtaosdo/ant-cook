import { _decorator, Button, Color, Component, EventTouch, Label, Node, Sprite, SpriteFrame, UITransform, Widget, view } from 'cc';
import mk from 'mk';
import { VirtualScrollView } from '../../../vendor/vscrollview/VScrollView';
import type { SocialCard, SocialPage, SocialProfile } from '../../../scripts/presentation/social/socialPresentation';

import { ColonySocialRow } from './socialRow';

type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

const { ccclass, property } = _decorator;

@ccclass('ColonySocialView')
/** Serialized popup content; owns only short-lived rendering state. */
export class ColonySocialView extends Component {
  @property(VirtualScrollView)
  public list: VirtualScrollView | null = null;
  @property(Widget) public rootWidget: Widget | null = null;
  @property(Widget) public listWidget: Widget | null = null;
  @property(UITransform) public panel: UITransform | null = null;
  @property(Label) public titleLabel: Label | null = null;
  @property(Label) public summaryLabel: Label | null = null;
  @property(Widget) public summaryWidget: Widget | null = null;
  @property(Label) public footerLabel: Label | null = null;
  @property(Node) public closeButton: Node | null = null;
  @property(Node) public backButton: Node | null = null;
  @property(Node) public tabsRoot: Node | null = null;
  @property([Sprite]) public tabButtons: Sprite[] = [];
  @property(Node) public profileRoot: Node | null = null;
  @property(Sprite) public profileAvatar: Sprite | null = null;
  @property(Label) public profileInitial: Label | null = null;
  @property(Label) public themeNameLabel: Label | null = null;
  @property(Label) public emptyLabel: Label | null = null;
  @property(Sprite) public stallSprite: Sprite | null = null;
  @property([Sprite]) public produceSprites: Sprite[] = [];
  @property(Sprite) public lanternSprite: Sprite | null = null;
  @property(Sprite) public signSprite: Sprite | null = null;
  @property(Sprite) public planterSprite: Sprite | null = null;
  @property([Node]) public profileButtons: Node[] = [];
  @property([Label]) public profileButtonLabels: Label[] = [];
  @property public maximumHeight = 1200;
  @property public viewportMargin = 120;
  @property public listSummaryTop = 260;
  @property public profileSummaryTop = 190;
  private ownerAvailable: () => boolean = () => false;
  private revision = 0;
  private pageKey = '';
  private readonly boundNodes = new Set<Node>();

  public cancelPending(): void { this.clearBindings(); }
  public hide(): void { this.node.active = false; this.revision++; }
  public render(page: DeepReadonly<SocialPage>, title: string, summary: string, feedback: string, action: (value: string) => void, close: () => void, ownerAvailable: () => boolean): void {
    this.ownerAvailable = ownerAvailable;
    this.node.active = true;
    const revision = ++this.revision;
    if (!this.rootWidget || !this.listWidget || !this.panel || !this.titleLabel || !this.summaryLabel || !this.summaryWidget || !this.footerLabel
      || !this.closeButton || !this.backButton || !this.tabsRoot || this.tabButtons.length !== 3
      || !this.profileRoot || !this.list) throw new Error('Social popup binding is missing');
    this.panel.height = Math.min(this.maximumHeight, view.getVisibleSize().height - this.viewportMargin);
    this.rootWidget.updateAlignment();
    this.listWidget.updateAlignment();
    this.titleLabel.string = title;
    this.summaryLabel.string = summary;
    this.summaryWidget.top = page.tab === 'profile' ? this.profileSummaryTop : this.listSummaryTop;
    this.summaryWidget.updateAlignment();
    this.footerLabel.string = feedback || page.footer;
    this.bind(this.closeButton, true, close);
    this.backButton.active = page.tab === 'profile' || page.tab === 'messages';
    this.bind(this.backButton, true, () => action('back'));
    this.tabsRoot.active = !this.backButton.active;
    this.tabButtons.forEach((button, index) => {
      const tab = (['partners', 'history', 'help'] as const)[index]!;
      button.color = new Color(page.tab === tab ? '#FFE2A7' : '#FFF9EB');
      this.bind(button.node, true, () => action(`tab:${tab}`));
    });
    const profile = this.profileRoot;
    profile.active = page.tab === 'profile' && Boolean(page.profile);
    const list = this.list;
    list.node.active = !profile.active;
    if (profile.active) this.profile(page.profile!, revision, action);
    else {
      list.renderItemFn = (node, index) => this.card(node, page.cards[index]!, action);
      list.refreshList(page.cards.length);
      const key = page.tab;
      if (this.pageKey !== key) list.scrollToTop(false);
      this.pageKey = key;
    }
  }
  private card(node: Node, card: DeepReadonly<SocialCard>, action: (value: string) => void): void {
    const row = node.getComponent(ColonySocialRow);
    if (!row) throw new Error('Social row component is missing');
    row.render(card);
    this.bind(row.actionButton!, card.enabled, () => action(card.action));
  }
  private profile(profile: DeepReadonly<SocialProfile>, revision: number, action: (value: string) => void): void {
    if (!this.profileAvatar || !this.profileInitial || !this.themeNameLabel || !this.emptyLabel || !this.stallSprite
      || this.produceSprites.length !== 8 || !this.lanternSprite || !this.signSprite || !this.planterSprite
      || this.profileButtons.length !== 6 || this.profileButtonLabels.length !== 6) throw new Error('Social profile binding is missing');
    const owner = this.node;
    const theme = profile.theme;
    this.profileAvatar.color = new Color(profile.avatarColor);
    this.profileInitial.string = [...profile.partner.name][0]!;
    const stall = theme.items.find(item => item.kind === 'stall')!;
    this.themeNameLabel.string = `${theme.name} · ${theme.cleared}/12 件`;
    const empty = this.emptyLabel; empty.node.active = stall.count === 0;
    empty.string = theme.items.some(item => item.count > 0) ? '伙伴已收集水果\n收集摊位后会自动摆上' : '伙伴还在收集第一件物品';
    for (const [index, item] of theme.items.entries()) {
      const sprites = item.kind === 'produce' ? this.produceSprites.slice((index - 1) * 2, index * 2)
        : [item.kind === 'stall' ? this.stallSprite : item.id.endsWith('-lantern') ? this.lanternSprite : item.id.endsWith('-sign') ? this.signSprite : this.planterSprite];
      const nodes = sprites.map(sprite => sprite.node);
      nodes.forEach((node, n) => { node.active = (item.kind === 'stall' || stall.count > 0) && item.count > n; });
      if (!nodes.some(n => n.active)) continue;
      const path = item.kind === 'stall' ? item.boardPath : item.iconPath;
      nodes.forEach(node => { node.getComponent(Sprite)!.spriteFrame = null; });
      void mk.asset.get(`db://${path}`, SpriteFrame, owner).then(frame => {
        if (frame && revision === this.revision && this.ownerAvailable() && this.isValid && owner.isValid && owner.activeInHierarchy) nodes.filter(node => node.isValid).forEach(node => { node.getComponent(Sprite)!.spriteFrame = frame; });
      }).catch(() => {
        if (revision === this.revision && this.ownerAvailable() && this.isValid && owner.isValid && owner.activeInHierarchy && empty.isValid && empty.node?.isValid) empty.string = `图片加载未完成：${item.name}`;
      });
    }
    const commands = [
      ['Previous', '上一主题', profile.previous, `theme:${theme.themeIndex - 1}`],
      ['Next', '下一主题', profile.next, `theme:${theme.themeIndex + 1}`],
      ['Follow', profile.partner.followed ? '取消关注' : '关注常客', profile.canFollow, 'follow'],
      ['Like', profile.liked ? '今日已赞' : '点赞', profile.canInteract && !profile.liked, 'like'],
      ['Message', profile.commented ? '今日已留言' : '留句话', profile.canInteract && !profile.commented, 'messages'],
      ['Request', '求助补给券', profile.canRequest, 'request'],
    ] as const;
    commands.forEach(([, text, enabled, value], index) => {
      this.profileButtonLabels[index]!.string = text;
      this.bind(this.profileButtons[index]!, enabled, () => action(value));
    });
  }
  private bind(node: Node, enabled: boolean, action: () => void): void {
    this.boundNodes.add(node);
    node.targetOff(this); const button = node.getComponent(Button)!; button.interactable = enabled;
    let dragged = false;
    node.on(Node.EventType.TOUCH_START, () => { dragged = false; }, this);
    node.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
      const a = e.getStartLocation(); const b = e.getLocation(); if (Math.hypot(a.x - b.x, a.y - b.y) > 10) dragged = true;
    }, this);
    node.on(Button.EventType.CLICK, () => { if (!dragged && this.ownerAvailable() && node.activeInHierarchy) action(); }, this);
  }
  private clearBindings(): void {
    this.revision++;
    this.ownerAvailable = () => false;
    for (const node of this.boundNodes) if (node.isValid) node.targetOff(this);
    this.boundNodes.clear();
  }
  protected onDisable(): void { this.clearBindings(); }
  protected onDestroy(): void { this.clearBindings(); }
}
