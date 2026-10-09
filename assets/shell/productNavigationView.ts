import { _decorator, Graphics, Label, Node, UITransform } from 'cc';
import mk from 'mk';
import type { ModeId } from './contracts';

const { ccclass, property } = _decorator;

export interface ProductNavigationActions {
  enter(mode: ModeId): void;
  continueCurrent(): void;
  retry(): void;
}

/** Persistent, projection-only shell UI. The Prefab owns its geometry and styling. */
@ccclass('ProductNavigationView')
export class ProductNavigationView extends mk.StaticViewBase {
  @property(UITransform) public rootTransform: UITransform | null = null;
  @property(Graphics) public backdrop: Graphics | null = null;
  @property(Node) public panel: Node | null = null;
  @property(Graphics) public panelPaper: Graphics | null = null;
  @property(Node) public antButton: Node | null = null;
  @property(Node) public cookButton: Node | null = null;
  @property(Node) public continueButton: Node | null = null;
  @property(Node) public retryButton: Node | null = null;
  @property(Label) public antLabel: Label | null = null;
  @property(Label) public cookLabel: Label | null = null;
  @property(Label) public retryLabel: Label | null = null;
  @property(Label) public continueLabel: Label | null = null;
  @property(Label) public statusLabel: Label | null = null;
  @property([Graphics]) public buttonPlates: Graphics[] = [];
  @property public panelRadius = 24;
  @property public buttonRadius = 14;
  private actions: ProductNavigationActions | null = null;

  public configure(actions: ProductNavigationActions): void {
    if (!this.rootTransform || !this.backdrop || !this.panel || !this.panelPaper
      || !this.antButton || !this.cookButton || !this.continueButton || !this.retryButton
      || !this.antLabel || !this.cookLabel || !this.retryLabel || !this.continueLabel || !this.statusLabel
      || this.buttonPlates.length !== 4) throw new Error('Product navigation bindings are incomplete');
    this.actions = actions;
    this.drawPlates();
    this.bindActions();
  }

  public reveal(modes: readonly ModeId[], current: ModeId | null, canContinue: boolean,
    canRetry: boolean, retryText: string, width: number, height: number, safeX: number, safeY: number): void {
    this.rootTransform!.setContentSize(width, height);
    this.drawPlate(this.backdrop!, 0);
    this.panel!.setPosition(safeX, safeY);
    this.continueButton!.active = canContinue;
    this.continueLabel!.string = '继续当前玩法';
    this.retryButton!.active = canRetry;
    this.retryLabel!.string = retryText;
    for (const [id, node, label, title] of [
      ['ant', this.antButton!, this.antLabel!, '蚂蚁搬搬搬'],
      ['cook', this.cookButton!, this.cookLabel!, '星际美食家'],
    ] as const) {
      const index = modes.indexOf(id);
      node.active = index >= 0;
      // The single-game variant occupies the same first slot as v16.
      if (index >= 0) node.setPosition(node.position.x, 170 - index * 120, node.position.z);
      label.string = `${title}${current === id ? '（当前）' : ''}`;
    }
    this.drawPlates();
    this.node.active = true;
  }

  public recommend(target: ModeId): void {
    this.antButton!.active = target === 'ant';
    this.cookButton!.active = target === 'cook';
    this.continueLabel!.string = '暂时不玩 · 7天内不再提示';
  }

  private drawPlates(): void {
    this.drawPlate(this.panelPaper!, this.panelRadius);
    for (const plate of this.buttonPlates) this.drawPlate(plate, this.buttonRadius);
  }
  private drawPlate(graphics: Graphics, radius: number): void {
    const { width, height } = graphics.getComponent(UITransform)!;
    graphics.clear();
    if (radius) graphics.roundRect(-width / 2, -height / 2, width, height, radius);
    else graphics.rect(-width / 2, -height / 2, width, height);
    graphics.fill();
  }
  private enterAnt(): void { this.actions?.enter('ant'); }
  private enterCook(): void { this.actions?.enter('cook'); }
  private continueCurrent(): void { this.actions?.continueCurrent(); }
  private retry(): void { this.actions?.retry(); }
  private bindActions(): void {
    this.unbindActions();
    if (!this.actions || !this.node.activeInHierarchy) return;
    this.antButton!.on(Node.EventType.TOUCH_END, this.enterAnt, this);
    this.cookButton!.on(Node.EventType.TOUCH_END, this.enterCook, this);
    this.continueButton!.on(Node.EventType.TOUCH_END, this.continueCurrent, this);
    this.retryButton!.on(Node.EventType.TOUCH_END, this.retry, this);
  }
  private unbindActions(): void {
    for (const node of [this.antButton, this.cookButton, this.continueButton, this.retryButton]) {
      if (node?.isValid) node.targetOff(this);
    }
  }
  protected onEnable(): void { this.bindActions(); }
  protected onDisable(): void { this.unbindActions(); }
  public close(): void { this.unbindActions(); }
  protected onDestroy(): void { this.unbindActions(); this.actions = null; }
}
