import { instantiate, Node, Prefab } from 'cc';
import mk from 'mk';
import type { ColonySceneBootstrap } from '../bootstrap/colonySceneBootstrap';
import type { GuideTransportReceipt } from '../application/guideProgress';
import { ColonyGuideView } from '../../ui/guide/guideView';
import { ColonyUtil } from '../colonyUtil';
type Page = 'home' | 'play';
interface Owner { view: ColonyGuideView; manager: InstanceType<typeof mk.GuideManage>; running: Promise<void> }
export class GuidePresentation {
  private revision = 0;
  private active: Owner | null = null;
  private mounting: Promise<void> = Promise.resolve();
  private closing: Promise<void> = Promise.resolve();
  constructor(private readonly context: ColonySceneBootstrap) {}
  private receipt(): GuideTransportReceipt | undefined {
    const c = this.context;
    return c.round?.mode === 'main' && c.play ? { roundId: c.round.id, transported: c.play.snapshot().transported } : undefined;
  }
  private validPage(page: Page): boolean {
    const c = this.context;
    return !c.destroyed && !c.progressPopup && Boolean(page === 'home' ? c.homeView?.node.activeInHierarchy : c.playRoot?.activeInHierarchy && c.round?.mode === 'main');
  }
  public open(page: Page): void {
    const oldClose = this.cancel(), revision = this.revision, generation = this.context.generation;
    const current = (): boolean => revision === this.revision && generation === this.context.generation && this.validPage(page);
    const task = (async (): Promise<void> => {
      await oldClose;
      const p = this.context.progress, state = p?.readGuide();
      if (!current() || !p || state?.status !== 'pending' || (page === 'play' && state.segment !== 0)) return;
      const target = this.target(page, state.segment);
      if (!target) return;
      const prefab = await mk.asset.get('db://assets/Colony/ui/guide/guide.prefab', Prefab, null);
      if (!current()) { if (prefab) await mk.Release.release(prefab); return; }
      if (!prefab) throw Error('引导资源未加载');
      let node: Node;
      try { node = instantiate(prefab); } catch (cause) { await mk.Release.release(prefab); throw cause; }
      mk.Release.followRelease(node, prefab);
      node.active = false; node.parent = this.context.popupRoot!; node.setPosition(0, 0, 0);
      ColonyUtil.applyUiLayer(node);
      const view = node.getComponent(ColonyGuideView);
      if (!view) { node.destroy(); throw Error('引导视图缺失'); }
      try { view.stop(); view.validate(); } catch (cause) { node.destroy(); throw cause; }
      node.active = true;
      const manager = new mk.GuideManage({ currentStepNum: state.segment, endStepNum: -1, nameStr: 'Colony permanent guide' });
      const owner: Owner = { view, manager, running: Promise.resolve() };
      this.active = owner;
      const texts = ['完成一次搬运', '首次通关收集', '关注一个目标', '和伙伴一起关注'];
      const descriptions = [page === 'play' ? '点击亮出的前排数字方块。它先进入槽位，再由蚂蚁搬运；剩余数字表示待搬数量。' : '点击亮出的入口进入关卡，再点一个前排方块；蚂蚁搬运完成后继续。', '首次通关已经把收集物保存。打开清单，查看数量、来源和用途。', '打开收集清单，选择一个对象并关注；首页会持续显示它的进度。', p.socialAvailable() ? '打开排行榜，切到伙伴；选一位系统伙伴，留言里的固定对话可查看来源并一起关注。' : '继续通关至第3关解锁伙伴；回来后选择一位系统伙伴，一起关注收集目标。'];
      const advance = (): void => {
        if (!current() || this.active !== owner) return;
        try { p.advanceGuide(state.segment, this.receipt()); void this.cancel(); if (page === 'home') this.open('home'); }
        catch { view.feedback!.string = '进度未保存，请重试继续'; view.next!.interactable = p.canAdvanceGuide(this.receipt()); }
      };
      const skip = (): void => {
        if (!current() || this.active !== owner) return;
        try { p.skipGuide(); void this.cancel(); }
        catch { view.feedback!.string = '跳过未保存，请重试'; }
      };
      manager.regis(view.steps);
      let automaticTried = false;
      view.steps[state.segment]!.activate = () => {
        if (!current() || this.active !== owner) return;
        const shape = page === 'play' ? 0 : state.segment === 1 || state.segment === 2 ? 1 : state.segment === 3 && p.socialAvailable() ? 3 : 2;
        view.show(state.segment, texts[state.segment]!, descriptions[state.segment]!, target, shape, p.canAdvanceGuide(this.receipt()), advance, skip);
        view.schedule(() => {
          if (!current() || this.active !== owner) return;
          view.refreshHole(target, shape);
          const eligible = p.canAdvanceGuide(this.receipt()); view.next!.interactable = eligible;
          if (page === 'play' && eligible && !automaticTried) { automaticTried = true; advance(); }
        }, 0.25);
      };
      owner.running = manager.run(); await owner.running;
      if (current() && this.active === owner && (!view.steps[state.segment]!.ready || view.steps[state.segment]!.failure)) throw Error('引导步骤未显示');
    })();
    this.mounting = task;
    void task.catch(cause => {
      if (revision !== this.revision) return;
      void this.cancel();
      this.context.homeView?.setFeedback('引导加载未完成，返回首页可重试');
      console.error('Guide unavailable', cause);
    });
  }
  private target(page: Page, segment: number): Node | null {
    const c = this.context;
    if (page === 'play') {
      const stack = c.play?.snapshot().stacks.find(s => s.accessible);
      return stack ? c.stackRoot?.getChildByName(`stack-${stack.id}`) ?? null : null;
    }
    const name = segment === 1 || segment === 2 ? 'HomeTrackedObject' : segment === 3 && c.progress?.socialAvailable() ? 'LeaderboardButton' : 'StartButton';
    return c.homeView?.node.getChildByName(name) ?? null;
  }
  /** Cancel synchronously revokes input; await drains only captured old owners. */
  public cancel(): Promise<void> {
    ++this.revision;
    const owner = this.active; this.active = null;
    if (owner) { owner.view.stop(); owner.view.node.active = false; }
    const pending = this.mounting, previous = this.closing;
    const close = (async (): Promise<void> => {
      await previous; await pending.catch(() => undefined);
      if (owner) { await owner.running; for (const step of owner.view.steps) step.unload(); owner.view.node.destroy(); }
    })();
    this.closing = close; return close;
  }
}
