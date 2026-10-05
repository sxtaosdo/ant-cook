import { _decorator, Button, Label } from 'cc';
import mk from 'mk';
import { ResultFailModel } from './resultFailModel';

const { ccclass, property } = _decorator;

@ccclass('ColonyResultFailView')
/** 失败结算 View：展示受阻文案，发出 primary/home。 */
export class ColonyResultFailView extends mk.MVCViewBase<ResultFailModel> {
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
  public init(data?: ResultFailModel): void {
    if (!data) throw new Error('Result fail view requires a model');
    this._model = data;
  }

  /** 填充文案并绑定按钮事件。 */
  public open(): void {
    if (!this.titleLabel || !this.detailLabel || !this.primaryButton || !this.primaryLabel || !this.homeButton) {
      throw new Error('Result Prefab is missing required editor bindings');
    }
    this.titleLabel.string = '补给路线受阻';
    this.detailLabel.string = '所有暂存槽都已占用，\n当前没有可移动的颜色。';
    this.primaryLabel.string = '免费重试';
    this.homeButton.node.getChildByName('HomeButtonText')!.getComponent(Label)!.string = '回夜市';
    this.primaryButton.node.targetOff(this);
    this.homeButton.node.targetOff(this);
    this.primaryButton.node.on(Button.EventType.CLICK, () => this.event.emit('primary'), this);
    this.homeButton.node.on(Button.EventType.CLICK, () => this.event.emit('home'), this);
  }

  protected onDestroy(): void {
    this.primaryButton?.node.targetOff(this);
    this.homeButton?.node.targetOff(this);
  }
}
