import { _decorator, Color, EditBox, Label, Node, Sprite, SpriteFrame, UITransform, tween, Tween, Vec3 } from 'cc';
import { ColonyPopupView } from './popupView';
import mk from 'mk';
import { type ProgressRow } from './progressModel';
import { VirtualScrollView } from '../../../vendor/vscrollview/VScrollView';

const { ccclass, property } = _decorator;

@ccclass('ColonyProgressView')
export class ColonyProgressView extends ColonyPopupView {
  private primaryActionFrame: SpriteFrame | null = null;
  private selectedTabFrame: SpriteFrame | null = null;
  private normalTabFrame: SpriteFrame | null = null;
  private listTitle = '';
  private readonly renderedRows = new WeakMap<Node, ProgressRow>();

  @property(Node)
  public panel: Node | null = null;

  @property(VirtualScrollView)
  public list: VirtualScrollView | null = null;
  @property(VirtualScrollView) public shopList: VirtualScrollView | null = null;

  protected prepareOpen(): void {
    this.listTitle = '';
  }

  public render(): void {
    const panel = this.panel;
    if (!panel) throw new Error('Progress panel binding is missing');
    const secondaryAction = panel.getChildByName('Row1')!.getChildByName('Action')!.getComponent(Sprite)!;
    this.primaryActionFrame ??= secondaryAction.spriteFrame;
    const { page, feedback } = this._model;
    const list = page.layout === 'shop' ? this.shopList : this.list;
    if (!list) throw new Error('Progress list binding is missing');
    this.shopList!.node.active = page.layout === 'shop';
    this.list!.node.active = page.layout !== 'shop';
    const selector = panel.getChildByName('GmLevelSelector');
    if (selector) selector.active = page.layout === 'gm';
    for (const name of ['Title', 'Summary', 'Close', 'Back']) panel.getChildByName(name)!.active = true;
    secondaryAction.spriteFrame = this.primaryActionFrame;
    const hasSummary = Boolean(page.summary);
    const hasTabs = Boolean(page.activeTab);
    const height = (hasSummary ? 410 : 350) + 640 + (hasTabs ? 110 : 0);
    panel.getComponent(UITransform)!.setContentSize(698, height);
    const place = (name: string, x: number, y: number): void => {
      panel.getChildByName(name)!.setPosition(x, y, 0);
    };
    place('Title', 0, height / 2 - 145);
    place('Summary', 0, height / 2 - (hasTabs ? 295 : 215));
    place('Close', 230, height / 2 - 130);
    place('Back', -230, height / 2 - 130);
    panel.getChildByName('Back')!.active = page.showBack !== false;
    const tabs = panel.getChildByName('Tabs')!;
    tabs.active = hasTabs;
    if (hasTabs) {
      tabs.setPosition(0, height / 2 - 220, 0);
      this.selectedTabFrame ??= tabs.getChildByName('TabMarket')!.getComponent(Sprite)!.spriteFrame;
      this.normalTabFrame ??= tabs.getChildByName('TabThemes')!.getComponent(Sprite)!.spriteFrame;
      for (const [name, section, label] of [['TabMarket', 'themes', '收集'], ['TabThemes', 'task-achievements', '成就'], ['TabDaily', 'daily', '每日']] as const) {
        const tab = tabs.getChildByName(name)!;
        const selected = page.activeTab === section;
        tab.setPosition(section === 'themes' ? -170 : section === 'daily' ? 170 : 0, 0, 0);
        tab.getComponent(UITransform)!.setContentSize(156, 56);
        tab.getComponent(Sprite)!.spriteFrame = selected ? this.selectedTabFrame : this.normalTabFrame;
        const text = tab.getChildByName('Text')!;
        text.getComponent(UITransform)!.setContentSize(140, 44);
        const heading = text.getComponent(Label)!;
        heading.string = label;
        heading.fontSize = 25;
        heading.isBold = selected;
        heading.color = selected ? new Color(71, 44, 60) : new Color(116, 99, 83);
        this.bind(tab, true, () => this.event.emit('action', `section:${section}`));
      }
    }
    place('Feedback', 0, -height / 2 + 130);
    panel.getChildByName('Feedback')!.active = Boolean(feedback);
    panel.getChildByName('Title')!.getComponent(Label)!.string = page.title;
    const summary = panel.getChildByName('Summary')!;
    summary.active = hasSummary;
    summary.getComponent(Label)!.string = page.summary;
    panel.getChildByName('Feedback')!.getComponent(Label)!.string = feedback;
    for (const name of ['Row0', 'Row1']) panel.getChildByName(name)!.active = false;
    const template = panel.getChildByName('Row0')!;
    const shop = page.layout === 'shop';
    const listTemplate = shop ? panel.getChildByName('ShopCard')! : template;
    list.node.getComponent(UITransform)!.setContentSize(shop ? 590 : 560, page.layout === 'gm' ? 540 : 640);
    if (page.rows[0]) {
      if (shop) this.renderShopRow(listTemplate, page.rows[0]);
      else this.renderRow(template, page.rows[0]);
    }
    list.node.setPosition(0, height / 2 - (hasSummary ? hasTabs ? 350 : 270 : hasTabs ? 290 : 210), 0);
    if (selector?.active) {
      selector.setPosition(0, height / 2 - 295, 0);
      list.node.setPosition(0, height / 2 - 355, 0);
    }
    list.renderItemFn = (card, index) => shop ? this.renderShopRow(card, this._model.page.rows[index]!) : this.renderRow(card, this._model.page.rows[index]!);
    list.refreshList(page.rows.length);
    if (this.listTitle !== page.title) list.scrollToTop(false);
    this.listTitle = page.title;
    this.bind(panel.getChildByName('Close')!, true, () => this.event.emit('close'));
    this.bind(panel.getChildByName('Back')!, true, () => this.event.emit('action', 'back'));
  }

