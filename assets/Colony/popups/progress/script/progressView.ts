import { _decorator, Button, Color, EditBox, EventTouch, Label, Node, Sprite, SpriteFrame, UITransform, tween, Tween, Vec3, view } from 'cc';
import mk from 'mk';
import { ProgressModel, type ProgressRow } from './progressModel';
import { VirtualScrollView } from '../../../vendor/vscrollview/VScrollView';
import type { LeaderboardEntry } from '../../../scripts/application/leaderboard/leaderboard';
import { ColonySocialView } from '../../../scripts/views/social/socialView';

const { ccclass, property } = _decorator;

@ccclass('ColonyProgressView')
export class ColonyProgressView extends mk.MVCViewBase<ProgressModel> {
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
  @property(VirtualScrollView)
  public leaderboardList: VirtualScrollView | null = null;
  @property(Node)
  public leaderboardSelf: Node | null = null;
  @property(ColonySocialView)
  public socialView: ColonySocialView | null = null;
  @property(Node) public settingsRoot: Node | null = null;
  @property(SpriteFrame) public musicOnFrame: SpriteFrame | null = null;
  @property(SpriteFrame) public musicOffFrame: SpriteFrame | null = null;
  @property(SpriteFrame) public soundOnFrame: SpriteFrame | null = null;
  @property(SpriteFrame) public soundOffFrame: SpriteFrame | null = null;

  public init(model?: ProgressModel): void {
    if (!model) throw new Error('Progress popup requires a model');
    this._model = model;
  }

  public open(): void {
    // MK may reuse this view; controllers belong to one opening only.
    this.event.off('action');
    this.event.off('close');
    this.listTitle = '';
    this.render();
  }
  public isAvailable(): boolean { return this.node.isValid && this.node.activeInHierarchy; }

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
    if (this.settingsRoot) this.settingsRoot.active = page.layout === 'settings';
    panel.getComponent(Sprite)!.enabled = page.layout !== 'settings';
    if (page.layout === 'settings') {
      this.renderSettings(panel);
      return;
    }
    if (page.layout === 'social') {
      for (const name of ['Title', 'Summary', 'Close', 'Back', 'Feedback', 'Tabs', 'Row0', 'Row1', 'LeaderboardHint']) panel.getChildByName(name)!.active = false;
      list.node.active = false; this.leaderboardList!.node.active = false; this.leaderboardSelf!.active = false;
      this.socialView!.render(page.social!, page.title, page.summary, feedback, value => this.event.emit('action', value), () => this.event.emit('close'));
      return;
    }
    this.socialView?.hide();
    for (const name of ['Title', 'Summary', 'Close', 'Back']) panel.getChildByName(name)!.active = true;
    if (page.layout === 'leaderboard') {
      this.renderLeaderboard(panel);
      return;
    }
    this.leaderboardList!.node.active = false;
    this.leaderboardSelf!.active = false;
    panel.getChildByName('LeaderboardHint')!.active = false;
    list.node.active = page.layout !== 'confirm';
    if (page.layout === 'confirm') {
      this.renderConfirm(panel);
      return;
    }
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

  private renderLeaderboard(panel: Node): void {
    const { page } = this._model;
    const board = page.leaderboard!;
    const list = this.leaderboardList!;
    this.list!.node.active = false;
    list.node.active = true;
    this.leaderboardSelf!.active = true;
    const height = Math.min(1200, view.getVisibleSize().height - 120);
    const top = height / 2;
    panel.getComponent(UITransform)!.setContentSize(698, height);
    for (const name of ['Tabs', 'Back', 'Feedback', 'Row0', 'Row1']) panel.getChildByName(name)!.active = false;
    const title = panel.getChildByName('Title')!;
    title.setPosition(0, top - 115, 0); title.getComponent(Label)!.string = page.title;
    const summary = panel.getChildByName('Summary')!;
    summary.active = true; summary.setPosition(0, top - 185, 0); summary.getComponent(Label)!.string = page.summary;
    const close = panel.getChildByName('Close')!;
    close.setPosition(230, top - 115, 0);
    this.bind(close, true, () => this.event.emit('close'));
    list.node.setPosition(0, top - 240, 0);
    list.node.getComponent(UITransform)!.setContentSize(590, height - 420);
    list.renderItemFn = (card, index) => this.renderLeaderboardRow(card, board.entries[index]!);
    list.refreshList(board.entries.length);
    list.scrollToTop(false);
    this.leaderboardSelf!.setPosition(0, -top + 122, 0);
    this.renderLeaderboardRow(this.leaderboardSelf!, board.self);
    const hint = panel.getChildByName('LeaderboardHint')!;
    hint.active = true; hint.setPosition(0, -top + 65, 0);
  }

