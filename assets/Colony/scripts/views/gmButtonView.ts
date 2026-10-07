import { _decorator, Component, EventTouch, Game, game, Node, sys, UITransform, Vec2, Vec3 } from 'cc';

const { ccclass } = _decorator;

/** UI-only gesture state; the caller owns the development gate and GM command. */
@ccclass('ColonyGmButtonView')
export class ColonyGmButtonView extends Component {
  private open: (() => void) | null = null;
  private touchId: number | null = null;
  private touchStart = new Vec2();
  private localStart = new Vec3();
  private origin = new Vec3();
  private dragged = false;

  public bind(available: boolean, open: () => void): void {
    this.unlisten();
    this.open = available ? open : null;
    this.node.active = available;
    if (available && this.node.activeInHierarchy) this.listen();
  }

  public clampToSafeArea(): void {
    const parent = this.node.parent?.getComponent(UITransform);
    const own = this.node.getComponent(UITransform);
    if (!parent || !own) return;
    // sys already returns UI coordinates; applying devicePixelRatio again is wrong.
    const area = sys.getSafeAreaRect(false);
    const low = parent.convertToNodeSpaceAR(new Vec3(area.x, area.y, 0));
    const high = parent.convertToNodeSpaceAR(new Vec3(area.x + area.width, area.y + area.height, 0));
    const halfX = own.width * Math.abs(this.node.scale.x) / 2 + 6;
    const halfY = own.height * Math.abs(this.node.scale.y) / 2 + 6;
    const minX = Math.min(low.x, high.x) + halfX, maxX = Math.max(low.x, high.x) - halfX;
    const minY = Math.min(low.y, high.y) + halfY, maxY = Math.max(low.y, high.y) - halfY;
    const bounded = (value: number, min: number, max: number): number => min <= max ? Math.max(min, Math.min(max, value)) : (min + max) / 2;
    this.node.setPosition(bounded(this.node.position.x, minX, maxX), bounded(this.node.position.y, minY, maxY), this.node.position.z);
  }

  private readonly startTouch = (event: EventTouch): void => {
    if (this.touchId !== null || !this.open) return;
    const parent = this.node.parent?.getComponent(UITransform);
    if (!parent) return;
    this.touchId = event.getID();
    this.touchStart = event.getUILocation();
    this.localStart = parent.convertToNodeSpaceAR(new Vec3(this.touchStart.x, this.touchStart.y, 0));
    this.origin.set(this.node.position);
    this.dragged = false;
  };

  private readonly moveTouch = (event: EventTouch): void => {
    if (event.getID() !== this.touchId) return;
    const point = event.getUILocation();
    if (Vec2.distance(point, this.touchStart) > 10) this.dragged = true;
    if (!this.dragged) return;
    const parent = this.node.parent?.getComponent(UITransform);
    if (!parent) return;
    const local = parent.convertToNodeSpaceAR(new Vec3(point.x, point.y, 0));
    this.node.setPosition(this.origin.x + local.x - this.localStart.x, this.origin.y + local.y - this.localStart.y, this.origin.z);
    this.clampToSafeArea();
  };

  private readonly endTouch = (event: EventTouch): void => {
    if (event.getID() !== this.touchId) return;
    const click = !this.dragged && Vec2.distance(event.getUILocation(), this.touchStart) <= 10;
    this.resetTouch();
    if (click && this.node.activeInHierarchy) this.open?.();
  };
  private readonly cancelTouch = (event: EventTouch): void => { if (event.getID() === this.touchId) this.resetTouch(); };
  private resetTouch(): void { this.touchId = null; this.dragged = false; }
  protected onLoad(): void { game.on(Game.EVENT_HIDE, this.resetTouch, this); }
  private listen(): void {
    this.node.targetOff(this);
    this.node.on(Node.EventType.TOUCH_START, this.startTouch, this);
    this.node.on(Node.EventType.TOUCH_MOVE, this.moveTouch, this);
    this.node.on(Node.EventType.TOUCH_END, this.endTouch, this);
    this.node.on(Node.EventType.TOUCH_CANCEL, this.cancelTouch, this);
  }
  private unlisten(): void { this.node?.targetOff(this); this.resetTouch(); }
  protected onEnable(): void { if (this.open) this.listen(); }
  protected onDisable(): void { this.unlisten(); }
  protected onDestroy(): void { game.off(Game.EVENT_HIDE, this.resetTouch, this); this.unlisten(); this.open = null; }
}
