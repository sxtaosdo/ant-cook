import { _decorator, Node, Sprite, SpriteFrame, UITransform, Vec3, view } from 'cc';
import mk from 'mk';

const { ccclass, property } = _decorator;

@ccclass('ColonyBoardView')
/** 棋盘 Prefab 视图：暴露 Content 根节点给 BoardPresentation。 */
export class ColonyBoardView extends mk.StaticViewBase {
  @property(Node)
  private contentRoot: Node | null = null;
  private defaultBackground: SpriteFrame | null = null;
  private backgroundPosition = new Vec3();

  protected onLoad(): void {
    if (!this.contentRoot) throw new Error('Board Prefab is missing the Content binding');
    const background = this.node.getChildByName('BackgroundArt');
    this.defaultBackground = background?.getComponent(Sprite)?.spriteFrame ?? null;
    if (background) this.backgroundPosition = background.position.clone();
  }

  /** 棋盘内容挂载点。 */
  public get content(): Node {
    if (!this.contentRoot) throw new Error('Board Prefab is missing the Content binding');
    return this.contentRoot;
  }

  /** Theme scenery is three independent sprites; daily play restores the serialized backdrop. */
  public setThemeLayers(layers: readonly { frame: SpriteFrame | null; x: number; y: number }[] | null): void {
    const frameNode = this.node.getChildByName('BoardFrame');
    if (frameNode) {
      frameNode.active = false;
      frameNode.setScale(Vec3.ONE);
    }
    this.contentRoot!.setScale(Vec3.ONE);
    const hole = this.node.getChildByName('AntHole');
    if (hole) {
      hole.active = false;
      hole.setPosition(0, -380);
    }
    const names = ['BackgroundArt', 'ThemeMid', 'ThemeNear'];
    names.forEach((name, index) => {
      const node = this.node.getChildByName(name);
      if (!node) throw new Error(`Board Prefab is missing ${name}`);
      const sprite = node.getComponent(Sprite)!;
      const layer = layers?.[index];
      const frame = layer?.frame ?? (index === 0 ? this.defaultBackground : null);
      node.active = Boolean(frame);
      sprite.spriteFrame = frame;
      sprite.sizeMode = Sprite.SizeMode.CUSTOM;
      if (frame) node.getComponent(UITransform)!.setContentSize(frame.originalSize);
      node.setPosition(this.backgroundPosition.x + (layer?.x ?? 0), this.backgroundPosition.y + (layer?.y ?? 0), 0);
    });
    this.node.getChildByName('BackgroundArt')!.setSiblingIndex(0);
    this.node.getChildByName('ThemeMid')!.setSiblingIndex(1);
    this.contentRoot!.setSiblingIndex(2);
    this.node.getChildByName('ThemeNear')!.setSiblingIndex(3);
  }

  /** 首关使用独立场景与棋盘框；背景保持在屏幕中心，不随棋盘位移。 */
  public setFirstLevelSkin(background: SpriteFrame): void {
    this.setThemeLayers([{ frame: background, x: 0, y: 90 - this.node.position.y }]);
    const frame = this.node.getChildByName('BoardFrame');
    if (!frame) throw new Error('Board Prefab is missing BoardFrame');
    frame.active = true;
    frame.setScale(0.925, 0.925);
    this.contentRoot!.setScale(0.925, 0.925);
    frame.setSiblingIndex(1);
    this.contentRoot!.setSiblingIndex(2);
    const hole = this.node.getChildByName('AntHole');
    if (hole) {
      hole.active = true;
      const compact = Math.min(16, Math.max(0, 1600 - view.getVisibleSize().height) * 0.19);
      hole.setPosition(0, -340 - compact);
      hole.setScale(0.85, 0.85);
    }
  }

}
