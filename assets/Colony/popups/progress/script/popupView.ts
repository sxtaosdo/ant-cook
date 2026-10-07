import { Button, Color, EventTouch, Node } from 'cc';
import mk from 'mk';
import { ProgressModel } from './progressModel';

/** Shared binding lifetime for Ant's projection-only MVC popups. */
export abstract class ColonyPopupView extends mk.MVCViewBase<ProgressModel> {
  private readonly boundNodes = new Set<Node>();
  private viewRoot: Node | null = null;
  protected revision = 0;

  public init(model?: ProgressModel): void {
    if (!model) throw new Error('Popup requires a model');
    this._model = model;
  }
  public open(): void {
    this.clearBindings();
    this.viewRoot = this.node;
    this.event.off('action');
    this.event.off('close');
    this.prepareOpen();
    this.render();
  }
  protected prepareOpen(): void {}
  public isAvailable(): boolean { return this.valid && !!this.viewRoot?.isValid && this.viewRoot.activeInHierarchy; }
  public abstract render(): void;

  protected bind(node: Node, enabled: boolean, action: () => void): void {
    this.boundNodes.add(node);
    node.targetOff(this);
    const button = node.getComponent(Button)!;
    button.disabledColor = new Color(224, 203, 171);
    button.interactable = enabled;
    let dragged = false;
    node.on(Node.EventType.TOUCH_START, () => { dragged = false; }, this);
    node.on(Node.EventType.TOUCH_MOVE, (event: EventTouch) => {
      const start = event.getStartLocation(), current = event.getLocation();
      if (Math.hypot(current.x - start.x, current.y - start.y) > 10) dragged = true;
    }, this);
    node.on(Button.EventType.CLICK, () => { if (!dragged && this.isAvailable() && node.activeInHierarchy) action(); }, this);
  }
  private clearBindings(): void {
    this.revision++;
    this.viewRoot = null;
    for (const node of this.boundNodes) if (node.isValid) node.targetOff(this);
    this.boundNodes.clear();
  }
  public close(): void { this.clearBindings(); }
  public suspend(): void { this.clearBindings(); if (this.node?.isValid) this.node.active = false; }
  protected onDisable(): void { this.clearBindings(); }
  protected onDestroy(): void { this.clearBindings(); }
}
