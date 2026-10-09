import { Color, Graphics, Label, Node, ScrollView, Sprite, tween, Tween, UIOpacity, UITransform, Vec2, Vec3 } from 'cc';
import mk from 'mk';

const THEMES = ['tropical-fruit', 'tropical-vegetable', 'orchard-fruit', 'root-vegetable', 'leafy-vegetable'] as const;
const VIEWPORT_WIDTH = 340;
const ITEM_HEIGHT = 45;
const ITEM_GAP = 20;
const VISIBLE_BUFFER = 64 + ITEM_GAP;

/** Theme strips are visible only while touching the track. */
export class LevelRailView {
  private readonly viewport: Node;
  private readonly content: Node;
  private readonly levels: Node;
  private readonly scroll: ScrollView;
  private readonly backgrounds = new Map<string, { node: Node; opacity: UIOpacity }>();
  private railInitial = 1;
  private readonly fillState = { ratio: 0 };
  private targetRatio = 0;
  private finishProgress: (() => void) | null = null;
  private progressWait = Promise.resolve();
  private railFill: Graphics | null = null;
  private railProgress: Label | null = null;
  private progressAnchor: Node | null = null;
  private centerTimer: ReturnType<typeof setTimeout> | null = null;
  private currentOffset = 0;
  private touching = false;
  private returning = false;
  private disposed = false;
  // Keep the logical track complete while sharing a bounded set of visible cards.
  private readonly items: Array<{ index: number; left: number; width: number; current: boolean; node: Node | null }> = [];
  private readonly cardPool = new mk.ObjectPool.Sync<Node>({
    initFillNum: 0, minHoldNum: 0, maxHoldNum: 8,
    createFunc: () => new Node('rail-card'),
    resetFunc: node => { node.active = false; node.removeFromParent(); return node; },
    clearFunc: nodes => nodes.forEach(node => node.destroy()),
  });

  public constructor(public readonly node: Node) {
    const base = node.getChildByName('RailBase');
    if (base) {
      base.getComponent(Sprite)!.sizeMode = Sprite.SizeMode.CUSTOM;
      base.getComponent(UITransform)!.setContentSize(368, 80);
      base.setSiblingIndex(0);
    }
    this.viewport = node.getChildByName('RailViewport')!;
    this.content = this.viewport?.getChildByName('RailContent')!;
    this.levels = this.content?.getChildByName('Levels')!;
    this.scroll = this.viewport?.getComponent(ScrollView)!;
    if (!this.viewport || !this.content || !this.scroll || !this.levels) throw new Error('LevelRail Prefab is missing its scroll nodes');
    this.scroll.content = this.content;
    this.scroll.horizontal = true;
    this.scroll.vertical = false;
    this.scroll.inertia = false;
    this.scroll.elastic = false;
    this.viewport.on(Node.EventType.TOUCH_START, this.onRailTouchStart, this);
    this.viewport.on(Node.EventType.TOUCH_END, this.onRailTouchEnd, this);
    this.viewport.on(Node.EventType.TOUCH_CANCEL, this.onRailTouchEnd, this);
    this.viewport.on('scrolling', this.onRailScrolling, this);
    this.viewport.on('scroll-ended', this.onRailScrollEnded, this);
    this.viewport.getComponent(UITransform)!.setContentSize(VIEWPORT_WIDTH, 80);
    this.viewport.on(Node.EventType.TOUCH_START, () => this.setBackground(true), this);
    this.viewport.on(Node.EventType.TOUCH_END, () => this.setBackground(false), this);
    this.viewport.on(Node.EventType.TOUCH_CANCEL, () => this.setBackground(false), this);
    for (const theme of THEMES) {
      const background = this.content.getChildByName('ThemeStrips')!.getChildByName(`RailBackground-${theme}`);
      const opacity = background?.getComponent(UIOpacity);
      if (!background?.getComponent(Sprite) || !opacity) throw new Error(`LevelRail Prefab is missing ${theme}`);
      opacity.opacity = 0;
      background.active = false;
      this.backgrounds.set(theme, { node: background, opacity });
    }
  }

