import { _decorator, Color, Label, Node, Sprite, SpriteFrame, Tween, tween, Vec3 } from 'cc';
import mk from 'mk';
import type { ProgressRow } from './progressModel';
const { ccclass, property } = _decorator;
export interface ProgressRowOwner {
  readonly assetOwner: Node;
  isCurrent(): boolean;
  bind(node: Node, enabled: boolean, action: () => void): void;
  act(action: string): void;
}
/** Editable Plain / Icon / Basket states; only projected values change during reuse. */
@ccclass('ColonyProgressRowView')
export class ColonyProgressRowView extends mk.StaticViewBase {
  @property([Node]) public layouts: Node[] = [];
  @property([Label]) public titles: Label[] = [];
  @property([Label]) public details: Label[] = [];
  @property([Node]) public actionButtons: Node[] = [];
  @property([Label]) public actionLabels: Label[] = [];
  @property([Sprite]) public itemSprites: Sprite[] = [];
  @property([Sprite]) public produceSprites: Sprite[] = [];
  @property([Label]) public produceCounts: Label[] = [];
  @property(Sprite) public emblem: Sprite | null = null;
  @property(Label) public stageLabel: Label | null = null;
  @property(Node) public lantern: Node | null = null;
  private currentRow: ProgressRow | null = null;
  private epoch = 0;

  public render(row: ProgressRow, owner: ProgressRowOwner): void {
    if (this.layouts.length !== 3 || this.titles.length !== 3 || this.details.length !== 3
      || this.actionButtons.length !== 3 || this.actionLabels.length !== 3 || this.itemSprites.length !== 2
      || this.produceSprites.length !== 4 || this.produceCounts.length !== 4
      || !this.emblem || !this.stageLabel || !this.lantern) throw new Error('Progress row bindings are incomplete');
    this.currentRow = row;
    const epoch = ++this.epoch;
    const current = (): boolean => epoch === this.epoch && this.currentRow === row
      && owner.isCurrent() && this.node.isValid && this.node.activeInHierarchy;
    const index = row.basketItems ? 2 : row.itemId || row.stage !== undefined ? 1 : 0;
    this.layouts.forEach((node, i) => { node.active = i === index; });
    this.titles[index].string = row.title;
    this.details[index].string = row.detail;
    this.actionLabels[index].string = row.button;
    const button = this.actionButtons[index];
    button.active = Boolean(row.button);
    owner.bind(button, row.enabled, () => { if (current()) owner.act(row.action); });
    for (const sprite of this.itemSprites) sprite.node.active = false;
    if (row.itemId) {
      const sprite = this.itemSprites[index === 2 ? 1 : 0];
      sprite.node.active = true; sprite.grayscale = row.count === 0;
      this.loadIcon(sprite, row.iconPath!, owner, current);
    }
    const items = row.basketItems?.filter(item => item.kind === 'produce');
    this.produceSprites.forEach((sprite, i) => {
      const item = items?.[i]; sprite.node.active = Boolean(item);
      if (!item) return;
      sprite.grayscale = item.count === 0;
      this.produceCounts[i].string = `${item.count}/${item.target}`;
      this.loadIcon(sprite, item.iconPath, owner, current);
    });
    Tween.stopAllByTarget(this.lantern);
    this.lantern.active = false; this.lantern.setRotationFromEuler(0, 0, 0);
    this.emblem.node.active = row.stage !== undefined;
    if (row.stage !== undefined) {
      const colors = [new Color(92, 91, 107), new Color(147, 111, 81), new Color(227, 174, 99), new Color(255, 225, 120)];
      this.emblem.color = colors[row.stage] ?? colors[0];
      this.stageLabel.string = ['待清理', '已清理', '已修复', '已点亮'][row.stage] ?? '';
      const decorated = Boolean(row.decoration && row.decoration !== 'base');
      if (decorated) {
        this.emblem.color = row.decoration === 'season' ? new Color(100, 236, 234) : new Color(255, 163, 104);
        this.stageLabel.string = row.decoration === 'season' ? '季节灯饰' : '暖色灯笼';
        this.lantern.active = true; this.lantern.setRotationFromEuler(0, 0, -5);
        tween(this.lantern).repeatForever(tween().to(0.75, { eulerAngles: new Vec3(0, 0, 5) })
          .to(0.75, { eulerAngles: new Vec3(0, 0, -5) })).start();
      }
    }
  }
  private loadIcon(sprite: Sprite, path: string, owner: ProgressRowOwner, current: () => boolean): void {
    sprite.spriteFrame = null;
    void mk.asset.get(`db://${path}`, SpriteFrame, owner.assetOwner)
      .then(frame => { if (frame && current() && sprite.node?.isValid) sprite.spriteFrame = frame; })
      .catch(cause => { if (current()) console.error('Failed to load progress icon', cause); });
  }
  private invalidate(): void {
    this.epoch++; this.currentRow = null;
    if (this.lantern?.isValid) { Tween.stopAllByTarget(this.lantern); this.lantern.setRotationFromEuler(0, 0, 0); }
  }
  public close(): void { this.invalidate(); }
  protected onDisable(): void { this.invalidate(); }
  protected onDestroy(): void { this.invalidate(); }
}
