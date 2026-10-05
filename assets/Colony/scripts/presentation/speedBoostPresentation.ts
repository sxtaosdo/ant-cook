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
  public constructor(private readonly context: ColonySceneBootstrap, private readonly transport: TransportPresentation) {
    this.boost = new SpeedBoostSession(context.progress!);
    context.hudView!.bind(
      this.cycle,
      () => { void ProgressPresentation.open(context, 'settings'); },
      () => { void ProgressPresentation.open(context, 'shop'); },
      () => { void ProgressPresentation.open(context, 'leaderboard'); },
    );
    director.on(Director.EVENT_BEFORE_UPDATE, this.update, this);
    game.on(Game.EVENT_HIDE, this.hide, this);
    game.on(Game.EVENT_SHOW, this.show, this);
    this.render();
  }
  public dispose(): void {
    director.off(Director.EVENT_BEFORE_UPDATE, this.update, this);
    game.off(Game.EVENT_HIDE, this.hide, this);
    game.off(Game.EVENT_SHOW, this.show, this);
    try { this.boost.stop(); } catch { this.context.hudView?.setFeedback('加速时间保存未完成'); }
    this.transport.setSpeedMultiplier(1);
  }
  public startFreeFinish(): void {
    this.fractionMs = 0;
    try { this.boost.startFreeFinish(); } catch { this.context.hudView?.setFeedback('未用加速时间待保存，将自动重试'); }
    this.render();
  }
  public get evidence(): { multiplier: number; source: string; remainingMs: number } {
    return { multiplier: this.boost.multiplier, source: this.boost.source, remainingMs: this.boost.read().remainingMs };
  }
  public stopForNavigation(): void {
    this.boost.stop();
    this.fractionMs = 0;
    this.render();
  }
  public refreshBalance(): void {
    if (this.boost.source === 'freeFinish') this.startFreeFinish();
    else this.stopForNavigation();
  }
  private readonly cycle = (): void => {
    if (this.context.inputLocked) return;
    try {
      const exhausted = this.boost.cycle(this.transport.moving);
      this.suspended = false;
      this.fractionMs = 0;
      this.render();
      if (exhausted) void ProgressPresentation.open(this.context, 'speed', () => { try { this.render(); } catch { this.fail(); } });
    } catch { this.fail(); }
  };
  private readonly update = (): void => {
    if (this.suspended) return;
    try {
      if (this.skipResumeFrame) { this.skipResumeFrame = false; this.render(); return; }
      const moving = this.transport.moving && this.boost.multiplier !== 1 && this.boost.source === 'manual';
      this.fractionMs = moving ? this.fractionMs + director.getDeltaTime() * 1000 : 0;
      const ms = Math.floor(this.fractionMs);
      this.fractionMs -= ms;
      this.boost.advance(ms, moving, consumed => this.context.dailyActivity?.boost(consumed));
      this.render();
    } catch { this.fail(); }
  };
  private render(): void {
    this.transport.setSpeedMultiplier(this.boost.multiplier);
    this.context.hudView!.setSpeedBoost(this.boost.multiplier, this.boost.read().remainingMs, this.boost.source);
  }
  private fail(): void {
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
