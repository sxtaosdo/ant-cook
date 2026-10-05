import mk from 'mk';
import type { LeaderboardEntry } from '../../../scripts/application/leaderboard/leaderboard';
import type { SocialPage } from '../../../scripts/presentation/social/socialPresentation';

export interface ProgressRow {
  readonly title: string;
  readonly detail: string;
  readonly action: string;
  readonly button: string;
  readonly enabled: boolean;
  readonly stage?: number;
  readonly decoration?: string;
  readonly itemId?: string;
  readonly count?: number;
  readonly kind?: 'stall' | 'produce' | 'decoration';
  readonly target?: number;
  readonly iconPath?: string;
  readonly shopProduct?: { readonly diamonds: number; readonly priceYuan?: number; readonly claimed: boolean; readonly image: 'diamonds-small' | 'diamonds-bag' | 'diamonds-chest' };
  readonly basketItems?: readonly { readonly id: string; readonly name: string; readonly count: number; readonly kind: 'stall' | 'produce' | 'decoration'; readonly target: number; readonly iconPath: string }[];
}

export interface ProgressPage {
  readonly title: string;
  readonly summary: string;
  readonly rows: readonly ProgressRow[];
  readonly layout?: 'confirm' | 'collection' | 'leaderboard' | 'social' | 'settings' | 'shop' | 'gm';
  readonly settings?: { readonly soundEnabled: boolean; readonly musicEnabled: boolean; readonly inRound: boolean; readonly version: string; readonly userId: string; readonly gmAvailable: boolean };
  readonly leaderboard?: { readonly entries: readonly LeaderboardEntry[]; readonly self: LeaderboardEntry; readonly canVisit?: boolean };
  readonly social?: SocialPage;
  readonly showBack?: boolean;
  readonly activeTab?: 'themes' | 'task-achievements' | 'daily';
}

/** 仅持有当前弹窗的投影，不持有玩家存档。 */
export class ProgressModel extends mk.MVCModelBase {
  public page: ProgressPage = { title: '', summary: '', rows: [] };
  public feedback = '';
}
