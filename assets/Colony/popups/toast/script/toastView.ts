import { _decorator, Label, tween, Tween, UITransform, Vec3, view } from 'cc';
import mk from 'mk';
const { ccclass, property } = _decorator;

@ccclass('ColonyToastView')
export class ColonyToastView extends mk.ViewBase {
  @property(Label) public caption: Label | null = null;
  private revision = 0;
  public animate(text: string, complete: () => void): void {
    const revision = ++this.revision;
    if (!this.caption) throw new Error('Toast caption binding is missing');
    this.caption.string = text;
    const node = this.node;
    Tween.stopAllByTarget(node);
    const height = view.getVisibleSize().height;
    const parent = node.parent?.getComponent(UITransform);
    const center = parent ? parent.convertToNodeSpaceAR(new Vec3(view.getVisibleSize().width / 2, height / 2)) : new Vec3();
    node.setPosition(center.x, center.y - height / 2 - 70, 0);
    node.setSiblingIndex(node.parent!.children.length - 1);
    tween(node).to(0.3, { position: new Vec3(center.x, center.y, 0) }, { easing: 'quadOut' })
      .delay(2).to(0.3, { position: new Vec3(center.x, center.y + height / 2 + 70, 0) }, { easing: 'quadIn' })
      .call(() => { if (revision === this.revision && node.isValid && node === this.node) complete(); }).start();
  }
  public cancel(): void { ++this.revision; if (this.node?.isValid) Tween.stopAllByTarget(this.node); }
  public close(): void { this.cancel(); }
  protected onDisable(): void { this.cancel(); }
  protected onDestroy(): void { this.cancel(); }
}
