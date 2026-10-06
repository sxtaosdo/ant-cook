import { _decorator, Color, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import type { ProgressRow } from '../../progress/script/progressModel';
const { ccclass, property } = _decorator;

@ccclass('ColonyShopRow')
export class ColonyShopRow extends Component {
  @property(Label) public quantityLabel: Label | null = null;
  @property(Label) public nameLabel: Label | null = null;
  @property(Label) public statusLabel: Label | null = null;
  @property(Sprite) public productImage: Sprite | null = null;
  @property(Node) public actionButton: Node | null = null;
  @property(Sprite) public actionImage: Sprite | null = null;
  @property(Label) public actionLabel: Label | null = null;
  @property(SpriteFrame) public smallFrame: SpriteFrame | null = null;
  @property(SpriteFrame) public bagFrame: SpriteFrame | null = null;
  @property(SpriteFrame) public chestFrame: SpriteFrame | null = null;

  public render(row: ProgressRow): void {
    const product = row.shopProduct;
    if (!product || !this.quantityLabel || !this.nameLabel || !this.statusLabel || !this.productImage
      || !this.actionButton || !this.actionImage || !this.actionLabel || !this.smallFrame || !this.bagFrame || !this.chestFrame) {
      throw new Error('Shop row binding is missing');
    }
    this.quantityLabel.string = `${product.diamonds} 钻石`;
    this.nameLabel.string = product.priceYuan === undefined ? '新老玩家体验礼包' : '钻石补给';
    this.statusLabel.string = product.priceYuan === undefined ? product.claimed ? '已领取' : '一次性免费领取' : '充值暂未开放';
    this.productImage.spriteFrame = product.image === 'diamonds-small' ? this.smallFrame : product.image === 'diamonds-bag' ? this.bagFrame : this.chestFrame;
    this.actionLabel.string = row.button;
    this.actionImage.color = new Color(product.priceYuan === undefined && !product.claimed ? '#FFFFFF' : '#CBD2DE');
  }
}