  private renderSettings(panel: Node): void {
    const { settings } = this._model.page;
    const root = this.settingsRoot;
    if (!root || !settings) throw new Error('Settings popup binding is missing');
    panel.getComponent(UITransform)!.setContentSize(640, 980);
    for (const name of ['Title', 'Summary', 'Close', 'Back', 'Feedback', 'Tabs', 'Row0', 'Row1', 'LeaderboardHint']) panel.getChildByName(name)!.active = false;
    this.list!.node.active = false;
    this.leaderboardList!.node.active = false;
    this.leaderboardSelf!.active = false;
    this.socialView?.hide();
    const controls = [
      ['MusicButton', 'toggle-music', settings.musicEnabled ? this.musicOnFrame : this.musicOffFrame],
      ['SoundButton', 'toggle-sound', settings.soundEnabled ? this.soundOnFrame : this.soundOffFrame],
      ['HomeButton', 'section:confirm-home', null],
      ['RestartButton', 'section:confirm-restart', null],
    ] as const;
    controls.forEach(([name, action, frame], index) => {
      const button = root.getChildByName(name)!;
      button.active = index < 2 || settings.inRound;
      button.setPosition(settings.inRound ? -210 + index * 140 : -100 + index * 200, 225, 0);
      if (index < 2) button.getChildByName('Icon')!.getComponent(Sprite)!.spriteFrame = frame;
      this.bind(button, true, () => this.event.emit('action', action));
    });
    for (const [name, action] of [['FeedbackButton', 'settings-link:feedback'], ['AgreementButton', 'settings-link:agreement'], ['PrivacyButton', 'settings-link:privacy']] as const) {
      this.bind(root.getChildByName(name)!, true, () => this.event.emit('action', action));
    }
    this.bind(root.getChildByName('Close')!, true, () => this.event.emit('close'));
    this.bind(root.getChildByName('ProductNavigationButton')!, true, () => this.event.emit('action', 'product-navigation'));
    root.getChildByName('Version')!.getComponent(Label)!.string = settings.version;
    root.getChildByName('UserId')!.getComponent(Label)!.string = `ID: ${settings.userId}`;
    const gmButton = root.getChildByName('GmButton')!;
    gmButton.active = settings.gmAvailable;
    this.bind(gmButton, settings.gmAvailable, () => this.event.emit('action', 'section:gm'));
    const notice = root.getChildByName('Notice')!;
    notice.active = Boolean(this._model.feedback);
    notice.getComponent(Label)!.string = this._model.feedback;
  }

  private renderLeaderboardRow(card: Node, entry: LeaderboardEntry): void {
    card.getComponent(Sprite)!.color = new Color(entry.isSelf ? '#FFE2A7' : '#FFF9EB');
    const rank = card.getChildByName('Rank')!.getComponent(Label)!;
    rank.string = `${entry.rank}`;
    rank.color = new Color(entry.rank === 1 ? '#B77B17' : entry.rank === 2 ? '#7E8992' : entry.rank === 3 ? '#A76836' : '#654632');
    const avatar = card.getChildByName('Avatar')!;
    avatar.getComponent(Sprite)!.color = new Color(entry.avatarColor);
    avatar.getChildByName('Initial')!.getComponent(Label)!.string = [...entry.name][0]!;
    card.getChildByName('Name')!.getComponent(Label)!.string = entry.name;
    card.getChildByName('Progress')!.getComponent(Label)!.string = `${entry.cleared} 关`;
    const change = card.getChildByName('Change')!.getComponent(Label)!;
    change.string = entry.isNew ? '新上榜' : entry.change > 0 ? `↑ ${entry.change}` : entry.change < 0 ? `↓ ${-entry.change}` : '—';
    change.color = new Color(entry.isNew ? '#B77B17' : entry.change > 0 ? '#328D73' : entry.change < 0 ? '#B76C60' : '#A69985');
    for (const node of [avatar, card.getChildByName('Name')!]) this.bind(node, !entry.isSelf && Boolean(this._model.page.leaderboard?.canVisit), () => this.event.emit('action', `partner:${entry.id}`));
  }

