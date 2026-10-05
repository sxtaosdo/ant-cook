import { _decorator, Button, Label, Sprite, SpriteFrame, UITransform, Widget } from 'cc';
import mk from 'mk';
import { ResultSuccessModel } from './resultSuccessModel';

const { ccclass, property } = _decorator;

@ccclass('ColonyResultSuccessView')
/** 胜利结算 View：展示关卡与运送数，发出 primary/home。 */
export class ColonyResultSuccessView extends mk.MVCViewBase<ResultSuccessModel> {
  public isAvailable(): boolean { return this.node.isValid && this.node.activeInHierarchy; }
  @property(Label)
  private titleLabel: Label | null = null;

  @property(Label)
  private detailLabel: Label | null = null;

  @property(Button)
  private primaryButton: Button | null = null;

  @property(Label)
  private primaryLabel: Label | null = null;

  @property(Button)
  private homeButton: Button | null = null;

  /** MK 打开时注入 Model。 */
  public init(data?: ResultSuccessModel): void {
    if (!data) throw new Error('Result success view requires a model');
    this._model = data;
  }

  /** 填充文案并绑定按钮事件。 */
  public open(): void {
    this.event.off('primary');
    this.event.off('home');
    this.event.off('ad');
    if (!this.titleLabel || !this.detailLabel || !this.primaryButton || !this.primaryLabel || !this.homeButton) {
      throw new Error('Result Prefab is missing required editor bindings');
    }
    this.titleLabel.string = this._model.daily ? '每日挑战完成' : `第 ${this._model.level} 关收集完成`;
    this.refreshReward();
    const collection = this.node.getChildByName('ResultPanel')!.getChildByName('Collection')!;
    collection.active = Boolean(this._model.collection);
    this.node.getChildByName('ResultPanel')!.getComponent(UITransform)!.setContentSize(560, collection.active ? 660 : 512);
    const titleWidget = this.titleLabel.node.getComponent(Widget)!;
    titleWidget.verticalCenter = collection.active ? 220 : 150;
    titleWidget.updateAlignment();
    this.node.getChildByName('ResultPanel')!.getChildByName('ResultBadge')!.setPosition(0, collection.active ? 310 : 240, 0);
    const detailWidget = this.detailLabel.node.getComponent(Widget)!;
    detailWidget.verticalCenter = collection.active ? 15 : 55;
    detailWidget.updateAlignment();
    this.detailLabel.node.getComponent(UITransform)!.setContentSize(520, collection.active ? 70 : 100);
    if (this._model.collection) {
      const item = this._model.collection;
      collection.getChildByName('Name')!.getComponent(Label)!.string = `${item.name} ${item.count}/${item.target}`;
      collection.getChildByName('Progress')!.getComponent(Label)!.string = `热带水果摊 ${item.collected}/12`;
      void this.showCollectionIcon(item.iconPath, collection.getChildByName('Icon')!.getComponent(Sprite)!);
    }
    this.primaryLabel.string = this._model.daily ? '再挑战' : this._model.firstBuild ? '查看摊位' : this._model.hasNextLevel ? '下一关' : '查看摊位';
    this.homeButton.node.active = this._model.daily || this._model.firstBuild || this._model.hasNextLevel;
    const homeLabel = this.homeButton.node.getComponentInChildren(Label);
    if (homeLabel) homeLabel.string = this._model.daily || this._model.firstBuild ? '回首页' : '查看摊位';
    this.primaryButton.node.targetOff(this);
    this.homeButton.node.targetOff(this);
    this.primaryButton.node.on(Button.EventType.CLICK, () => this.event.emit('primary'), this);
    this.homeButton.node.on(Button.EventType.CLICK, () => this.event.emit('home'), this);
    const ad = this.node.getChildByName('ResultPanel')?.getChildByName('RewardAd');
    ad?.targetOff(this);
    ad?.on(Button.EventType.CLICK, () => this.event.emit('ad'), this);
  }

  public refreshReward(): void {
    if (this.detailLabel) this.detailLabel.string = `已搬运 ${this._model.transported} 块物品\n${this._model.rewardText}${!this._model.daily && !this._model.hasNextLevel ? '\n本期收集完成' : ''}`;
    const ad = this.node.getChildByName('ResultPanel')?.getChildByName('RewardAd');
    if (ad) {
      ad.active = this._model.adAvailable;
      ad.getComponent(Button)!.interactable = this._model.adAvailable;
      const text = ad.getChildByName('Text')?.getComponent(Label);
      if (text) text.string = this._model.adAvailable ? '自愿看视频 · 再得40金币' : '视频加金币 · 暂不可用';
    }
  }

  private async showCollectionIcon(path: string, icon: Sprite): Promise<void> {
    icon.spriteFrame = null;
    try {
      const frame = await mk.asset.get(`db://${path}`, SpriteFrame, this.node);
      if (this.isAvailable() && this._model.collection?.iconPath === path && frame) icon.spriteFrame = frame;
    } catch (cause) { console.error('Failed to load collected result icon', cause); }
  }

  protected onDestroy(): void {
    this.primaryButton?.node.targetOff(this);
    this.homeButton?.node.targetOff(this);
  }
}
