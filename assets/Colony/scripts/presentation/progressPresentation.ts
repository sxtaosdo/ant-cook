import mk from 'mk';
import { ModuleEntryGate } from '../../../shell/contracts';
import { ProgressControl } from '../../popups/progress/script/progressControl';
import type { ProgressNavigation, ProgressViewType } from '../../popups/progress/script/progressControl';
import { ColonyProgressView } from '../../popups/progress/script/progressView';
import { ColonyCommunityView } from '../../popups/progress/script/communityView';
import { CommunityControl } from '../../popups/progress/script/communityControl';
import { ColonySettingsView } from '../../popups/settings/script/settingsView';
import { ColonyConfirmView } from '../../popups/confirm/script/confirmView';
import { ColonyShopView } from '../../popups/shop/script/shopView';
import { ToolControl } from '../../popups/tool/script/toolControl';
import { ColonyToolView } from '../../popups/tool/script/toolView';
import type { ProgressPage, ProgressRow } from '../../popups/progress/script/progressModel';
import { swallowMkInterrupt } from '../../popups/resultPopupNav';
import { ACHIEVEMENTS, COLLECTIONS, SEASON_XP_PER_TIER, WEEKEND_THRESHOLDS, TOOL_PRODUCTS } from '../application/playerProgress';
import type { SupplyTool } from '../application/playerProgress';
import { COLONY_BUILD_VERSION } from '../application/buildInfo';
import { AD_BOOST_MS, FREE_BOOST_MS } from '../application/speedBoost';
import { DAILY_TASKS } from '../application/dailyTasks';
import { DIAMOND_PRODUCTS } from '../application/payment';
import { themeForLevel } from '../application/operationalLevels';
import { readCollectionObject } from '../application/collectionObject';
import type { ColonySceneBootstrap } from '../bootstrap/colonySceneBootstrap';
import { PlayState } from './pageStates/playState';
import { ConstructionState } from './pageStates/constructionState';
import { SocialPresentation } from './social/socialPresentation';

export type ProgressSection = 'market' | 'tasks' | 'task-achievements' | 'themes' | 'theme-detail' | 'theme-levels' | 'object-detail' | 'tracked-object' | 'daily' | 'orders' | 'newcomer' | 'stages' | 'collection' | 'achievements' | 'events' | 'weekend' | 'season' | 'return' | 'decorations' | 'levels' | 'shop' | 'settings' | 'leaderboard' | 'social' | 'speed' | 'gm' | 'confirm-gm' | 'confirm-home' | 'confirm-restart' | `tool-${SupplyTool | 'slot'}`;
const row = (title: string, detail: string, action: string, button: string, enabled = true): ProgressRow => ({ title, detail, action, button, enabled });
const date = (time: number): string => new Date(time + 8 * 3600000).toISOString().slice(0, 10);

