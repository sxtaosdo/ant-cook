import { _decorator, Button, Color, Component, EventTouch, Label, Node, Sprite, SpriteFrame, UITransform, view } from 'cc';
import mk from 'mk';
import { VirtualScrollView } from '../../../vendor/vscrollview/VScrollView';
import type { SocialCard, SocialPage, SocialProfile } from '../../presentation/social/socialPresentation';

type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

const { ccclass, property } = _decorator;

@ccclass('ColonySocialView')
/** Serialized popup content; owns only short-lived rendering state. */
export class ColonySocialView extends Component {
  @property(VirtualScrollView)
  public list: VirtualScrollView | null = null;
  private revision = 0;
  private pageKey = '';
  private readonly boundNodes = new Set<Node>();

  public hide(): void { this.node.active = false; this.revision++; }
  public render(page: DeepReadonly<SocialPage>, title: string, summary: string, feedback: string, action: (value: string) => void, close: () => void): void {
    this.node.active = true;
    const revision = ++this.revision;
    const height = Math.min(1200, view.getVisibleSize().height - 120); const top = height / 2;
    this.node.parent!.getComponent(UITransform)!.setContentSize(698, height);
    const place = (name: string, y: number): Node => { const node = this.node.getChildByName(name)!; node.setPosition(node.position.x, y, 0); return node; };
    this.label(place('Title', top - 115), title);
    this.label(place('Summary', top - (page.tab === 'profile' ? 215 : 285)), summary);
    this.label(place('Footer', -top + 90), feedback || page.footer);
    this.bind(place('Close', top - 115), true, close);
    const back = place('Back', top - 115); back.active = page.tab === 'profile' || page.tab === 'messages';
    this.bind(back, true, () => action('back'));
    const tabs = place('Tabs', top - 210); tabs.active = !back.active;
    for (const [name, tab] of [['Partners', 'partners'], ['History', 'history'], ['Help', 'help']] as const) {
      const button = tabs.getChildByName(name)!;
      button.getComponent(Sprite)!.color = new Color(page.tab === tab ? '#FFE2A7' : '#FFF9EB');
      this.bind(button, true, () => action(`tab:${tab}`));
    }
    const profile = place('Profile', top - 470); profile.active = page.tab === 'profile' && Boolean(page.profile);
    const list = this.list!;
    list.node.active = !profile.active;
    list.node.setPosition(0, top - 350, 0);
    list.node.getComponent(UITransform)!.setContentSize(590, height - 530);
    if (profile.active) this.profile(profile, page.profile!, revision, action);
    else {
      list.renderItemFn = (node, index) => this.card(node, page.cards[index]!, action);
      list.refreshList(page.cards.length);
      const key = page.tab;
      if (this.pageKey !== key) list.scrollToTop(false);
      this.pageKey = key;
    }
  }
  private card(node: Node, card: DeepReadonly<SocialCard>, action: (value: string) => void): void {
    this.label(node.getChildByName('Title')!, card.title);
    this.label(node.getChildByName('Detail')!, card.detail);
    this.label(node.getChildByName('Badge')!, card.badge);
    const avatar = node.getChildByName('Avatar')!;
    avatar.getComponent(Sprite)!.color = new Color(card.avatarColor);
    this.label(avatar.getChildByName('Initial')!, [...card.name][0] ?? '伙');
    const button = node.getChildByName('Action')!;
    this.label(button.getChildByName('Text')!, card.button);
    this.bind(button, card.enabled, () => action(card.action));
  }
  private profile(root: Node, profile: DeepReadonly<SocialProfile>, revision: number, action: (value: string) => void): void {
    const owner = this.node;
    const street = root.getChildByName('Street')!;
    const theme = profile.theme;
    const avatar = root.getChildByName('Avatar')!;
    avatar.getComponent(Sprite)!.color = new Color(profile.avatarColor);
    this.label(avatar.getChildByName('Initial')!, [...profile.partner.name][0]!);
    const stall = theme.items.find(item => item.kind === 'stall')!;
    this.label(root.getChildByName('ThemeName')!, `${theme.name} · ${theme.cleared}/12 件`);
    const empty = street.getChildByName('Empty')!; empty.active = stall.count === 0;
    this.label(empty, theme.items.some(item => item.count > 0) ? '伙伴已收集水果\n收集摊位后会自动摆上' : '伙伴还在收集第一件物品');
    for (const [index, item] of theme.items.entries()) {
      const names = item.kind === 'produce' ? [`Produce${index - 1}a`, `Produce${index - 1}b`]
        : [item.kind === 'stall' ? 'Stall' : item.id.endsWith('-lantern') ? 'Lantern' : item.id.endsWith('-sign') ? 'Sign' : 'Planter'];
      const nodes = names.map(name => street.getChildByName(name)!);
      nodes.forEach((node, n) => { node.active = (item.kind === 'stall' || stall.count > 0) && item.count > n; });
      if (!nodes.some(n => n.active)) continue;
      const path = item.kind === 'stall' ? item.boardPath : item.iconPath;
      nodes.forEach(node => { node.getComponent(Sprite)!.spriteFrame = null; });
      void mk.asset.get(`db://${path}`, SpriteFrame, owner).then(frame => {
        if (frame && revision === this.revision && this.isValid && owner.isValid && owner.activeInHierarchy) nodes.filter(node => node.isValid).forEach(node => { node.getComponent(Sprite)!.spriteFrame = frame; });
      }).catch(() => {
        if (revision === this.revision && this.isValid && owner.isValid && owner.activeInHierarchy && empty.isValid) this.label(empty, `图片加载未完成：${item.name}`);
      });
    }
    for (const [name, text, enabled, value] of [
      ['Previous', '上一主题', profile.previous, `theme:${theme.themeIndex - 1}`],
      ['Next', '下一主题', profile.next, `theme:${theme.themeIndex + 1}`],
      ['Follow', profile.partner.followed ? '取消关注' : '关注常客', profile.canFollow, 'follow'],
      ['Like', profile.liked ? '今日已赞' : '点赞', profile.canInteract && !profile.liked, 'like'],
      ['Message', profile.commented ? '今日已留言' : '留句话', profile.canInteract && !profile.commented, 'messages'],
      ['Request', '求助补给券', profile.canRequest, 'request'],
    ] as const) {
      const button = root.getChildByName(name)!; this.label(button.getChildByName('Text')!, text);
      this.bind(button, enabled, () => action(value));
    }
  }
  private label(node: Node, value: string): void { node.getComponent(Label)!.string = value; }
  private bind(node: Node, enabled: boolean, action: () => void): void {
    this.boundNodes.add(node);
    node.targetOff(this); const button = node.getComponent(Button)!; button.interactable = enabled;
    let dragged = false;
    node.on(Node.EventType.TOUCH_START, () => { dragged = false; }, this);
    node.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
      const a = e.getStartLocation(); const b = e.getLocation(); if (Math.hypot(a.x - b.x, a.y - b.y) > 10) dragged = true;
    }, this);
    node.on(Button.EventType.CLICK, () => { if (!dragged) action(); }, this);
  }
  private clearBindings(): void {
    this.revision++;
    for (const node of this.boundNodes) if (node.isValid) node.targetOff(this);
    this.boundNodes.clear();
  }
  protected onDisable(): void { this.clearBindings(); }
  protected onDestroy(): void { this.clearBindings(); }
}
