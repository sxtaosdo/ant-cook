import { _decorator, Label, Node, UITransform, view } from 'cc';
import { ColonyPopupView } from '../../progress/script/popupView';
import { VirtualScrollView } from '../../../vendor/vscrollview/VScrollView';
import type { LeaderboardEntry } from '../../../scripts/application/leaderboard/leaderboard';
import { ColonyLeaderboardRow } from './leaderboardRow';

const { ccclass, property } = _decorator;

@ccclass('ColonyLeaderboardView')
export class ColonyLeaderboardView extends ColonyPopupView {
  @property(Node) public panel: Node | null = null;
  @property(Label) public title: Label | null = null;
  @property(Label) public summary: Label | null = null;
  @property(Node) public closeButton: Node | null = null;
  @property(VirtualScrollView) public leaderboardList: VirtualScrollView | null = null;
  @property(ColonyLeaderboardRow) public leaderboardSelf: ColonyLeaderboardRow | null = null;
  @property(Node) public hint: Node | null = null;
  @property public maximumHeight = 1200;
  @property public viewportMargin = 120;
  @property public embeddedMode = false;

  public render(): void {
    const board = this._model.page.leaderboard;
    if (!board || !this.panel || !this.title || !this.summary || (!this.embeddedMode && !this.closeButton) || !this.leaderboardList || !this.leaderboardSelf || !this.hint) {
      throw new Error('Leaderboard popup binding is missing');
    }
    // Only the available viewport changes; fixed positions and margins belong to Widgets in the Prefab.
    if (!this.embeddedMode) this.panel.getComponent(UITransform)!.height = Math.min(this.maximumHeight, view.getVisibleSize().height - this.viewportMargin);
    this.title.string = this._model.page.title;
    this.summary.string = this._model.page.summary;
    if (!this.embeddedMode) this.bind(this.closeButton!, true, () => this.event.emit('close'));
    this.leaderboardList.renderItemFn = (card, index) => this.renderRow(card.getComponent(ColonyLeaderboardRow)!, board.entries[index]!);
    this.leaderboardList.refreshList(board.entries.length);
    this.leaderboardList.scrollToTop(false);
    this.renderRow(this.leaderboardSelf, board.self);
  }

  private renderRow(row: ColonyLeaderboardRow, entry: LeaderboardEntry): void {
    if (!row) throw new Error('Leaderboard row component is missing');
    row.render(entry);
    for (const node of [row.avatar!.node, row.visitName!]) {
      this.bind(node, !entry.isSelf && Boolean(this._model.page.leaderboard?.canVisit), () => this.event.emit('action', `partner:${entry.id}`));
    }
  }
}
