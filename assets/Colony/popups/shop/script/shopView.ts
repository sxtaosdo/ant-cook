import { _decorator, Label, Node } from 'cc';
import { ColonyPopupView } from '../../progress/script/popupView';
import { VirtualScrollView } from '../../../vendor/vscrollview/VScrollView';
import { ColonyShopRow } from './shopRow';
const { ccclass, property } = _decorator;

@ccclass('ColonyShopView')
export class ColonyShopView extends ColonyPopupView {
  @property(Label) public titleLabel: Label | null = null;
  @property(Label) public summaryLabel: Label | null = null;
  @property(Label) public feedbackLabel: Label | null = null;
  @property(Node) public closeButton: Node | null = null;
  @property(Node) public backButton: Node | null = null;
  @property(VirtualScrollView) public list: VirtualScrollView | null = null;
  private listTitle = '';

  protected prepareOpen(): void { this.listTitle = ''; }
  public render(): void {
    const { page, feedback } = this._model;
    if (page.layout !== 'shop' || !this.titleLabel || !this.summaryLabel || !this.feedbackLabel || !this.closeButton || !this.backButton || !this.list) {
      throw new Error('Shop popup binding is missing');
    }
    this.titleLabel.string = page.title; this.summaryLabel.string = page.summary;
    this.summaryLabel.node.active = Boolean(page.summary);
    this.feedbackLabel.node.active = Boolean(feedback); this.feedbackLabel.string = feedback;
    this.backButton.active = page.showBack !== false;
    this.bind(this.closeButton, true, () => this.event.emit('close'));
    this.bind(this.backButton, true, () => this.event.emit('action', 'back'));
    const revision = this.revision, rows = page.rows;
    this.list.renderItemFn = (node, index) => {
      if (revision !== this.revision || !this.isAvailable()) return;
      const card = node.getComponent(ColonyShopRow), row = rows[index];
      if (!card || !row) throw new Error('Shop list row is missing');
      card.render(row); this.bind(card.actionButton!, row.enabled, () => this.event.emit('action', row.action));
    };
    this.list.refreshList(page.rows.length);
    if (this.listTitle !== page.title) this.list.scrollToTop(false);
    this.listTitle = page.title;
  }
}
