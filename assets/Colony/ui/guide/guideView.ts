import { _decorator, Button, Component, Label, Mask, Node, Vec3, view } from 'cc';
import { ColonyGuideStep } from './guideStep';
const { ccclass, property } = _decorator;
@ccclass('ColonyGuideView')
export class ColonyGuideView extends Component {
  @property(Label) public title: Label | null = null;
  @property(Label) public detail: Label | null = null;
  @property(Label) public feedback: Label | null = null;
  @property(Button) public next: Button | null = null;
  @property(Button) public skip: Button | null = null;
  @property(Mask) public shade: Mask | null = null;
  @property(Node) public anchor: Node | null = null;
  @property(Vec3) public maskOrigin = new Vec3();
  private stepList: ColonyGuideStep[] | null = null;
  public get steps(): ColonyGuideStep[] { return this.stepList ??= this.getComponentsInChildren(ColonyGuideStep).sort((a, b) => a.stepNum - b.stepNum); }
  public validate(): void {
    if (!this.title || !this.detail || !this.feedback || !this.next || !this.skip || !this.shade || !this.anchor || this.steps.length !== 4 || this.steps.some((s, i) => s.stepNum !== i || !s.polygon)) throw Error('引导原生绑定缺失');
  }
  public show(segment: number, text: string, body: string, target: Node, shape: number, canAdvance: boolean, advance: () => void, skip: () => void): void {
    this.validate(); this.stop();
    this.title!.string = `${segment + 1}/4 · ${text}`; this.detail!.string = body; this.feedback!.string = '';
    this.next!.interactable = canAdvance;
    this.next!.node.on(Button.EventType.CLICK, advance, this); this.skip!.node.on(Button.EventType.CLICK, skip, this);
    const polygon = this.steps[shape]!.polygon!;
    polygon.mask = this.shade!; polygon.enabled = true; this.refreshHole(target, shape);
  }
  public refreshHole(target: Node, shape: number): void {
    if (!target.isValid || !this.node.activeInHierarchy) return;
    this.anchor!.setWorldPosition(target.worldPosition);
    const visible = view.getVisibleSize(), polygon = this.steps[shape]!.polygon!;
    // Compensate this fork's design-centre offset as well as the authored origin.
    polygon.offsetV3 = new Vec3(this.maskOrigin.x - this.node.worldPosition.x + (visible.width - 750) / 2,
      this.maskOrigin.y - this.node.worldPosition.y + (visible.height - 1334) / 2, 0);
    polygon.updateMask();
  }
  /** Revoke input and delayed resize writes before the owner releases its targets. */
  public stop(): void {
    this.unscheduleAllCallbacks();
    this.next?.node?.targetOff(this); this.skip?.node?.targetOff(this);
    for (const step of this.steps) {
      if (step.polygon?.isValid) { step.polygon.enabled = false; step.polygon.mask = null; step.polygon.unscheduleAllCallbacks(); }
    }
  }
  protected onDisable(): void { this.stop(); }
  protected onDestroy(): void { this.stop(); }
}