  public render(level: number, _itemName: string, themeId: string, initial: number, remaining: number, single = false): void {
    this.cancelReturn();
    this.scroll.stopAutoScroll();
    this.touching = this.returning = false;
    const background = this.backgrounds.get(themeId);
    if (!background) throw new Error(`Unknown rail theme ${themeId}`);
    this.stopProgress();
    this.clearCards();
    this.railInitial = Math.max(1, initial);
    this.railFill = null;
    this.railProgress = null;
    let cursor = 0;
    let segmentStart = 0;
    this.setBackground(false);
    for (let index = 1; index <= (single ? 1 : 60); index += 1) {
      const active = single || index === level;
      const width = active ? (single ? 328 : 218) : 64;
      if (active) this.currentOffset = cursor;
      const record = { index, left: cursor, width, current: active, node: null as Node | null };
      this.items.push(record);
      const item = active ? this.createCard(record) : null;
      if (active) {
        const progress = new Node('Progress');
        progress.layer = item!.layer;
        progress.parent = item!;
        progress.setPosition(0, 0);
        progress.addComponent(UITransform).setContentSize(200, 15);
        this.railFill = progress.addComponent(Graphics);
        const percent = new Node('Percent');
        percent.layer = item!.layer;
        percent.parent = item!;
        percent.setPosition(0, 0);
        percent.addComponent(UITransform).setContentSize(200, 20);
        this.railProgress = percent.addComponent(Label);
        this.railProgress.fontSize = 15;
        this.railProgress.lineHeight = 18;
        this.railProgress.color = new Color('#543B2F');
        const anchor = new Node('ProgressEndpoint'); anchor.layer = item!.layer; anchor.parent = progress;
        anchor.addComponent(UITransform).setContentSize(1, 1); this.progressAnchor = anchor;
      }
      cursor += width + ITEM_GAP;
      if (single || index % 12 === 0) {
        const strip = this.backgrounds.get(single ? themeId : THEMES[index / 12 - 1]!)!.node;
        strip.getComponent(UITransform)!.setContentSize(cursor - segmentStart, 80);
        strip.setPosition((segmentStart + cursor) / 2, 0, 0);
        segmentStart = cursor;
      }
    }
    const contentWidth = Math.max(cursor, this.currentOffset + VIEWPORT_WIDTH);
    this.content.getComponent(UITransform)!.setContentSize(contentWidth, 80);
    this.levels.getComponent(UITransform)!.setContentSize(contentWidth, 80);
    this.content.getChildByName('ThemeStrips')!.getComponent(UITransform)!.setContentSize(contentWidth, 80);
    this.stopProgress();
    this.targetRatio = this.fillState.ratio = Math.max(0, Math.min(1, (this.railInitial - remaining) / this.railInitial));
    this.drawProgress();
    this.refreshVisibleCards();
    const offset = this.currentOffset;
    if (this.centerTimer) clearTimeout(this.centerTimer);
    this.centerTimer = setTimeout(() => {
      if (!this.disposed && this.scroll.isValid) {
        this.scroll.scrollToOffset(new Vec2(offset, 0), 0);
        this.refreshVisibleCards();
      }
      this.centerTimer = null;
    }, 0);
  }

  public update(remaining: number): void {
    if (!this.railFill || !this.railProgress) return;
    const ratio = Math.max(this.targetRatio, Math.min(1, (this.railInitial - remaining) / this.railInitial));
    if (ratio === this.targetRatio) return;
    this.stopProgress();
    this.targetRatio = ratio;
    this.progressWait = new Promise(resolve => { this.finishProgress = resolve; });
    tween(this.fillState).to(0.3, { ratio }, { easing: 'quadOut', onUpdate: () => this.drawProgress() })
      .call(() => { this.finishProgress?.(); this.finishProgress = null; }).start();
  }

  public endpoint(): Vec3 | null {
    return this.progressAnchor?.worldPosition ?? null;
  }
  public get target(): Node | null { return this.progressAnchor; }
  public setBackground(visible: boolean): void { for (const { node, opacity } of this.backgrounds.values()) { opacity.opacity = visible ? 255 : 0; node.active = visible; } }

  public waitForProgress(): Promise<void> { return this.progressWait; }

  private stopProgress(): void {
    Tween.stopAllByTarget(this.fillState);
    this.finishProgress?.();
    this.finishProgress = null;
  }

  private drawProgress(): void {
    if (!this.railFill || !this.railProgress) return;
    const ratio = this.fillState.ratio;
    this.progressAnchor?.setPosition(-100 + 200 * ratio, 0, 0);
    this.railFill.clear();
    this.railFill.fillColor = new Color('#EADFCC');
    this.railFill.roundRect(-100, -7, 200, 14, 7);
    this.railFill.fill();
    this.railFill.fillColor = new Color('#FF9A4D');
    if (ratio > 0) {
      this.railFill.roundRect(-100, -7, 200 * ratio, 14, 7);
      this.railFill.fill();
    }
    this.railProgress.string = `${Math.round(ratio * 100)}%`;
  }

