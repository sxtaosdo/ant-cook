import { _decorator, Button, Label, Node } from 'cc';
import mk from 'mk';
import { ResultFailModel } from './resultFailModel';

const { ccclass, property } = _decorator;

@ccclass('ColonyResultFailView')
/** 失败结算 View：展示受阻文案，发出 primary/home。 */
export class ColonyResultFailView extends mk.MVCViewBase<ResultFailModel> {
  private readonly boundNodes = new Set<Node>();
  private viewRoot: Node | null = null;
  public isAvailable(): boolean { return this.valid && !!this.viewRoot?.isValid && this.viewRoot.activeInHierarchy; }
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
    this.clearBindings();
    this.viewRoot = this.node;
    if (!this.titleLabel || !this.detailLabel || !this.primaryButton || !this.primaryLabel || !this.homeButton) {
      throw new Error('Result Prefab is missing required editor bindings');
    }
    this.titleLabel.string = '补给路线受阻';
    this.detailLabel.string = this._model.failureMessage;
    this.primaryLabel.string = '免费重试';
    this.homeButton.node.getChildByName('HomeButtonText')!.getComponent(Label)!.string = '回夜市';
    this.bind(this.primaryButton.node, 'primary');
    this.bind(this.homeButton.node, 'home');
  }

  private bind(node: Node, event: string): void {
    this.boundNodes.add(node);
    node.targetOff(this);
    node.on(Button.EventType.CLICK, () => { if (this.isAvailable() && node.activeInHierarchy) this.event.emit(event); }, this);
  }
  private clearBindings(): void {
    this.viewRoot = null;
    for (const node of this.boundNodes) if (node.isValid) node.targetOff(this);
    this.boundNodes.clear();
  }
  public close(): void { this.clearBindings(); }
  protected onDisable(): void { this.clearBindings(); }
  protected onDestroy(): void { this.clearBindings(); }
}
