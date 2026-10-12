import { director, Director, game, Game } from 'cc';
import { SpeedBoostSession } from '../application/speedBoost';
import type { ColonySceneBootstrap } from '../bootstrap/colonySceneBootstrap';
import { ProgressPresentation } from './progressPresentation';
import type { TransportPresentation } from './transportPresentation';

/** Round-local rate and lifecycle; the durable time balance belongs to progress. */
export class SpeedBoostPresentation {
  private readonly boost: SpeedBoostSession;
  private suspended = false;
  private fractionMs = 0;
  private skipResumeFrame = false;
  private disposed = false;
  private queuedExhaustion = false;
  private popupAttempt = false;
  private popupEpoch = 0;
  private readonly ownsRound: () => boolean;
  public constructor(private readonly context: ColonySceneBootstrap, private readonly transport: TransportPresentation) {
    this.boost = new SpeedBoostSession(context.progress!);
    const generation = context.generation, page = context.StateMachine.current, roundId = context.round?.id;
    this.ownsRound = () => !this.disposed && !context.destroyed && !context.navigating
      && context.generation === generation && context.StateMachine.current === page && context.round?.id === roundId
      && context.play?.snapshot().result === 'PLAYING';
    context.hudView!.bind(
      this.cycle,
      () => { void ProgressPresentation.open(context, 'settings'); },
      () => { void ProgressPresentation.open(context, 'leaderboard'); },
      () => {
        if (!context.gm?.available || context.destroyed || context.navigating || context.inputLocked || context.progressPopup) return;
        void ProgressPresentation.open(context, 'gm');
      },
      Boolean(context.gm?.available),
    );
    director.on(Director.EVENT_BEFORE_UPDATE, this.update, this);
    game.on(Game.EVENT_HIDE, this.hide, this);
    game.on(Game.EVENT_SHOW, this.show, this);
    this.render();
  }
  public dispose(): void {
    this.disposed = true;
    this.cancelExhaustion();
    director.off(Director.EVENT_BEFORE_UPDATE, this.update, this);
    game.off(Game.EVENT_HIDE, this.hide, this);
    game.off(Game.EVENT_SHOW, this.show, this);
    try { this.boost.stop(); } catch { this.context.hudView?.setFeedback('加速时间保存未完成'); }
    this.transport.setSpeedMultiplier(1);
  }
  public startFreeFinish(): void {
    this.cancelExhaustion();
    this.fractionMs = 0;
    try { this.boost.startFreeFinish(); } catch { this.context.hudView?.setFeedback('未用加速时间待保存，将自动重试'); }
    this.render();
  }
  public get evidence(): { multiplier: number; source: string; remainingMs: number } {
    return { multiplier: this.boost.multiplier, source: this.boost.source, remainingMs: this.boost.read().remainingMs };
  }
  public stopForNavigation(): void {
    this.cancelExhaustion();
    this.boost.stop();
    this.fractionMs = 0;
    this.render();
  }
  public refreshBalance(): void {
    if (this.boost.source === 'freeFinish') this.startFreeFinish();
    else this.stopForNavigation();
  }
  private readonly cycle = (): void => {
    if (this.context.inputLocked || !this.ownsRound()) return;
    try {
      const exhausted = this.boost.cycle();
      this.suspended = false;
      this.fractionMs = 0;
      this.render();
      if (exhausted) this.queuedExhaustion = true;
      else this.cancelExhaustion();
      this.tryShowExhaustion();
    } catch { this.fail(); }
  };
  private readonly update = (): void => {
    if (this.suspended || this.disposed) return;
    try {
      if (this.skipResumeFrame) { this.skipResumeFrame = false; this.render(); this.tryShowExhaustion(); return; }
      const timed = this.boost.multiplier !== 1 && this.boost.source === 'manual';
      const consuming = timed && this.transport.evidence.activeWorkers > 0;
      this.fractionMs = consuming ? this.fractionMs + director.getDeltaTime() * 1000 : 0;
      const ms = Math.floor(this.fractionMs);
      this.fractionMs -= ms;
      this.boost.advance(ms, consumed => this.context.dailyActivity?.boost(consumed));
      this.render();
      if (timed && this.boost.multiplier === 1 && this.boost.read().remainingMs === 0) this.queuedExhaustion = true;
      this.tryShowExhaustion();
    } catch { this.fail(); }
  };
  private stillExhausted(): boolean {
    return this.boost.source === 'manual' && this.boost.multiplier === 1 && this.boost.read().remainingMs === 0;
  }
  private cancelExhaustion(): void {
    this.queuedExhaustion = false;
    this.popupAttempt = false;
    this.popupEpoch++;
  }
  private tryShowExhaustion(): void {
    if (!this.queuedExhaustion || this.popupAttempt) return;
    if (!this.ownsRound() || !this.stillExhausted()) { this.cancelExhaustion(); return; }
    if (this.suspended || this.context.inputLocked || this.context.progressPopup) return;
    const epoch = this.popupEpoch;
    this.popupAttempt = true;
    void ProgressPresentation.open(this.context, 'speed', () => {
      if (epoch !== this.popupEpoch || !this.ownsRound()) return;
      try { this.render(); } catch { this.fail(); }
    }, () => epoch === this.popupEpoch && this.ownsRound() && this.stillExhausted()
      && !this.suspended && !this.context.inputLocked && !this.context.progressPopup)
      .then(accepted => { if (epoch === this.popupEpoch && accepted) this.queuedExhaustion = false; })
      .catch(() => { if (epoch === this.popupEpoch && this.ownsRound()) this.fail(); })
      .finally(() => { if (epoch === this.popupEpoch) this.popupAttempt = false; });
  }
  private render(): void {
    this.transport.setSpeedMultiplier(this.boost.multiplier);
    this.context.hudView!.setSpeedBoost(this.boost.multiplier, this.boost.read().remainingMs, this.boost.source);
  }
  private fail(): void {
    this.cancelExhaustion();
    if (this.boost.source === 'freeFinish') {
      this.transport.setSpeedMultiplier(3);
      this.context.hudView!.setSpeedBoost(3, 0, 'freeFinish');
      return;
    }
    try { this.boost.stop(); } catch { /* The already reserved second remains spent. */ }
    this.transport.setSpeedMultiplier(1);
    this.context.hudView!.setSpeedBoost(1, 0);
    this.context.hudView!.setFeedback('加速时间保存失败，请稍后重试');
    this.suspended = true;
  }
  private readonly hide = (): void => { this.suspended = true; this.fractionMs = 0; };
  private readonly show = (): void => { this.suspended = false; this.fractionMs = 0; this.skipResumeFrame = true; };
}