  public get totalCount(): number { return this.railInitial; }
  public clearedCount(remaining: number): number { return Math.max(0, this.railInitial - remaining); }

  private cancelReturn(): void {
    if (this.centerTimer !== null) clearTimeout(this.centerTimer);
    this.centerTimer = null;
  }

  private onRailTouchStart(): void {
    this.touching = true;
    this.cancelReturn();
    this.scroll.stopAutoScroll();
    this.returning = false;
  }

  private onRailTouchEnd(): void {
    this.touching = false;
    this.scheduleReturn();
  }

  private onRailScrolling(): void {
    this.refreshVisibleCards();
    if (!this.returning) this.cancelReturn();
  }

  private onRailScrollEnded(): void {
    this.refreshVisibleCards();
    if (this.returning) { this.returning = false; return; }
    this.scheduleReturn();
  }

  private scheduleReturn(): void {
    this.cancelReturn();
    if (this.disposed || this.touching || Math.abs(this.scroll.getScrollOffset().x - this.currentOffset) < 0.5) return;
    this.centerTimer = setTimeout(() => {
      this.centerTimer = null;
      if (this.disposed || !this.scroll.isValid) return;
      this.returning = true;
      this.scroll.scrollToOffset(new Vec2(this.currentOffset, 0), 0.3);
    }, 1000);
  }

  private createCard(item: { index: number; left: number; width: number; current: boolean; node: Node | null }): Node {
    const node = item.current ? new Node() : this.cardPool.get();
    node.name = `Level${item.index}`;
    node.layer = this.content.layer;
    node.parent = this.levels;
    node.active = true;
    (node.getComponent(UITransform) ?? node.addComponent(UITransform)).setContentSize(item.width, ITEM_HEIGHT);
    node.setPosition(item.left + item.width / 2, 0);
    if (!node.getComponent(Graphics)) {
      const card = node.addComponent(Graphics);
      card.fillColor = item.current ? new Color('#FFF9E9DB') : new Color('#FFFDF3B8');
      card.roundRect(-item.width / 2, -ITEM_HEIGHT / 2, item.width, ITEM_HEIGHT, 16);
      card.fill();
      const title = new Node('Title'); title.layer = node.layer; title.parent = node;
      title.addComponent(UITransform).setContentSize(item.width - 16, item.current ? 26 : 40);
      title.setPosition(0, item.current ? 13 : 0);
      const label = title.addComponent(Label);
      label.fontSize = item.current ? 21 : 19; label.lineHeight = 27; label.color = new Color('#633E31');
    }
    node.getComponentInChildren(Label)!.string = item.current ? '' : `Lv ${item.index}`;
    item.node = node;
    return node;
  }

  private refreshVisibleCards(): void {
    if (this.disposed || !this.viewport.isValid || !this.levels.isValid) return;
    const viewport = this.viewport.getComponent(UITransform)!;
    const levels = this.levels.getComponent(UITransform)!;
    const edge = (x: number): number => levels.convertToNodeSpaceAR(viewport.convertToWorldSpaceAR(new Vec3(x, 0, 0))).x;
    const x1 = edge(-viewport.width * viewport.anchorX), x2 = edge(viewport.width * (1 - viewport.anchorX));
    const left = Math.min(x1, x2) - VISIBLE_BUFFER, right = Math.max(x1, x2) + VISIBLE_BUFFER;
    const visible = (item: typeof this.items[number]): boolean => item.current || item.left + item.width >= left && item.left <= right;
    // Recycle first, so a scroll reuses existing geometry rather than growing the pool.
    for (const item of this.items) {
      if (item.current || !item.node || visible(item)) continue;
      this.cardPool.put(item.node); item.node = null;
    }
    for (const item of this.items) if (!item.node && visible(item)) this.createCard(item);
  }

  private clearCards(): void {
    for (const child of this.levels.children.slice()) child.destroy();
    this.cardPool.clear();
    this.items.length = 0;
    this.progressAnchor = null;
  }

  public dispose(): void {
    this.disposed = true;
    this.stopProgress();
    this.cancelReturn();
    if (this.scroll.isValid) this.scroll.stopAutoScroll();
    this.returning = false;
    if (this.viewport.isValid) this.viewport.targetOff(this);
    this.cardPool?.destroy();
    this.node.destroy();
  }

}