  private renderRow(card: Node, row: ProgressRow): void {
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
        .then(frame => { if (frame && icon.isValid && this.renderedRows.get(card) === row) sprite.spriteFrame = frame; });
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
            if (frame && produce.isValid && this.renderedRows.get(card) === row) {
              produce.getComponent(Sprite)!.spriteFrame = frame;
            }
          });
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
    this.renderedRows.set(card, row);
    const product = row.shopProduct!;
    card.getComponent(UITransform)!.setContentSize(550, 224);
    card.getChildByName('Quantity')!.getComponent(Label)!.string = `${product.diamonds} 钻石`;
    card.getChildByName('Name')!.getComponent(Label)!.string = product.priceYuan === undefined ? '新老玩家体验礼包' : '钻石补给';
    card.getChildByName('Status')!.getComponent(Label)!.string = product.priceYuan === undefined ? product.claimed ? '已领取' : '一次性免费领取' : '充值暂未开放';
    const image = card.getChildByName('Product')!.getComponent(Sprite)!;
    image.spriteFrame = null;
    void mk.asset.get(`db://assets/Colony/art/toy-market/ui/r07/${product.image}.png`, SpriteFrame, this.node)
      .then(frame => { if (frame && image.isValid && this.renderedRows.get(card) === row) image.spriteFrame = frame; });
    const action = card.getChildByName('Action')!;
    action.getChildByName('Text')!.getComponent(Label)!.string = row.button;
    action.getComponent(Sprite)!.color = new Color(product.priceYuan === undefined && !product.claimed ? '#FFFFFF' : '#CBD2DE');
    this.bind(action, row.enabled, () => this.event.emit('action', row.action));
  }

  private renderConfirm(panel: Node): void {
    const { page, feedback } = this._model;
    panel.getComponent(UITransform)!.setContentSize(620, 560);
    panel.getChildByName('Tabs')!.active = false;
    const title = panel.getChildByName('Title')!;
    title.setPosition(0, 125, 0);
    title.getComponent(Label)!.string = page.title;
    panel.getChildByName('Summary')!.active = false;
    panel.getChildByName('Back')!.active = false;
    const close = panel.getChildByName('Close')!;
    close.setPosition(225, 205, 0);
    this.bind(close, true, () => this.event.emit('close'));
    const notice = panel.getChildByName('Feedback')!;
    notice.active = Boolean(feedback);
    notice.setPosition(0, -85, 0);
    notice.getComponent(Label)!.string = feedback;
    for (let index = 0; index < 2; index += 1) {
      const card = panel.getChildByName(`Row${index}`)!;
      const row = page.rows[index];
      card.active = index < 2 && Boolean(row);
      if (!card.active || !row) continue;
      card.setPosition(0, 0, 0);
      card.getComponent(Sprite)!.enabled = false;
      card.getChildByName('Emblem')!.active = false;
      card.getChildByName('ProduceIcon')!.active = false;
      for (const name of ['Basket', 'Produce0', 'Produce1', 'Produce2', 'Produce3']) {
        const child = card.getChildByName(name);
        if (child) child.active = false;
      }
      const lantern = card.getChildByName('Emblem')!.getChildByName('Lantern');
      if (lantern) Tween.stopAllByTarget(lantern);
      const heading = card.getChildByName('Title')!;
      const detail = card.getChildByName('Detail')!;
      heading.active = index === 0;
      detail.active = index === 0;
      if (index === 0) {
        heading.setPosition(0, 35, 0);
        heading.getComponent(UITransform)!.setContentSize(480, 42);
        heading.getComponent(Label)!.fontSize = 27;
        heading.getComponent(Label)!.horizontalAlign = Label.HorizontalAlign.CENTER;
        heading.getComponent(Label)!.string = row.title;
        detail.setPosition(0, -25, 0);
        detail.getComponent(UITransform)!.setContentSize(480, 80);
        detail.getComponent(Label)!.fontSize = 22;
        detail.getComponent(Label)!.lineHeight = 28;
        detail.getComponent(Label)!.horizontalAlign = Label.HorizontalAlign.CENTER;
        detail.getComponent(Label)!.string = row.detail;
      }
      const button = card.getChildByName('Action')!;
      button.active = true;
      button.setPosition(index === 0 ? -115 : 115, -165, 0);
      button.getComponent(UITransform)!.setContentSize(190, 70);
      button.getChildByName('Text')!.getComponent(UITransform)!.setContentSize(180, 60);
      button.getChildByName('Text')!.getComponent(Label)!.string = row.button;
      if (index === 1) {
        void mk.asset.get('db://assets/Colony/art/toy-market/ui/button-secondary.png', SpriteFrame, this.node)
          .then(frame => {
            if (frame && button.isValid && this._model.page.layout === 'confirm') button.getComponent(Sprite)!.spriteFrame = frame;
          });
      }
      this.bind(button, row.enabled, () => this.event.emit('action', row.action));
    }
  }

  private bind(node: Node, enabled: boolean, action: () => void): void {
    node.targetOff(this);
    const button = node.getComponent(Button)!;
    button.disabledColor = new Color(224, 203, 171);
    button.interactable = enabled;
    let dragged = false;
    node.on(Node.EventType.TOUCH_START, () => { dragged = false; }, this);
    node.on(Node.EventType.TOUCH_MOVE, (event: EventTouch) => {
      const start = event.getStartLocation();
      const current = event.getLocation();
      if (Math.hypot(current.x - start.x, current.y - start.y) > 10) dragged = true;
    }, this);
    node.on(Button.EventType.CLICK, () => { if (!dragged) action(); }, this);
  }
}
