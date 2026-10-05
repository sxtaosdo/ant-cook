import {
  Button,
  Color,
  Label,
  Layers,
  Node,
  Sprite,
  SpriteFrame,
  Tween,
  UITransform,
  UIOpacity,
  Vec3,
} from 'cc';
import mk from 'mk';

/** UI 节点工厂：对象池、标签、色块绘制与按钮绑定。 */
export class NodeFactory {
  private readonly pools = new Set<mk.ObjectPool.Sync<Node>>();
  public dispose(): void { for (const pool of this.pools) pool.destroy(); this.pools.clear(); }
  /** 创建同步节点对象池。 */
  public pool(prefix: string): mk.ObjectPool.Sync<Node> {
    const pool = new mk.ObjectPool.Sync<Node>({
      initFillNum: 0, minHoldNum: 0, maxHoldNum: 64,
      createFunc: () => new Node(prefix),
      resetFunc: (node) => {
        Tween.stopAllByTarget(node);
        const opacity = node.getComponent(UIOpacity);
        if (opacity) {
          Tween.stopAllByTarget(opacity);
          opacity.opacity = 255;
        }
        node.targetOff(node);
        node.removeFromParent();
        node.active = false;
        node.setPosition(Vec3.ZERO);
        node.setScale(Vec3.ONE);
        node.setRotationFromEuler(0, 0, 0);
        return node;
      },
      clearFunc: (nodes) => nodes.forEach((node) => node.destroy()),
    });
    this.pools.add(pool);
    return pool;
  }

  /** 从池取出节点并挂到父节点，设置尺寸与位置。 */
  public acquire(
    pool: mk.ObjectPool.Sync<Node>,
    name: string,
    x: number,
    y: number,
    width: number,
    height: number,
    parent: Node,
  ): Node {
    const node = pool.get();
    node.name = name;
    node.active = true;
    node.layer = Layers.Enum.UI_2D;
    node.setParent(parent);
    node.setPosition(x, y);
    node.setScale(Vec3.ONE);
    const opacity = node.getComponent(UIOpacity);
    if (opacity) opacity.opacity = 255;
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    transform.setContentSize(width, height);
    transform.setAnchorPoint(0.5, 0.5);
    return node;
  }

  /** 在父节点下创建居中 Label。 */
  public label(
    text: string,
    parent: Node,
    width: number,
    height: number,
    fontSize: number,
    color = Color.WHITE,
  ): Label {
    const node = new Node(`label-${text.slice(0, 14)}`);
    node.layer = Layers.Enum.UI_2D;
    node.setParent(parent);
    const transform = node.addComponent(UITransform);
    transform.setContentSize(width, height);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = fontSize + 8;
    label.color = color;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.overflow = Label.Overflow.SHRINK;
    return label;
  }

  /** 将节点配置为带色 Sprite token。 */
  public token(node: Node, color: Color, frame: SpriteFrame): void {
    const sprite = node.getComponent(Sprite) ?? node.addComponent(Sprite);
    sprite.enabled = true;
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.spriteFrame = frame;
    sprite.color = color;
  }

  /** 绑定缩放过渡的点击按钮。 */
  public bindButton(node: Node, target: object, handler: () => void): void {
    const button = node.getComponent(Button) ?? node.addComponent(Button);
    button.transition = Button.Transition.SCALE;
    button.zoomScale = 0.94;
    node.targetOff(target);
    node.on(Button.EventType.CLICK, handler, target);
  }
}
