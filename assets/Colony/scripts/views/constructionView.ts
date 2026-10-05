import { _decorator, Button, Color, Label, Node, Sprite, SpriteFrame, UITransform, view } from 'cc';
import mk from 'mk';
import type { ConstructionItem, ConstructionModel } from '../presentation/constructionPresentation';

const { ccclass } = _decorator;

@ccclass('ColonyConstructionView')
/** 展示主题收集成果；关卡和长期进度由页面状态持有。 */
export class ColonyConstructionView extends mk.StaticViewBase {
  private onAction: ((action: string) => void) | null = null;
  private revision = 0;

  public bind(onAction: (action: string) => void): void { this.onAction = onAction; }
  public setVisible(visible: boolean): void { this.node.active = visible; if (!visible) this.revision += 1; }
  public refreshSocialNotice(unread: number): void { this.child('Header').getChildByName('Social')!.getChildByName('Notice')!.active = unread > 0; }

  public render(model: ConstructionModel): void {
    const revision = ++this.revision;
    const height = view.getVisibleSize().height;
    this.node.getComponent(UITransform)!.setContentSize(750, height);
    const top = height / 2;
    this.child('Header').setPosition(0, top - 100, 0);
    this.child('Street').setPosition(0, top - (model.themeIndex === 0 ? 600 : 440), 0);
    this.child('Selection').setPosition(0, -top + 330, 0);
    this.child('Navigation').setPosition(0, -top + 70, 0);
    const header = this.child('Header');
    this.text(header, 'Title', model.title);
    this.text(header, 'Stars', `已收集 ${model.items.reduce((sum, item) => sum + item.count, 0)}/12 件`);
    this.button(header.getChildByName('Home')!, 'home', true);
    const social = header.getChildByName('Social')!; social.active = model.socialAvailable;
    this.button(social, 'social', model.socialAvailable); this.refreshSocialNotice(model.socialUnread);
    const display = this.child('Street');
    const tropical = display.getChildByName('TropicalFruit')!;
    tropical.active = model.themeIndex === 0;
    if (tropical.active) display.children.forEach(node => { if (node !== tropical && node.name !== 'Empty') node.active = false; });
    display.getChildByName('Empty')!.active = !model.stallCollected;
    this.text(display, 'Empty', model.themeIndex === 0 ? '开摊位置\n第2关收集摊位，摆上已取得的芒果' : model.unlocked ? '收集摊位，开始你的夜市\n第1件：空摊位' : '集齐前一主题后，来这里开摊');
    const selection = this.child('Selection');
    this.text(selection, 'Detail', model.detail);
    this.text(selection, 'Feedback', model.feedback);
    this.text(selection.getChildByName('Primary')!, 'Text', model.primary.label);
    this.button(selection.getChildByName('Primary')!, model.primary.action, model.primary.enabled);
    for (const item of model.items) {
      const card = selection.getChildByName(`Item${item.index}`)!;
      this.text(card, 'Name', item.name);
      this.text(card, 'Count', `${item.count}/${item.target}`);
      card.getComponent(Sprite)!.color = item.selected ? new Color(255, 224, 153) : new Color(255, 255, 255);
      this.button(card, `select:${item.index}`, true);
      void this.projectItem(item, model.stallCollected, revision, card, tropical.active ? tropical : display);
    }
    const navigation = this.child('Navigation');
    for (const [name, action] of [['Previous', model.previous], ['Next', model.next]] as const) {
      const node = navigation.getChildByName(name)!;
      this.text(node, 'Text', action.label);
      this.button(node, action.action, action.enabled);
    }
  }

  private async projectItem(item: ConstructionItem, stallCollected: boolean, revision: number, card: Node, display: Node): Promise<void> {
    const names = item.kind === 'produce' ? [`Produce${item.index - 1}a`, `Produce${item.index - 1}b`]
      : [item.kind === 'stall' ? 'Stall' : item.id.endsWith('-lantern') ? 'Lantern' : item.id.endsWith('-sign') ? 'Sign' : 'Planter'];
    const nodes = names.map(name => display.getChildByName(name)!);
    nodes.forEach((node, index) => { node.active = (item.kind === 'stall' || stallCollected) && item.count > index; });
    const icon = card.getChildByName('Icon')!.getComponent(Sprite)!;
    icon.grayscale = item.count === 0;
    try {
      const frame = await mk.asset.get(`db://${item.iconPath}`, SpriteFrame, this.node);
      if (revision !== this.revision || !this.node.isValid || !frame) return;
      icon.spriteFrame = frame;
      const displayFrame = item.kind === 'stall' ? await mk.asset.get(`db://${item.boardPath}`, SpriteFrame, this.node) : frame;
      if (revision !== this.revision || !this.node.isValid || !displayFrame) return;
      nodes.forEach(node => { node.getComponent(Sprite)!.spriteFrame = displayFrame; });
    } catch (cause) {
      if (revision === this.revision && this.node.isValid) this.text(this.child('Selection'), 'Feedback', `图片加载未完成：${item.name}`);
      console.error('Failed to load collected stall item', cause);
    }
  }

  private button(node: Node, action: string, enabled: boolean): void {
    node.targetOff(this);
    node.getComponent(Button)!.interactable = enabled;
    node.on(Button.EventType.CLICK, () => this.onAction?.(action), this);
  }
  private text(node: Node, name: string, value: string): void { node.getChildByName(name)!.getComponent(Label)!.string = value; }
  private child(name: string): Node { return this.node.getChildByName(name)!; }
}