  private renderRow(card: Node, row: ProgressRow): void {
    const revision = this.revision;
    this.renderedRows.set(card, row);
    card.getComponent(UITransform)!.setContentSize(500, 224);
    card.getComponent(Sprite)!.enabled = true;
    const title = card.getChildByName('Title')!;
    const detail = card.getChildByName('Detail')!;
    title.active = true;
    detail.active = true;
    const hasIcon = Boolean(row.itemId) || row.stage !== undefined;
    title.setPosition(hasIcon ? -35 : -85, 70, 0);
    detail.setPosition(hasIcon ? -35 : -85, -8, 0);
    title.getComponent(UITransform)!.setContentSize(hasIcon ? 230 : 280, 34);
    detail.getComponent(UITransform)!.setContentSize(hasIcon ? 230 : 280, 112);
    title.getComponent(Label)!.fontSize = 26;
    title.getComponent(Label)!.horizontalAlign = Label.HorizontalAlign.LEFT;
    detail.getComponent(Label)!.fontSize = 20;
    detail.getComponent(Label)!.lineHeight = 26;
    detail.getComponent(Label)!.horizontalAlign = Label.HorizontalAlign.LEFT;
    title.getComponent(Label)!.string = row.title;
    detail.getComponent(Label)!.string = row.detail;
    const basket = card.getChildByName('Basket');
    if (basket) basket.active = false;
    const produceItems = row.basketItems?.filter(item => item.kind === 'produce');
    for (let i = 0; i < 4; i += 1) {
      const icon = card.getChildByName(`Produce${i}`);
      if (!icon) continue;
      const item = produceItems?.[i];
      icon.active = Boolean(item);
      if (!item) continue;
      const sprite = icon.getComponent(Sprite)!;
      sprite.spriteFrame = null;
      sprite.grayscale = item.count === 0;
      icon.getChildByName('Count')!.getComponent(Label)!.string = `${item.count}/${item.target}`;
      void mk.asset.get(`db://${item.iconPath}`, SpriteFrame, this.node)
        .then(frame => { if (revision === this.revision && this.isAvailable() && frame && icon.isValid && this.renderedRows.get(card) === row) sprite.spriteFrame = frame; })
        .catch(cause => { if (revision === this.revision && this.isAvailable()) console.error('Failed to load basket icon', cause); });
    }
    if (row.basketItems) {
      title.setPosition(-100, 86, 0);
      detail.setPosition(-100, 49, 0);
      title.getComponent(UITransform)!.setContentSize(230, 34);
      detail.getComponent(UITransform)!.setContentSize(230, 64);
    }
    const produce = card.getChildByName('ProduceIcon');
    if (produce) {
      produce.setPosition(-205, row.basketItems ? 53 : -15, 0);
      produce.active = Boolean(row.itemId);
      produce.getComponent(Sprite)!.grayscale = row.count === 0;
      if (row.itemId) {
        const iconPath = row.iconPath;
        produce.getComponent(Sprite)!.spriteFrame = null;
        void mk.asset.get(`db://${iconPath}`, SpriteFrame, this.node)
          .then((frame) => {
            if (revision === this.revision && this.isAvailable() && frame && produce.isValid && this.renderedRows.get(card) === row) {
              produce.getComponent(Sprite)!.spriteFrame = frame;
            }
          }).catch(cause => { if (revision === this.revision && this.isAvailable()) console.error('Failed to load collection icon', cause); });
      }
    }
    const emblem = card.getChildByName('Emblem')!;
    const lantern = emblem.getChildByName('Lantern');
    if (lantern) {
      Tween.stopAllByTarget(lantern);
      lantern.active = false;
      lantern.setRotationFromEuler(0, 0, 0);
    }
    emblem.setPosition(-205, 0, 0);
    emblem.active = row.stage !== undefined;
    if (row.stage !== undefined) {
      const colors = [new Color(92, 91, 107), new Color(147, 111, 81), new Color(227, 174, 99), new Color(255, 225, 120)];
      emblem.getComponent(Sprite)!.color = colors[row.stage] ?? colors[0];
      emblem.getChildByName('Stage')!.getComponent(Label)!.string = ['待清理', '已清理', '已修复', '已点亮'][row.stage] ?? '';
      if (row.decoration && row.decoration !== 'base') {
        emblem.getComponent(Sprite)!.color = row.decoration === 'season' ? new Color(100, 236, 234) : new Color(255, 163, 104);
        emblem.getChildByName('Stage')!.getComponent(Label)!.string = row.decoration === 'season' ? '季节灯饰' : '暖色灯笼';
      }
      if (lantern) {
        const decorated = Boolean(row.decoration && row.decoration !== 'base');
        lantern.active = decorated;
        if (decorated) {
          lantern.setRotationFromEuler(0, 0, -5);
          tween(lantern).repeatForever(
            tween().to(0.75, { eulerAngles: new Vec3(0, 0, 5) }).to(0.75, { eulerAngles: new Vec3(0, 0, -5) }),
          ).start();
        }
      }
    }
    const button = card.getChildByName('Action')!;
    button.active = Boolean(row.button);
    button.getComponent(Sprite)!.spriteFrame = this.primaryActionFrame;
    button.setPosition(170, row.basketItems ? 76 : 0, 0);
    button.getComponent(UITransform)!.setContentSize(128, 56);
    button.getChildByName('Text')!.getComponent(UITransform)!.setContentSize(112, 46);
    this.bind(button, row.enabled, () => {
      const action = row.action === 'gm:level' ? `${row.action}:${this.panel!.getChildByName('GmLevelSelector')!.getComponent(EditBox)!.string}` : row.action;
      this.event.emit('action', action);
    });
    button.getChildByName('Text')!.getComponent(Label)!.string = row.button;
  }
  private renderShopRow(card: Node, row: ProgressRow): void {
    const revision = this.revision;
    this.renderedRows.set(card, row);
    const product = row.shopProduct!;
    card.getComponent(UITransform)!.setContentSize(550, 224);
    card.getChildByName('Quantity')!.getComponent(Label)!.string = `${product.diamonds} 钻石`;
    card.getChildByName('Name')!.getComponent(Label)!.string = product.priceYuan === undefined ? '新老玩家体验礼包' : '钻石补给';
    card.getChildByName('Status')!.getComponent(Label)!.string = product.priceYuan === undefined ? product.claimed ? '已领取' : '一次性免费领取' : '充值暂未开放';
    const image = card.getChildByName('Product')!.getComponent(Sprite)!;
    image.spriteFrame = null;
    void mk.asset.get(`db://assets/Colony/art/toy-market/ui/r07/${product.image}.png`, SpriteFrame, this.node)
      .then(frame => { if (revision === this.revision && this.isAvailable() && frame && image.isValid && this.renderedRows.get(card) === row) image.spriteFrame = frame; })
      .catch(cause => { if (revision === this.revision && this.isAvailable()) console.error('Failed to load shop icon', cause); });
    const action = card.getChildByName('Action')!;
    action.getChildByName('Text')!.getComponent(Label)!.string = row.button;
    action.getComponent(Sprite)!.color = new Color(product.priceYuan === undefined && !product.claimed ? '#FFFFFF' : '#CBD2DE');
    this.bind(action, row.enabled, () => this.event.emit('action', row.action));
  }

}
