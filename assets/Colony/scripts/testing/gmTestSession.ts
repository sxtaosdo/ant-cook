import { DEBUG, PREVIEW } from 'cc/env';
import type { ColonySceneBootstrap } from '../bootstrap/colonySceneBootstrap';
import type { PlayerProgress } from '../application/playerProgress';
import { RewardedAds } from '../application/rewardedAds';
import { PlayState } from '../presentation/pageStates/playState';
import { GmTestProfile } from './gmTestProfile';

/** Developer commands share the normal game and MK pages, using an isolated save owner. */
export class GmTestSession {
  private original: PlayerProgress | null = null;
  private originalAds: RewardedAds | null = null;
  private transitioning = false;
  public constructor(private readonly context: ColonySceneBootstrap) {}
  public get available(): boolean { return DEBUG || PREVIEW; }
  public get active(): boolean { return this.original !== null; }
  public async enter(): Promise<void> {
    this.guard();
    if (this.active) return;
    if (this.transitioning) throw new Error('正在切换测试档');
    const ctx = this.context;
    if (!ctx.progress || !ctx.leaderboardConfig || !ctx.socialConfig) throw new Error('游戏未准备完成');
    if (ctx.ads?.hasPendingReward()) throw new Error('视频奖励待保存，请先重试领取');
    this.transitioning = true;
    try {
      const round = ctx.round;
      ctx.ads?.cancel();
      await PlayState.goHome(ctx);
      if (PlayState.current(ctx) || ctx.app.error) throw new Error('当前对局未能安全结束');
      const profile = new GmTestProfile(ctx.progress.snapshot(), ctx.leaderboardConfig, ctx.socialConfig, () => Date.now());
      this.original = ctx.progress;
      this.originalAds = ctx.ads;
      ctx.progress = profile.progress;
      ctx.ads = new RewardedAds(null, {}, () => ctx.round?.id ?? '');
      if (round?.mode === 'daily') await PlayState.enterDaily(ctx);
      else if (round) await PlayState.enterLevel(ctx, round.levelId);
      else await PlayState.goHome(ctx);
    } finally { this.transitioning = false; }
  }
  public async exit(): Promise<void> {
    this.guard();
    if (!this.original) return;
    if (this.transitioning) throw new Error('正在切换测试档');
    this.transitioning = true;
    try {
      await PlayState.goHome(this.context);
      if (PlayState.current(this.context)) throw new Error('测试对局未能结束');
      this.context.ads?.dispose();
      this.context.progress = this.original;
      this.context.ads = this.originalAds;
      this.original = null;
      this.originalAds = null;
      await PlayState.goHome(this.context);
    } finally { this.transitioning = false; }
  }
  public async run(action: string, selectedLevel?: number): Promise<void> {
    this.guard();
    if (!this.active || this.transitioning) throw new Error('请先进入GM测试档');
    const ctx = this.context;
    const level = selectedLevel ?? ctx.round?.levelId ?? ctx.play!.snapshot().level;
    if (action === 'exit') { await this.exit(); return; }
    if (action === 'home') { await PlayState.goHome(ctx); return; }
    if (action === 'level') {
      if (!Number.isInteger(level) || level < 1 || level > 60) throw new Error('关卡范围为1–60');
      await PlayState.enterLevel(ctx, level); return;
    }
    if (action === 'next') {
      if (ctx.round?.mode === 'daily' || level >= 60) throw new Error('当前没有下一关');
      await PlayState.enterLevel(ctx, level + 1); return;
    }
    if (action === 'restart') {
      if (ctx.round?.mode === 'daily') await PlayState.enterDaily(ctx);
      else await PlayState.enterLevel(ctx, level);
      return;
    }
    if (action === 'coins' || action === 'diamonds' || action === 'speed') {
      if (action === 'speed') PlayState.current(ctx)?.refreshBoostBalance();
      ctx.progress!.applyTestResources(action);
      const resources = ctx.progress!.snapshot();
      ctx.hudView?.setResources(resources.coins, resources.diamonds);
      ctx.homeView?.refresh(ctx.progress!);
      return;
    }
    if (action === 'success' || action === 'fail') {
      const page = PlayState.current(ctx);
      if (!page) throw new Error('请先进入一个关卡');
      await page.showResultPreview(action === 'success'); return;
    }
    throw new Error('未知GM操作');
  }
  private guard(): void { if (!this.available || this.context.destroyed) throw new Error('GM仅在开发与Preview可用'); }
}
