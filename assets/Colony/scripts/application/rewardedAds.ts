export type AdPlacement = 'clear' | 'supply' | 'speed';
export type AdStatus = 'completed' | 'cancelled' | 'failed' | 'pending' | 'unavailable' | 'busy' | 'disposed' | 'stale';

export interface RewardedVideo {
  load(): Promise<unknown>;
  show(): Promise<unknown>;
  onClose(callback: (result?: { isEnded?: boolean }) => void): void;
  offClose(callback: (result?: { isEnded?: boolean }) => void): void;
  onError(callback: (error: unknown) => void): void;
  offError(callback: (error: unknown) => void): void;
  destroy?(): void;
}

export interface WeChatAdsPort {
  createRewardedVideoAd(options: { adUnitId: string; multiton: true }): RewardedVideo;
}

/** Platform completion only. Reward limits and the durable ledger belong to player progress. */
export class RewardedAds {
  private active: { placement: AdPlacement; finish: (status: AdStatus) => void } | null = null;
  private disposed = false;
  private pending: { roundId: string; placement: AdPlacement; requestKey: string; complete: () => void } | null = null;

  constructor(
    private readonly platform: WeChatAdsPort | null,
    private readonly units: Partial<Record<AdPlacement, string>>,
    private readonly getRoundId: () => string,
  ) {}

  request(placement: AdPlacement, onComplete: () => void, requestKey: string = placement): Promise<AdStatus> {
    if (this.disposed) return Promise.resolve('disposed');
    if (this.active) return Promise.resolve('busy');
    if (this.pending) {
      if (this.pending.roundId !== this.owner(placement)) return Promise.resolve('stale');
      if (this.pending.placement !== placement || this.pending.requestKey !== requestKey) return Promise.resolve('pending');
      return Promise.resolve(this.commitPending());
    }
    const adUnitId = this.units[placement]?.trim();
    if (!this.platform || !adUnitId) return Promise.resolve('unavailable');
    const roundId = this.owner(placement);
    let video: RewardedVideo;
    try {
      video = this.platform.createRewardedVideoAd({ adUnitId, multiton: true });
    } catch {
      return Promise.resolve('failed');
    }
    return new Promise<AdStatus>((resolve) => {
      let finished = false;
      let shown = false;
      const finish = (status: AdStatus) => {
        if (finished) return;
        finished = true;
        this.active = null;
        try { video.offClose(close); } catch { /* Platform teardown must not prevent settlement. */ }
        try { video.offError(error); } catch { /* Platform teardown must not prevent settlement. */ }
        try { video.destroy?.(); } catch { /* Already destroyed by the platform. */ }
        if (status === 'completed') {
          if (this.owner(placement) !== roundId) status = 'stale';
          else {
            this.pending = { roundId, placement, requestKey, complete: onComplete };
            status = this.commitPending();
          }
        }
        resolve(status);
      };
      const close = (result?: { isEnded?: boolean }) => {
        finish(shown && result?.isEnded === true ? 'completed' : 'cancelled');
      };
      const error = (_error: unknown) => finish('failed');
      this.active = { placement, finish };
      try {
        video.onClose(close);
        video.onError(error);
        void Promise.resolve().then(() => {
          if (!finished) return video.load();
        }).then(() => {
          if (finished) return;
          shown = true;
          return video.show();
        }).catch(() => finish('failed'));
      } catch {
        finish('failed');
      }
    });
  }

  /** The original callback keeps its reward ID and tool selection across persistence retries. */
  private commitPending(): AdStatus {
    try {
      this.pending!.complete();
      this.pending = null;
      return 'completed';
    } catch {
      return 'pending';
    }
  }

  hasPendingReward(): boolean { return this.pending !== null; }
  isShowing(): boolean { return this.active !== null; }
  pendingRequestKey(placement: AdPlacement): string | null { return this.pending?.placement === placement ? this.pending.requestKey : null; }
  available(placement: AdPlacement): boolean { return !this.disposed && Boolean(this.platform && this.units[placement]?.trim()); }
  isShowingSpeed(): boolean { return this.active?.placement === 'speed'; }
  private owner(placement: AdPlacement): string { return placement === 'speed' ? 'speed' : this.getRoundId(); }

  cancel(): void {
    this.active?.finish('cancelled');
  }

  dispose(): void {
    this.disposed = true;
    this.active?.finish('disposed');
  }
}
