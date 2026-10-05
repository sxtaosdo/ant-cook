import { PlayerProgress, PROGRESS_SAVE_KEY, type PlayerProgressSnapshot } from '../application/playerProgress';
import type { LeaderboardConfig } from '../application/leaderboard/leaderboard';
import type { SocialConfig } from '../application/social/social';

/** Only the cloned snapshot and subsequent writes exist in this private Map. */
export class GmTestProfile {
  public readonly progress: PlayerProgress;
  public constructor(snapshot: PlayerProgressSnapshot, leaderboard: LeaderboardConfig, social: SocialConfig, now: () => number) {
    const values = new Map([[PROGRESS_SAVE_KEY, JSON.stringify(snapshot)]]);
    this.progress = new PlayerProgress({ testOnly: true,
      read: key => values.get(key) ?? null,
      write: (key, value) => { values.set(key, value); },
    }, { now }, leaderboard, social);
  }
}
