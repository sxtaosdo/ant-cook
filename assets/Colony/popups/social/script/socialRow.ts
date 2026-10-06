import { _decorator, Color, Component, Label, Node, Sprite } from 'cc';
import type { SocialCard } from '../../../scripts/presentation/social/socialPresentation';
const { ccclass, property } = _decorator;
type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

@ccclass('ColonySocialRow')
export class ColonySocialRow extends Component {
  @property(Label) public titleLabel: Label | null = null;
  @property(Label) public detailLabel: Label | null = null;
  @property(Label) public badgeLabel: Label | null = null;
  @property(Sprite) public avatar: Sprite | null = null;
  @property(Label) public initialLabel: Label | null = null;
  @property(Node) public actionButton: Node | null = null;
  @property(Label) public actionLabel: Label | null = null;
  public render(card: DeepReadonly<SocialCard>): void {
    if (!this.titleLabel || !this.detailLabel || !this.badgeLabel || !this.avatar || !this.initialLabel || !this.actionButton || !this.actionLabel) throw new Error('Social row binding is missing');
    this.titleLabel.string = card.title; this.detailLabel.string = card.detail; this.badgeLabel.string = card.badge;
    this.avatar.color = new Color(card.avatarColor); this.initialLabel.string = [...card.name][0] ?? '伙';
    this.actionLabel.string = card.button;
  }
}
