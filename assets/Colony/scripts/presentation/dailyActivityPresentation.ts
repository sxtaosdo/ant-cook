import { director, Director, game, Game } from 'cc';
import { DailyActivityBuffer } from '../application/dailyActivity';
import { ProgressControl } from '../../popups/progress/script/progressControl';
import type { ColonySceneBootstrap } from '../bootstrap/colonySceneBootstrap';

/** Cocos supplies foreground observations; PlayerProgress owns durable counters. */
export class DailyActivityPresentation {
  private readonly buffer: DailyActivityBuffer;
  private hidden = false;
  private boostedMs = 0;
  private readonly tools: { roundId: string; tool: string; occurredAt: number }[] = [];
  constructor(private readonly context: ColonySceneBootstrap) {
    this.buffer = new DailyActivityBuffer(context.progress!.snapshot().daily.tasks.timeReceipt, performance.now(), Date.now());
    director.on(Director.EVENT_AFTER_UPDATE, this.update, this);
    game.on(Game.EVENT_HIDE, this.hide, this); game.on(Game.EVENT_SHOW, this.show, this);
  }
  public boost(ms: number): void { if (!this.hidden && !this.context.gm?.active) this.boostedMs += ms; }
  public tool(roundId: string, tool: string): void {
    if (this.context.gm?.active) return;
    this.tools.push({ roundId, tool, occurredAt: Date.now() }); this.flush();
  }
  public flush(): void {
    try {
      this.flushForExit();
    } catch { this.context.hudView?.setFeedback('任务进度待保存，将自动重试'); }
  }
  public flushForExit(): void {
    if (this.context.gm?.active) return;
    this.sample();
    while (this.tools.length) { const event = this.tools[0]!; this.context.progress!.recordDailyTool(event.roundId, event.tool, event.occurredAt); this.tools.shift(); }
    this.buffer.flush(receipt => this.context.progress!.recordDailyTime(receipt));
    if (this.context.progressPopup instanceof ProgressControl) this.context.progressPopup.refresh();
  }
  private readonly update = (): void => {
    this.sample();
    if (this.buffer.due || this.tools.length) this.flush();
  };
  private sample(): void {
    const c = this.context;
    const ready = Boolean(c.homeView?.node.activeInHierarchy || c.playRoot?.activeInHierarchy || c.constructionView?.node.activeInHierarchy);
    this.buffer.sample(performance.now(), Date.now(), !this.hidden && !c.gm?.active && ready, this.boostedMs);
    this.boostedMs = 0;
  }
  private readonly hide = (): void => { this.update(); this.hidden = true; this.flush(); };
  private readonly show = (): void => { this.hidden = false; this.boostedMs = 0; this.buffer.reset(performance.now(), Date.now()); };
  public dispose(flush = true): void {
    if (flush) { this.update(); this.flush(); }
    director.off(Director.EVENT_AFTER_UPDATE, this.update, this); game.off(Game.EVENT_HIDE, this.hide, this); game.off(Game.EVENT_SHOW, this.show, this);
  }
}
