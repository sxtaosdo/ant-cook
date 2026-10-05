import { _decorator, Node, Sprite, SpriteFrame, UITransform, view } from 'cc';
import mk from 'mk';

const { ccclass, property } = _decorator;

@ccclass('ColonySlotView')
/** 暂存槽 Prefab：内容根、六个锚点与色块图集。 */
export class ColonySlotView extends mk.StaticViewBase {
  @property(Node)
  private contentRoot: Node | null = null;

  @property([Node])
  private fixedSlots: Node[] = [];

  @property(SpriteFrame)
  private stackFrame: SpriteFrame | null = null;

  @property(SpriteFrame)
  private cargoFrame: SpriteFrame | null = null;
  private defaultSlotFrames: Array<SpriteFrame | null> = [];
  private defaultTrayEnabled = true;

  protected onLoad(): void {
    if (!this.contentRoot || !this.stackFrame || !this.cargoFrame || this.fixedSlots.length !== 6 || this.fixedSlots.some((slot) => !slot)) {
      throw new Error('Slot Prefab requires SlotContent, six anchors, and the stack and cargo frames');
    }
    this.defaultSlotFrames = this.fixedSlots.map(slot => slot.getComponent(Sprite)?.spriteFrame ?? null);
    this.defaultTrayEnabled = this.node.getComponent(Sprite)?.enabled ?? false;
  }

  /** 首关改用独立空槽，其他关卡恢复序列化外观。 */
  public setFirstLevelSkin(frame: SpriteFrame | null): void {
    for (const name of ['SlotHeading', 'QueueHeading']) {
      const heading = this.node.getChildByName(name);
      if (heading) heading.active = Boolean(frame) && view.getVisibleSize().height >= 1600;
    }
    this.node.getChildByName('SlotHeading')?.setPosition(-270, 118);
    this.node.getChildByName('QueueHeading')?.setPosition(-100, -65);
    const tray = this.node.getComponent(Sprite);
    if (tray) tray.enabled = frame ? false : this.defaultTrayEnabled;
    this.fixedSlots.forEach((slot, index) => {
      const sprite = slot.getComponent(Sprite);
      if (sprite) sprite.spriteFrame = frame ?? this.defaultSlotFrames[index] ?? null;
      slot.getComponent(UITransform)?.setContentSize(frame ? 100 : 96, frame ? 72 : 72);
    });
  }

  /** 槽位内容挂载点。 */
  public get content(): Node {
    if (!this.contentRoot) throw new Error('Slot Prefab is missing the SlotContent binding');
    return this.contentRoot;
  }

  /** 六个固定槽位锚点。 */
  public get slots(): readonly Node[] {
    if (this.fixedSlots.length !== 6) throw new Error('Slot Prefab requires six fixed slot bindings');
    return this.fixedSlots;
  }

  /** 数字组/槽内 token 用 SpriteFrame。 */
  public get stackSpriteFrame(): SpriteFrame {
    if (!this.stackFrame) throw new Error('Slot Prefab is missing the stack frame');
    return this.stackFrame;
  }

  /** 携带物 SpriteFrame。 */
  public get cargoSpriteFrame(): SpriteFrame {
    if (!this.cargoFrame) throw new Error('Slot Prefab is missing the cargo frame');
    return this.cargoFrame;
  }
}
