import { _decorator, Color, Component, Label, Node, Sprite } from 'cc';
import type { LeaderboardEntry } from '../../../scripts/application/leaderboard/leaderboard';

const { ccclass, property } = _decorator;

@ccclass('ColonyLeaderboardRow')
export class ColonyLeaderboardRow extends Component {
  @property(Sprite) public background: Sprite | null = null;
  @property(Label) public rank: Label | null = null;
  @property(Sprite) public avatar: Sprite | null = null;
  @property(Label) public initial: Label | null = null;
  @property(Label) public playerName: Label | null = null;
  @property(Label) public progress: Label | null = null;
  @property(Label) public change: Label | null = null;
  @property(Node) public visitName: Node | null = null;

  public render(entry: LeaderboardEntry): void {
    if (!this.background || !this.rank || !this.avatar || !this.initial || !this.playerName || !this.progress || !this.change || !this.visitName) {
      throw new Error('Leaderboard row binding is missing');
    }
    this.background.color = new Color(entry.isSelf ? '#FFE2A7' : '#FFF9EB');
    this.rank.string = `${entry.rank}`;
    this.rank.color = new Color(entry.rank === 1 ? '#B77B17' : entry.rank === 2 ? '#7E8992' : entry.rank === 3 ? '#A76836' : '#654632');
    this.avatar.color = new Color(entry.avatarColor);
    this.initial.string = [...entry.name][0]!;
    this.playerName.string = entry.name;
    this.progress.string = `${entry.cleared} 关`;
    this.change.string = entry.isNew ? '新上榜' : entry.change > 0 ? `↑ ${entry.change}` : entry.change < 0 ? `↓ ${-entry.change}` : '—';
    this.change.color = new Color(entry.isNew ? '#B77B17' : entry.change > 0 ? '#328D73' : entry.change < 0 ? '#B76C60' : '#A69985');
  }
}
