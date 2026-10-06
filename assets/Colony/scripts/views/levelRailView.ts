import { Color, Graphics, Label, Node, ScrollView, Sprite, tween, Tween, UIOpacity, UITransform, Vec2, Vec3 } from 'cc';

const THEMES = ['tropical-fruit', 'tropical-vegetable', 'orchard-fruit', 'root-vegetable', 'leafy-vegetable'] as const;
const VIEWPORT_WIDTH = 340;
const ITEM_HEIGHT = 45;

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
      background.active = true;
      this.backgrounds.set(theme, { node: background, opacity });
    }
  }

  public render(level: number, _itemName: string, themeId: string, initial: number, remaining: number, single = false): void {
    this.cancelReturn();
    this.scroll.stopAutoScroll();
    this.touching = this.returning = false;
    const background = this.backgrounds.get(themeId);
    if (!background) throw new Error(`Unknown rail theme ${themeId}`);
    for (const child of this.levels.children.slice()) child.destroy();
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
      const item = new Node(`Level${index}`);
      item.layer = this.content.layer;
      item.parent = this.levels;
      item.addComponent(UITransform).setContentSize(width, ITEM_HEIGHT);
      item.setPosition(cursor + width / 2, 0);
      const card = item.addComponent(Graphics);
      card.fillColor = active ? new Color('#FFF9E9DB') : new Color('#FFFDF3B8');
      card.roundRect(-width / 2, -ITEM_HEIGHT / 2, width, ITEM_HEIGHT, 16);
      card.fill();
      const title = new Node('Title');
      title.layer = item.layer;
      title.parent = item;
      title.addComponent(UITransform).setContentSize(width - 16, active ? 26 : 40);
      title.setPosition(0, active ? 13 : 0);
      const label = title.addComponent(Label);
      label.string = active ? '' : `Lv ${index}`;
      label.fontSize = active ? 21 : 19;
      label.lineHeight = 27;
      label.color = new Color('#633E31');
      if (active) {
        const progress = new Node('Progress');
        progress.layer = item.layer;
        progress.parent = item;
        progress.setPosition(0, 0);
        progress.addComponent(UITransform).setContentSize(200, 15);
        this.railFill = progress.addComponent(Graphics);
        const percent = new Node('Percent');
        percent.layer = item.layer;
        percent.parent = item;
        percent.setPosition(0, 0);
        percent.addComponent(UITransform).setContentSize(200, 20);
        this.railProgress = percent.addComponent(Label);
        this.railProgress.fontSize = 15;
        this.railProgress.lineHeight = 18;
        this.railProgress.color = new Color('#543B2F');
        const anchor = new Node('ProgressEndpoint'); anchor.layer = item.layer; anchor.parent = progress;
        anchor.addComponent(UITransform).setContentSize(1, 1); this.progressAnchor = anchor;
      }
      cursor += width + 10;
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
    const offset = this.currentOffset;
    if (this.centerTimer) clearTimeout(this.centerTimer);
    this.centerTimer = setTimeout(() => {
      if (!this.disposed && this.scroll.isValid) {
        this.scroll.scrollToOffset(new Vec2(offset, 0), 0);
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
  public setBackground(visible: boolean): void { for (const { opacity } of this.backgrounds.values()) opacity.opacity = visible ? 255 : 0; }

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
    if (!this.returning) this.cancelReturn();
  }

  private onRailScrollEnded(): void {
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

  public dispose(): void {
    this.disposed = true;
    this.stopProgress();
    this.cancelReturn();
    if (this.scroll.isValid) this.scroll.stopAutoScroll();
    this.returning = false;
    if (this.viewport.isValid) this.viewport.targetOff(this);
    this.node.destroy();
  }

}