/** 导航与命令留在表现协调层；MK 弹窗只接收投影。 */
export class ProgressPresentation {
  private themeIndex = 0;
  private objectId = '';
  private control: ProgressControl | ToolControl | CommunityControl | null = null;
  private returnSection: ProgressSection | null = null;
  private social: SocialPresentation | null = null;
  private pendingGm: { action: string; level: number } | null = null;
  private cancelled = false;
  private readonly toolPurchaseIds = new Map<SupplyTool, string>();
  private purchaseId(tool: SupplyTool): string {
    let id = this.toolPurchaseIds.get(tool);
    if (!id) { id = `tool-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; this.toolPurchaseIds.set(tool, id); }
    return id;
  }

  public static notifyPartnerUnlock(context: ColonySceneBootstrap): void {
    if (context.destroyed || !context.progress) return;
    try {
      const message = context.progress.takePartnerUnlockNotice();
      if (message) context.toast.show(message, 'feature-unlocked', 'social');
    } catch { /* Retain the pending notice for the next safe page or settlement. */ }
    try {
      const message = context.progress.takeTrackedObjectNotice();
      if (message) context.toast.show(message, 'collection-complete', message);
    } catch { /* Completion stays pending when saving its acknowledgement fails. */ }
  }

  constructor(private readonly context: ColonySceneBootstrap, private section: ProgressSection, private readonly onClosed?: () => void) {
    if (this.section === 'tasks') this.section = 'daily';
    if (this.section === 'tracked-object') {
      this.objectId = context.progress?.snapshot().trackedObjectId ?? '';
      this.section = this.objectId ? 'object-detail' : 'themes';
    }
  }

  public static open(context: ColonySceneBootstrap, section: ProgressSection, onClosed?: () => void): Promise<void>;
  /** Guarded page-local requests report whether a control was accepted. */
  public static open(context: ColonySceneBootstrap, section: ProgressSection, onClosed: (() => void) | undefined, canOpen: () => boolean): Promise<boolean>;
  public static async open(context: ColonySceneBootstrap, section: ProgressSection, onClosed?: () => void, canOpen?: () => boolean): Promise<void | boolean> {
    const generation = context.generation;
    const page = context.StateMachine?.current;
    if (canOpen && !canOpen()) return false;
    await context.guide?.cancel();
    if (context.destroyed || generation !== context.generation || page !== context.StateMachine?.current || (canOpen && !canOpen())) return false;
    if (section === 'market') { await ConstructionState.open(context); return true; }
    if (context.destroyed || !context.progress) return false;
    if (context.progressPopup) {
      if (section === 'shop') { await context.progressPopup.navigateToShop(); return true; }
      return false;
    }
    if (section === 'social') {
      if (!context.progress.socialAvailable()) { context.toast.show(context.progress.socialUnlockHint(), 'feature-locked', 'social'); return false; }
      context.progress.advanceSocial();
    }
    const presentation = new ProgressPresentation(context, section, onClosed);
    context.hudView?.hideRailBackground();
    context.dailyActivity?.flush();
    context.inputLocked = true;
    presentation.control = presentation.createControl();
    context.progressPopup = presentation.control;
    await presentation.waitForControl();
    return true;
  }

  private async waitForControl(): Promise<void> {
    const control = this.control;
    if (!control) return;
    try { await control.whenOpened(); }
    catch (cause) {
      try { await control.forceClose(); }
      catch (cleanup) { this.context.inputLocked = true; console.error(cleanup); return; }
      if (this.context.progressPopup === control) this.context.progressPopup = null;
      if (this.context.destroyed) return;
      this.context.hudView?.setFeedback('页面资源加载失败，请重试');
      this.context.app.setError({ code: 'INVALID_OPERATION', message: String(cause) });
    }
  }

  private createControl(): ProgressControl | ToolControl | CommunityControl {
    let owner: ProgressControl | ToolControl | CommunityControl;
    const navigation: ProgressNavigation = {
      read: () => this.read(), act: async action => {
        const owner = this.control;
        const generation = this.context.generation;
        let result: string;
        try { result = await this.act(action); }
        catch (cause) {
          if (action.startsWith('profile-save:') && !this.context.destroyed && generation === this.context.generation) {
            this.context.toast.show(cause instanceof Error ? cause.message : String(cause), 'profile-save-failed', 'profile');
          }
          throw cause;
        }
        if (owner && owner === this.control && this.context.progressPopup === owner
          && (owner instanceof ToolControl ? !this.section.startsWith('tool-') : owner.viewType !== this.progressViewType())) await this.switchControl();
        if (result && generation === this.context.generation && !this.context.destroyed && !this.context.ads?.hasPendingReward()) {
          this.context.toast.show(result, 'action', action);
          return '';
        }
        return result;
      },
      canClose: () => !this.context.ads?.hasPendingReward(),
      cleanupFailed: (cause, retryAvailable) => {
        if (retryAvailable) return;
        this.context.app.setError({ code: 'RUNTIME', message: `弹窗清理未完成且关闭入口不可用：${String(cause)}` });
        this.context.hudView?.setFeedback('弹窗清理未完成，页面保持锁定');
      },
      closing: () => { if (this.control === owner) this.cancelled = true; },
      closed: () => {
        if (this.context.progressPopup !== owner) return;
        this.context.progressPopup = null;
        if (this.control === owner) this.control = null;
        if (this.context.destroyed) { this.context.inputLocked = true; return; }
        this.context.inputLocked = this.context.play?.snapshot().result !== 'PLAYING';
        void PlayState.current(this.context)?.finishStoredSupplyPresentation().catch(cause => {
          this.context.app.setError({ code: 'INVALID_OPERATION', message: String(cause) });
          this.context.hudView?.setFeedback('库存已使用，显示待恢复');
        });
        // Resource cleanup has completed. A failed refresh/notification must not
        // become a cleanup failure with no remaining owner and locked input.
        try {
          this.context.homeView?.refresh(this.context.progress!);
          this.context.constructionView?.refreshSocialNotice(this.context.progress!.readSocial().unread);
          this.onClosed?.();
          if (this.context.homeView?.node?.activeInHierarchy && !this.context.progressPopup) this.context.guide?.open('home');
        } catch (cause) {
          this.context.app.setError({ code: 'INVALID_OPERATION', message: String(cause) });
          this.context.hudView?.setFeedback('页面刷新未完成，请重试');
        }
      },
    };
    owner = this.section.startsWith('tool-')
      ? new ToolControl(this.context.popupRoot!, navigation)
      : this.section === 'leaderboard' || this.section === 'social'
      ? new CommunityControl(this.context.popupRoot!, navigation)
      : new ProgressControl(this.context.popupRoot!, navigation, this.progressViewType());
    return owner;
  }

  private progressViewType(): ProgressViewType {
    if (this.section === 'leaderboard' || this.section === 'social') return ColonyCommunityView;
    if (this.section === 'settings') return ColonySettingsView;
    if (this.section === 'shop') return ColonyShopView;
    if (this.section.startsWith('confirm-')) return ColonyConfirmView;
    return ColonyProgressView;
  }

  private async switchControl(): Promise<void> {
    const releaseHold = this.context.currencyView?.holdDuringSwitch();
    try {
      const previous = this.control;
      const generation = this.context.generation;
      if (previous) await swallowMkInterrupt(Promise.resolve(previous.close()));
      if (this.cancelled || this.context.destroyed || this.context.generation !== generation
        || this.control !== previous || this.context.progressPopup !== previous) return;
      this.control = this.createControl();
      this.context.progressPopup = this.control;
      await this.waitForControl();
    } finally { releaseHold?.(); }
  }

  private read(): ProgressPage {
    const p = this.context.progress!;
    if (this.section === 'social') return this.socialPresentation().read();
    if (this.section === 'leaderboard') {
      const entries = this.context.profile?.leaderboard(p.readLeaderboard(), this.context.leaderboardConfig!.avatarColors) ?? p.readLeaderboard();
      return { title: '排行榜', summary: '虚拟伙伴 · 同进度先达到者在前\n主线首通排名 · 升降相对上次更新', rows: [], layout: 'leaderboard', showBack: false,
        leaderboard: { entries, self: entries.find(entry => entry.isSelf)!, canVisit: p.socialAvailable() } };
    }
    const s = p.snapshot();
    const unlock = p.availability();
    let summary = `金币 ${s.coins}    钻石 ${s.diamonds}\n${s.clockRolledBack ? '时间回退：每日领奖暂缓' : `${s.clearedLevels.length}/60 关 · 连胜 ${s.streak}`}`;
    let title = '';
    let rows: ProgressRow[] = [];
    switch (this.section) {
      case 'themes': {
        title = '收集 · 主题摊位';
        summary = '蚂蚁收集摊位、果蔬与装饰\n每主题12关，收集成果永久展示';
        rows = p.themeBasketProgress().map((basket, index) => {
          const collected = basket.items.reduce((total, item) => total + item.count, 0);
          const target = basket.items.reduce((total, item) => total + item.target, 0);
          const stall = basket.items.find(item => item.kind === 'stall')!;
          return { ...row(basket.name, basket.unlocked ? `已收集 ${collected}/${target} 件${collected === target ? ' · 已集齐' : ''}` : '集齐前一主题后开放', `theme:${index}`, basket.unlocked ? '查看摊位' : '预览'), basketItems: basket.items, itemId: stall.id, iconPath: stall.iconPath, kind: stall.kind, count: stall.count, target: stall.target };
        });
        break;
      }
      case 'theme-detail': {
        const basket = p.themeBasketProgress()[this.themeIndex];
        title = `${basket.name} · 收集清单`;
        summary = basket.unlocked ? `已收集 ${basket.cleared}/${basket.items.reduce((sum, item) => sum + item.target, 0)} 件 · 通关自动展示\n重玩不重复增加` : '集齐前一主题后开放\n现在可以预览本主题的收集物';
        rows = basket.items.map(item => ({ ...row(item.name, `${item.count}/${item.target}${item.count >= item.target ? ' · 已集齐' : ''}${s.trackedObjectId === item.id ? ' · 正在追踪' : ''}`, `object:${item.id}`, '详情'), itemId: item.id, count: item.count, target: item.target, kind: item.kind, iconPath: item.iconPath }));
        rows.push(row('主题摊位', '查看已经摆上摊位的收集成果', `stall:${this.themeIndex}`, '查看摊位'));
        const next = Array.from({ length: 12 }, (_, i) => this.themeIndex * 12 + i + 1).find(levelId => !s.clearedLevels.includes(levelId) && levelId <= p.nextLevel());
        if (basket.unlocked && next !== undefined) rows.push(row('下一件收集物', `完成第 ${next} 关，收集${themeForLevel(next)?.item.name ?? '物品'}`, `level:${next}`, '去收集'));
        if (basket.unlocked) rows.push(row(basket.cleared === 12 ? '本主题已集齐' : '本主题关卡', `第 ${this.themeIndex * 12 + 1}—${this.themeIndex * 12 + 12} 关 · 重玩不重复收集`, 'section:theme-levels', '查看关卡'));
        break;
      }
      case 'theme-levels': {
        const basket = p.themeBasketProgress()[this.themeIndex];
        title = `${basket.name} · 补给路线`;
        summary = `${basket.cleared}/12 关已完成 · 每关一种收集目标\n通关后可免费重玩，不重复收集`;
        rows = Array.from({ length: 12 }, (_, i) => {
          const levelId = this.themeIndex * 12 + i + 1;
          const target = themeForLevel(levelId)?.item.name ?? '物品';
          const cleared = s.clearedLevels.includes(levelId);
          return row(`第 ${levelId} 关 · ${target}`, cleared ? '已收集 · 重玩不重复增加' : levelId > p.nextLevel() ? '完成前一关后解锁' : '首次通关展示到主题摊位', `level:${levelId}`, cleared ? '重玩' : '出发', levelId <= p.nextLevel());
        });
        break;
      }
      case 'object-detail': {
        const detail = readCollectionObject(s.clearedLevels, this.objectId);
        if (!detail) throw new Error('收集对象不存在');
        this.themeIndex = detail.themeIndex;
        title = `${detail.item.name} · 对象详情`;
        summary = `${detail.theme.name} · ${detail.count}/${detail.item.target} 件\n${detail.complete ? '已集齐，永久展示' : '主线首次通关收集'}`;
        const kinds = { stall: '主题摊位', produce: '果蔬收集物', decoration: '主题装饰' };
        rows = [{ ...row('这是什么', kinds[detail.item.kind], 'noop', '', false), itemId: detail.item.id, iconPath: detail.item.iconPath, kind: detail.item.kind, count: detail.count, target: detail.item.target },
          row('如何获得', `首次通关第 ${detail.sourceLevels.join('、')} 关，各收集1件\n确定获得，重玩和每日挑战不重复增加`, 'noop', '', false),
          row('真实用途', `${detail.purpose}\n不作为货币或可消耗道具`, `stall:${detail.themeIndex}`, '看摊位'),
          row('当前数量', `${detail.count}/${detail.item.target} 件 · 来自保存的首通记录`, 'noop', '', false),
          row('追踪目标', s.trackedObjectId === detail.item.id ? '首页正在关注此对象，可随时取消' : '一次关注一个对象，完成仅提示，不增发奖励', s.trackedObjectId === detail.item.id ? 'untrack-object' : `track-object:${detail.item.id}`, s.trackedObjectId === detail.item.id ? '取消追踪' : '追踪')];
        if (detail.nextLevel !== null) rows.push(row('下一步', detail.nextSource === detail.nextLevel ? `首次通关第 ${detail.nextLevel} 关收集下一件` : `先完成第 ${detail.nextLevel} 关，逐步解锁来源第 ${detail.nextSource} 关`, `level:${detail.nextLevel}`, '去收集'));
        else rows.push(row('下一步', '此对象已经集齐，可返回清单关注其他对象', `theme:${detail.themeIndex}`, '看清单'));
        break;
      }
      case 'market':
        title = '主题摊位';
        rows = [row('收集成果', '摊位、果蔬和装饰均由关卡收集', 'section:market', '查看摊位')];
        break;
      case 'daily':
        title = '每日任务';
        summary = `今日 ${s.daily.day}${s.clockRolledBack ? ' · 时间回退，领奖暂缓' : ''}\n每日目标和奖励在北京时间零点更新`;
        if (!unlock.daily) {
          summary = '完成第3关后开放每日签到';
          rows = [row('每日任务尚未开放', '先完成第3关，再来领取签到奖励', `level:${p.nextLevel()}`, '去闯关')];
          break;
        }
        rows.push(row(`累计签到 · 第 ${s.signInCount % 7 + 1} 档`, '每日20—60金币 · 第7档另送装饰券\n漏签不清零', 'signin', s.signInDays.includes(s.daily.day) ? '今日已签' : '签到', !s.signInDays.includes(s.daily.day)));
        if (unlock.orders) rows.push(row('每日目标 · 共60金币', '完成关卡、在线、道具与手动加速\n八项目标分别领取', 'section:orders', '查看'));
        else rows.push(row('每日目标', '完成第5关后开放 · 八项目标共60金币', 'noop', '未开放', false));
        if (unlock.challenge) rows.push(row('每日挑战', `${s.daily.day} · 无限免费重试\n${s.dailyCompleted.includes(s.daily.day) ? '今日首胜已领取，可再挑战' : '首次完成40金币'}`, 'challenge', '出发'));
        else rows.push(row('每日挑战', '完成第10关后开放 · 今日首胜奖励40金币', 'noop', '未开放', false));
        break;
      case 'levels':
        title = s.clearedLevels.length === 60 ? '本期补给完成 · 免费重玩' : '补给路线';
        rows = Array.from({ length: p.nextLevel() }, (_, i) => row(`第 ${i + 1} 关`, s.clearedLevels.includes(i + 1) ? '已完成 · 无首次奖励' : '首次完成40金币，并收集目标物品', `level:${i + 1}`, s.clearedLevels.includes(i + 1) ? '重玩' : '出发'));
        break;
      case 'orders': {
        title = '每日目标'; summary = '八项目标分别领取 · 每日共60金币\n免费收尾不计入加速任务';
        const tasks = s.daily.tasks;
        rows = DAILY_TASKS.map(t => {
          const divisor = t.kind === 'onlineMs' ? 60000 : t.kind === 'boostMs' ? 1000 : 1;
          const unit = t.kind === 'onlineMs' ? '分钟' : t.kind === 'boostMs' ? '秒' : t.kind === 'tools' ? '次' : '关';
          const done = tasks[t.kind] >= t.target, paid = tasks.claimed.includes(t.id);
          const enabled = unlock.orders && !s.clockRolledBack && done && !paid;
          return row(t.name, Math.floor(Math.min(tasks[t.kind], t.target) / divisor) + '/' + t.target / divisor + unit + ' · ' + t.coins + '金币', 'daily-task:' + t.id,
            paid ? '已领取' : done ? '领取' : '进行中', enabled);
        });
        break;
      }
      case 'stages':
        title = '主线阶段目标';
        summary = '主线首通累计 · 每份奖励只领一次\n跨天保留，重玩与每日挑战不重复推进';
        rows = p.readStageGoals().map(goal => {
          const ready = goal.progress >= goal.target;
          return row(goal.name, `首次通关 ${goal.progress}/${goal.target} 关 · ${goal.coins}金币`, `stage-goal:${goal.id}`,
            goal.claimed ? '已领取' : ready ? '领取' : '进行中', ready && !goal.claimed);
        });
        break;
      case 'newcomer':
        title = '七组新手目标';
        summary = unlock.daily ? '长期累计，不会每日重置\n每组完成后领取50金币' : '长期累计，不会每日重置\n完成第3关后开放领奖';
        rows = Array.from({ length: 7 }, (_, i) => { const goal = p.newcomerProgress(i); const canClaim = unlock.daily && goal.progress >= goal.target; return row(`${i + 1}. ${goal.name}`, `${Math.min(goal.progress, goal.target)}/${goal.target} · 奖励50金币${i === 2 ? ' +3印章' : ''}`, `newcomer:${i}`, s.newcomer.includes(i) ? '已领取' : canClaim ? '领取' : '进行中', !s.newcomer.includes(i) && canClaim); });
        break;
      case 'collection':
        title = '收藏与成就';
        rows = COLLECTIONS.map(item => row(item.name, `固定兑换 · ${item.cost}枚印章`, `collection:${item.id}`, s.collections.includes(item.id) ? '已收藏' : '兑换', !s.collections.includes(item.id) && s.stamps >= item.cost));
        rows.unshift(row('长期成就', `已领取 ${s.achievements.length}/${ACHIEVEMENTS.length} 项`, 'section:achievements', '查看'));
        break;
      case 'task-achievements':
      case 'achievements':
        title = '成就 · 长期目标';
        summary = '长期累计，不会每日重置\n完成目标后领取金币奖励';
        rows = ACHIEVEMENTS.map(item => row(item.name, `${{ wins: '完成主线配送', builds: '历史建设记录', transported: '搬运货物', challenges: '完成每日挑战' }[item.kind]} ${Math.min(s.totals[item.kind], item.target)}/${item.target} · 奖励 ${item.coins}金币`, `achievement:${item.id}`, s.achievements.includes(item.id) ? '已领取' : s.totals[item.kind] >= item.target ? '领取' : '进行中', !s.achievements.includes(item.id) && s.totals[item.kind] >= item.target));
        const stages = p.readStageGoals();
        const readyStages = stages.filter(goal => goal.progress >= goal.target && !goal.claimed).length;
        const nextStage = stages.find(goal => goal.progress < goal.target);
        rows.unshift(row('主线阶段目标', readyStages > 0 ? `${readyStages}份阶段奖励可领取 · 永久保留`
          : nextStage ? `下一站第${nextStage.target}关 · 首通累计，不按日重置` : '本期阶段目标全部完成 · 奖励只领一次', 'section:stages', '查看'));
        if (this.section === 'task-achievements') rows.unshift(row('七组新手目标', `已领取 ${s.newcomer.length}/7 组 · 长期累计，不限连续登录`, 'section:newcomer', '查看'));
        break;
      case 'events': {
        const cal = p.calendar(); title = '夜市活动';
        rows = [row('28日夜市季', `免费30级 · ${cal.season} 至 ${date(cal.seasonEnd)}零点`, 'section:season', '查看'), row('周末补给节', '北京时间每周五至周日\n主线首胜1分 · 每日挑战首胜5分', 'section:weekend', cal.weekend ? '进行中' : '周五开放', Boolean(cal.weekend))];
        if (s.returnVisit) rows.push(row('回归欢迎', '固定任务奖励，无需观看广告', 'section:return', '查看'));
        if (s.pendingMessages.length) rows.push(row('奖励补发', [...new Set(s.pendingMessages)].join('\n'), 'messages', '知道了'));
        break;
      }
      case 'weekend': {
        title = '周末补给节'; const key = p.calendar().weekend; const period = s.weekends[key];
        rows = WEEKEND_THRESHOLDS.map((target, i) => row(`累计 ${target} 积分`, `当前 ${period?.points ?? 0} 分 · ${['60金币', '100金币 +1印章', '2印章 +1装饰券'][i]}`, `weekend:${i}`, period?.claimed.includes(i) ? '已领取' : '领取', Boolean(period && period.points >= target && !period.claimed.includes(i))));
        break;
      }
      case 'season': {
        title = '免费夜市季'; const period = s.seasons[p.calendar().season];
        rows = Array.from({ length: 30 }, (_, i) => { const tier = i + 1; return row(`第 ${tier} 级 · ${tier * SEASON_XP_PER_TIER} 经验`, `当前 ${period?.points ?? 0} 经验 · ${tier === 30 ? '主题灯饰 +3印章' : tier % 5 === 0 ? '1枚印章' : '30金币'}`, `season:${tier}`, period?.claimed.includes(tier) ? '已领取' : '领取', Boolean(period && period.points >= tier * SEASON_XP_PER_TIER && !period.claimed.includes(tier))); });
        break;
      }
      case 'return':
        title = '欢迎回来';
        rows = [1, 3, 5].map((target, i) => row(`累计完成 ${target} 次配送`, `${s.returnVisit ? s.totals.validWins - s.returnVisit.baseline : 0}/${target} · ${[40,60,80][i]}金币 +1补给`, `return:${i}`, s.returnVisit?.claimed.includes(i) ? '已领取' : '领取', Boolean(s.returnVisit && !s.returnVisit.claimed.includes(i) && s.totals.validWins - s.returnVisit.baseline >= target)));
        break;
      case 'decorations':
        title = '收集装饰';
        summary = '灯笼、招牌和主题摆件都由关卡收集，通关后自动展示';
        rows = p.themeBasketProgress().map((basket, index) => row(basket.name, basket.items.filter(item => item.kind === 'decoration').map(item => `${item.name} ${item.count}/${item.target}`).join(' · '), `stall:${index}`, '查看摊位'));
        break;
      case 'shop':
        title = '补给商城';
        summary = `金币 ${s.coins} · 钻石 ${s.diamonds}\n库存与钻石/广告额外补给本局共享一次`;
        rows.push(...TOOL_PRODUCTS.map(product => {
          const claimed = p.hasToolPurchase(this.purchaseId(product.tool), product.tool);
          return { ...row(product.name, '永久库存 · 免费优先', `buy-tool:${product.tool}`, claimed ? '已购买' : `${product.coins}金币 ×1`, !claimed && s.coins >= product.coins),
            shopProduct: { kind: 'tool' as const, tool: product.tool, stock: s.toolInventory[product.tool], coins: product.coins, claimed, image: product.tool } };
        }));
        rows.push({ ...row('新老玩家体验礼包', '一次性体验礼包', 'starter-diamonds', s.starterDiamondsClaimed ? '已领取' : '免费领取', !s.starterDiamondsClaimed),
          shopProduct: { diamonds: 30, claimed: s.starterDiamondsClaimed, image: 'diamonds-small' } });
        rows.push(...DIAMOND_PRODUCTS.map((product, index) => ({ ...row('钻石补给', '充值暂未开放', `purchase:${product.id}`, `¥${product.priceYuan}`, false),
          shopProduct: { diamonds: product.diamonds, priceYuan: product.priceYuan, claimed: false, image: (['diamonds-small', 'diamonds-bag', 'diamonds-chest'] as const)[index]! } })));
        break;
      case 'speed': {
        const remainingMs = p.readSpeedBoost().remainingMs;
        const clockRolledBack = p.snapshot().clockRolledBack;
        const pending = Boolean(this.context.ads?.pendingRequestKey('speed'));
        const otherPending = !pending && Boolean(this.context.ads?.hasPendingReward());
        const showing = this.context.ads?.isShowing() ?? false;
        const available = this.context.ads?.available('speed') ?? false;
        const durationText = `${AD_BOOST_MS / 60000}分钟`;
        const seconds = Math.ceil(remainingMs / 1000);
        const remainingText = `剩余 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
        let detail = '完整观看视频后到账';
        if (pending) detail = '奖励待保存，重试无需再看视频';
        else if (otherPending) detail = '其他奖励待保存，请先重试原奖励';
        else if (clockRolledBack) detail = '时间回退，恢复正常时间后可领取';
        let button = '视频暂不可用';
        if (pending) button = '重试领取';
        else if (otherPending) button = '奖励待保存';
        else if (showing) button = '视频播放中';
        else if (clockRolledBack) button = '暂不可领取';
        else if (available) button = '观看视频';
        return { title: remainingMs === 0 ? '加速时间已用完' : '加速时间',
          summary: `每天0点赠送${FREE_BOOST_MS / 60000}分钟\n2倍、3倍共用时间，仅搬运时消耗`,
          rows: [row(`增加${durationText}加速时间`, detail, 'ad-speed', button,
            !showing && !otherPending && !clockRolledBack && (pending || available))],
          layout: 'speed', showBack: false, speed: { durationText, remainingText } };
      }
      case 'settings': {
        const inRound = Boolean(PlayState.current(this.context) && this.context.round);
        const profile = this.context.profile?.snapshot();
        return { title: '设置', summary: '', rows: [], layout: 'settings', showBack: false,
          settings: { soundEnabled: this.context.settings?.snapshot().soundEnabled !== false,
            musicEnabled: this.context.settings?.snapshot().musicEnabled !== false, inRound, version: `v${COLONY_BUILD_VERSION}`,
            userId: profile?.playerId ?? '暂不可用', gmAvailable: this.context.gm?.available ?? false,
            profile: profile ? { ...profile, avatarColor: this.context.leaderboardConfig!.avatarColors[profile.avatar], avatarColors: this.context.leaderboardConfig!.avatarColors } : undefined } };
      }
      case 'gm': {
        if (!this.context.gm?.available) throw new Error('GM仅在开发与Preview可用');
        const active = this.context.gm.active;
        const level = this.context.round?.levelId ?? this.context.play?.snapshot().level ?? 1;
        rows = [row('下一关', '直接跳转，不领取通关奖励', 'gm:next', '下一关', level < 60 && this.context.round?.mode !== 'daily'),
          row('指定关卡', '在上方输入1–60的主线关号', 'gm:level', '进入'), row('重新开始', '重开当前测试棋盘', 'gm:restart', '重开'),
          row('返回首页', '保持当前测试档', 'gm:home', '首页'), row('金币 +1000', '仅增加测试余额', 'gm:coins', '+1000'),
          row('钻石 +100', '仅增加测试余额', 'gm:diamonds', '+100'), row('倍速补足3分钟', '余额超过3分钟时保留', 'gm:speed', '补足'),
          row('胜利弹窗', '仅预览，不结算', 'gm:success', '预览', Boolean(this.context.round)), row('失败弹窗', '仅预览，不结算', 'gm:fail', '预览', Boolean(this.context.round)),
          row('退出测试档', '丢弃测试变化，恢复正式档并返回首页', 'gm:exit', '退出', active)];
        return { title: 'GM', summary: active ? '内存测试档 · 正式进度不变' : '开发工具 · 执行前进入隔离测试档', rows, layout: 'gm', showBack: false };
      }
      case 'confirm-gm':
        title = '进入GM测试档？'; summary = '';
        rows = [row('将结束当前棋盘', '正式进度不变，测试变化退出后丢弃', 'gm-confirm', '进入测试'), row('继续本局', '不切换档案', 'section:gm', '取消')];
        break;
      case 'confirm-home':
        title = '确认返回首页？';
        summary = '';
        rows = [row('当前棋盘不会保留', '长期进度、钻石和已领奖励不会丢失', 'confirm-home', '确认返回'), row('继续本局', '关闭设置并继续搬运', 'section:settings', '取消')];
        break;
      case 'confirm-restart':
        title = '确认重新开始？';
        summary = '';
        rows = [row('重新生成当前棋盘', '失败不扣资源；本局已使用的道具不会退还', 'confirm-restart', '确认重开'), row('继续本局', '关闭设置并继续搬运', 'section:settings', '取消')];
        break;
      case 'tool-trowel':
      case 'tool-compass':
      case 'tool-slot': {
        const tool = this.section.slice(5) as SupplyTool | 'slot';
        const used = Boolean(this.context.play?.usedToolList().includes(tool));
        const startingSupply = tool === 'slot' && !used && this.context.play?.snapshot().slots.length === 6;
        const names = { trowel: '小铲子', compass: '指南针', slot: '扩充槽位' };
        const details = { trowel: '清除一个当前暴露的货物格。没有暴露货物时不会消耗。', compass: '提示并选取一个当前可用、颜色匹配的数字块；不保证必胜。', slot: '本局由5个槽位增加到6个，最多只扩充一次。' };
        if (startingSupply) details.slot = '本局为补给关，开局已有6槽；不会消耗扩槽道具，也不能增加第7槽。';
        title = names[tool];
        rows.push(row('道具作用', details[tool], 'noop', '说明', false));
        if (startingSupply) rows.push(row('开局补给', '已获得6槽容量，不需要购买或观看广告', 'noop', '已获得', false));
        else if (!used) {
          const can = Boolean(this.context.play?.canUseTool(tool));
          rows.push(row('本局免费次数', can ? '确认后才使用，不会因打开弹窗而消耗' : '当前没有可生效的目标，不会消耗免费次数', `free-tool:${tool}`, can ? '免费使用' : '当前不可用', can));
        }
        else if (tool === 'slot') rows.push(row('本局已使用', '扩槽最多到6槽，不能再次购买或观看广告', 'noop', '已用完', false));
        else {
          const can = Boolean(this.context.play?.canUseExtraSupply(tool) && this.context.round && !s.rounds[this.context.round.id]?.extraSupply);
          rows.push(row('永久库存', `持有 ${s.toolInventory[tool]} 个 · 免费优先，本局额外共享一次`, `stored-supply:${tool}`, '库存使用', can && s.toolInventory[tool] > 0));
          if (s.supplyTokens > 0) rows.push(row('补给券', `持有 ${s.supplyTokens} 张 · 本局仅可额外使用一次`, `supply:${tool}`, '补给券使用', can));
          rows.push(row('自愿观看视频', this.context.hasAds ? '完整观看后使用；每日最多3次' : '当前没有配置广告位，免费玩法不受影响', `ad-supply:${tool}`, this.context.hasAds ? '看广告使用' : '广告暂不可用', can && this.context.hasAds));
          rows.push(row('钻石使用', `消耗10钻石 · 当前 ${s.diamonds} 钻`, `diamond-supply:${tool}`, s.diamonds >= 10 ? '10钻石使用' : '去商城', can));
        }
        break;
      }
    }
    return { title, summary, rows, layout: this.section === 'confirm-home' || this.section === 'confirm-restart' || this.section === 'confirm-gm' ? 'confirm' : this.section === 'shop' ? 'shop' : this.section === 'themes' || this.section === 'theme-detail' ? 'collection' : undefined,
      showBack: !this.section.startsWith('tool-') && !(['market', 'themes', 'task-achievements', 'daily', 'settings', 'speed'] as ProgressSection[]).includes(this.section) && (this.section !== 'shop' || Boolean(this.returnSection)),
      activeTab: this.section === 'themes' || this.section === 'task-achievements' || this.section === 'daily' ? this.section : undefined };
  }

  private async act(action: string): Promise<string> {
    const p = this.context.progress!;
    const [kind, value] = action.split(':');
    if (kind === 'product-navigation' && !this.context.ads?.hasPendingReward()) { ModuleEntryGate.require('ant').requestNavigation?.(); return ''; }
    if (this.context.ads?.hasPendingReward() && kind !== 'ad-supply' && kind !== 'ad-speed') {
      if (kind === 'profile-save') throw new Error('奖励待保存，请重试原广告领取，无需再看视频');
      return '奖励待保存，请重试原广告领取，无需再看视频';
    }
    if (kind === 'profile-save' && this.section === 'settings') {
      const edit: unknown = JSON.parse(decodeURIComponent(value));
      if (!edit || typeof edit !== 'object' || !('nickname' in edit) || typeof edit.nickname !== 'string' || !('avatar' in edit) || typeof edit.avatar !== 'number' || !this.context.profile) throw new Error('资料输入无效，请重试');
      try { this.context.profile.save(edit.nickname, edit.avatar); }
      catch (cause) { throw new Error(`资料保存未完成，请重试：${cause instanceof Error ? cause.message : String(cause)}`); }
      this.context.refreshProfile();
      return '资料已保存';
    }
    if (kind === 'gm' || kind === 'gm-confirm') {
      const gm = this.context.gm;
      if (!gm?.available) throw new Error('GM仅在开发与Preview可用');
      if (kind === 'gm' && !gm.active) {
        const level = value === 'level' ? Number(action.split(':')[2]) : this.context.round?.levelId ?? this.context.play?.snapshot().level ?? 1;
        if (!Number.isInteger(level) || level < 1 || level > 60) return '请输入1–60的关号';
        this.pendingGm = { action: value, level }; this.section = 'confirm-gm'; return '';
      }
      const request = kind === 'gm-confirm' ? this.pendingGm : { action: value, level: value === 'level' ? Number(action.split(':')[2]) : this.context.round?.levelId ?? this.context.play?.snapshot().level ?? 1 };
      if (!request) throw new Error('没有待执行GM操作');
      if (['coins', 'diamonds', 'speed'].includes(request.action) && gm.active) { await gm.run(request.action); return '仅测试档已更新'; }
      await this.close();
      if (!gm.active) await gm.enter();
      await gm.run(request.action, request.level);
      if (['coins', 'diamonds', 'speed'].includes(request.action)) await ProgressPresentation.open(this.context, 'gm');
      return '';
    }
    if (kind === 'settings-link' && (value === 'feedback' || value === 'agreement' || value === 'privacy')) return this.context.openSettingsLink(value);
    if (kind === 'toggle-music' || kind === 'toggle-sound') {
      if (kind === 'toggle-music') this.context.settings?.toggleMusic();
      else this.context.settings?.toggleSound();
      this.context.applyAudioSettings();
      return '';
    }
    if (kind === 'partner') {
      if (!p.socialAvailable()) { this.context.toast.show(p.socialUnlockHint(), 'feature-locked', 'social'); return ''; }
      this.socialPresentation().openPartner(value); this.returnSection = 'leaderboard'; this.section = 'social'; return '';
    }
    if (kind === 'community-tab') {
      if (value !== 'leaderboard' && value !== 'social') throw new Error('社区页面不存在');
      if (value === 'social' && !p.socialAvailable()) { this.context.toast.show(p.socialUnlockHint(), 'feature-locked', 'social'); return ''; }
      if (value === 'social') { p.advanceSocial(); this.socialPresentation().act('tab:partners'); }
      this.returnSection = null; this.section = value; return '';
    }
    if (kind === 'section') {
      if (value === 'market') { await this.close(); await ConstructionState.open(this.context); return ''; }
      if (value === 'shop' && this.section !== 'shop') this.returnSection = this.section;
      this.section = value === 'tasks' ? 'daily' : value as ProgressSection; return '';
    }
    if (this.section === 'social') {
      if (kind === 'dialogue-source') {
        this.socialPresentation().act('dialogue:source');
        this.objectId = this.socialPresentation().dialogueObjectId()!;
        this.returnSection = 'social'; this.section = 'object-detail'; return '';
      }
      if (kind === 'settings') { this.section = 'settings'; return ''; }
      if (kind === 'back' && this.returnSection === 'leaderboard' && this.socialPresentation().isProfile()) {
        this.section = 'leaderboard'; this.returnSection = null; return '';
      }
      const feedback = this.socialPresentation().act(action);
      this.context.homeView?.refresh(p);
      return feedback;
    }
    if (kind === 'theme') { this.themeIndex = Number(value); this.section = 'theme-detail'; return ''; }
    if (kind === 'object') {
      if (!readCollectionObject(p.snapshot().clearedLevels, value)) throw new Error('收集对象不存在');
      this.objectId = value; this.section = 'object-detail'; return '';
    }
    if (kind === 'track-object' || kind === 'untrack-object') {
      p.trackObject(kind === 'track-object' ? value : null);
      this.context.homeView?.refresh(p);
      return kind === 'track-object' ? '已在首页追踪此对象' : '已取消追踪';
    }
    if (kind === 'stall') { await this.close(); await ConstructionState.open(this.context, Number(value)); return ''; }
    if (['build', 'finish', 'decoration', 'equip'].includes(kind)) return '摊位和装饰改为关卡收集，不再花费资源';
    if (kind === 'back') {
      if (this.section === 'object-detail' && this.returnSection === 'social') {
        this.section = 'social'; this.returnSection = null; return '';
      }
      if (this.section === 'shop' && this.returnSection) { this.section = this.returnSection; this.returnSection = null; await this.switchControl(); }
      else this.section = this.section === 'theme-levels' || this.section === 'object-detail' ? 'theme-detail'
          : this.section === 'theme-detail' ? 'themes'
          : this.section === 'orders' ? 'daily'
          : this.section === 'newcomer' || this.section === 'stages' ? 'task-achievements'
        : this.section === 'season' || this.section === 'weekend' || this.section === 'return' ? 'events'
          : this.section === 'achievements' ? 'collection' : 'market';
      if (this.section === 'market') { await this.close(); await ConstructionState.open(this.context); }
      return '';
    }
    if (kind === 'ad-speed') {
      const ads = this.context.ads;
      if (!ads) return '视频暂不可用';
      if (ads.hasPendingReward() && !ads.pendingRequestKey('speed')) return '其他奖励待保存，请先重试原奖励';
      if (ads.isShowing()) return '视频播放中';
      // Re-evaluate the day/clock through the budget owner before offering a fresh video.
      p.readSpeedBoost();
      const s = p.snapshot();
      if (s.clockRolledBack) return '时间回退，恢复正常时间后可领取';
      const rewardId = ads.pendingRequestKey('speed') ?? `${s.daily.day}:${s.daily.boostAds}`;
      const page = PlayState.current(this.context), roundId = this.context.round?.id, generation = this.context.generation;
      const popupOwner = this.control;
      const status = await ads.request('speed', () => { p.grantSpeedBoostReward(rewardId); }, rewardId);
      if (status === 'completed') {
        if (page !== PlayState.current(this.context) || roundId !== this.context.round?.id || generation !== this.context.generation) return '';
        if (popupOwner && !this.cancelled && this.control === popupOwner && this.context.progressPopup === popupOwner) {
          await this.close();
          if (page !== PlayState.current(this.context) || generation !== this.context.generation) return '';
          this.onClosed?.();
        }
        if (page && this.context.play?.snapshot().result !== 'PLAYING') {
          await page.waitForTransportIdle();
          if (page === PlayState.current(this.context) && roundId === this.context.round?.id && roundId && !p.snapshot().rounds[roundId]?.settled)
            await page.showResult(this.context.play?.snapshot().result === 'SUCCESS');
        }
        return '';
      }
      return status === 'pending' ? '奖励待保存，请重试领取，无需再看视频' : status === 'unavailable' ? '视频暂不可用' : status === 'failed' ? '视频加载失败，请稍后重试' : '视频未完成，未增加时间';
    }
    if (kind === 'signin') p.claimSignIn();
    else if (kind === 'daily-task') { p.claimDailyTask(value); return '奖励已领取'; }
    else if (kind === 'stage-goal') { p.claimStageGoal(value); return '阶段奖励已领取'; }
    else if (kind === 'newcomer') p.claimNewcomer(Number(value));
    else if (kind === 'collection') p.redeemCollection(value);
    else if (kind === 'achievement') p.claimAchievement(value);
    else if (kind === 'weekend') p.claimWeekend(Number(value));
    else if (kind === 'season') p.claimSeason(Number(value));
    else if (kind === 'return') p.claimReturn(Number(value));
    else if (kind === 'starter-diamonds') p.claimStarterDiamonds();
    else if (kind === 'buy-tool') {
      if (value !== 'trowel' && value !== 'compass') throw new Error('此道具不出售');
      const bought = p.buyStoredTool(value, this.purchaseId(value));
      PlayState.current(this.context)?.refreshToolCounts();
      return bought ? '道具已存入永久库存' : '此笔购买已保存';
    } else if (kind === 'stored-supply') {
      if (value !== 'trowel' && value !== 'compass') throw new Error('此道具不出售');
      const page = PlayState.current(this.context);
      if (!page) throw new Error('对局已变化，库存未消耗');
      page.commitStoredSupply(value);
      // MK cleanup retains the same owner after failure; retry it once before
      // returning a terminal controller to a screen with no actionable buttons.
      try { await this.close(); } catch { await this.close(); }
      await page.finishStoredSupplyPresentation();
      return '';
    }
    else if (kind === 'free-tool') {
      const tool = value as SupplyTool | 'slot';
      if (!this.context.play?.canUseTool(tool)) throw new Error('当前没有可生效的目标，未消耗道具');
      await this.close();
      await PlayState.current(this.context)?.usePowerUp(tool);
      return '';
    } else if (kind === 'diamond-supply') {
      const tool = value as SupplyTool;
      const round = this.context.round;
      if (!round || !this.context.play?.canUseExtraSupply(tool)) throw new Error('当前没有可生效的目标，未消耗钻石');
      if (p.snapshot().diamonds < 10) { this.returnSection = this.section; this.section = 'shop'; await this.switchControl(); return '钻石不足，充值暂未开放，可先领取30钻体验礼包'; }
      p.buyExtraSupply(round.id, tool, 'diamond');
      this.context.play.useExtraSupply(tool);
      await this.close();
      await PlayState.current(this.context)?.presentExtraSupply(tool);
      return '';
    } else if (kind === 'confirm-home') {
      await this.close(); await PlayState.goHome(this.context); return '';
    } else if (kind === 'confirm-restart') {
      const round = this.context.round;
      await this.close();
      if (round?.mode === 'daily') await PlayState.enterDaily(this.context);
      else await PlayState.enterLevel(this.context, round?.levelId ?? this.context.play?.snapshot().level ?? 1);
      return '';
    }
    else if (kind === 'messages') p.acknowledgeMessages();
    else if (kind === 'challenge') {
      await this.close(); await PlayState.enterDaily(this.context); return '';
    } else if (kind === 'level') {
      await this.close(); await PlayState.enterLevel(this.context, Number(value)); return '';
    } else if (kind === 'supply' || kind === 'ad-supply') {
      const tool = value as SupplyTool;
      const round = this.context.round;
      if (!round || !this.context.play?.canUseExtraSupply(tool)) throw new Error('请先使用本局免费道具');
      if (kind === 'supply') {
        p.buyExtraSupply(round.id, tool, 'token');
        this.context.play.useExtraSupply(tool);
      }
      else {
        if (!this.context.ads?.hasPendingReward() && !p.isAdEligible(round.id, 'supply')) return '本局或当日补给次数已用完';
        const status = await this.context.ads!.request('supply', () => {
          if (!this.context.play?.canUseExtraSupply(tool)) throw new Error('对局已变化，请重试');
          p.grantAdReward(`${round.id}:supply`, round.id, 'supply', tool);
          this.context.play.useExtraSupply(tool);
        }, tool);
        if (status !== 'completed') return status === 'pending' ? '奖励待保存，请重试原道具，无需再看视频' : status === 'unavailable' ? '视频暂不可用，免费玩法不受影响' : status === 'failed' ? '视频加载或奖励保存失败，请稍后重试' : '视频未完成，未消耗资源';
      }
      await this.close();
      await PlayState.current(this.context)?.presentExtraSupply(tool);
      return '';
    }
    return kind === 'reroll' ? '订单已更换' : kind === 'starter-diamonds' ? '30钻石已到账' : '已保存';
  }

  private socialPresentation(): SocialPresentation {
    return this.social ??= new SocialPresentation(this.context.progress!, this.context.socialConfig!, this.context.leaderboardConfig!, this.context.profile ?? undefined);
  }

  private async close(): Promise<void> {
    this.cancelled = true;
    const control = this.control;
    if (this.context.constructionView) this.context.constructionView.refreshSocialNotice(this.context.progress!.readSocial().unread);
    if (control) {
      try { await swallowMkInterrupt(Promise.resolve(control.close())); }
      catch (cause) {
        if (control instanceof ToolControl && !control.offerCleanupRetry()) {
          this.context.app.setError({ code: 'RUNTIME', message: `弹窗清理未完成且关闭入口不可用：${String(cause)}` });
          this.context.hudView?.setFeedback('弹窗清理未完成，页面保持锁定');
        }
        throw cause;
      }
    }
    if (this.context.progressPopup !== control) return;
    this.context.progressPopup = null;
    if (this.control === control) this.control = null;
    this.context.inputLocked = false;
  }
}
