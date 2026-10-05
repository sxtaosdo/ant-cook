import { _decorator, BlockInputEvents, Camera, Canvas, Color, Component, director, Director, Graphics, Label, Layers, Node, ResolutionPolicy, sys, UITransform, view } from 'cc';
import { StateMachine, type IState } from 'db://shidai3/index';
import mk from 'mk';
import { BUILD_MODES } from './buildModes';
import { ModuleEntryGate, type ModeId, type SceneDriver } from './contracts';
import { SwitchCoordinator } from './switchCoordinator';

const { ccclass } = _decorator;
const SHELL_LAYER = 1 << 19;

abstract class ShellState implements IState<ProductBootstrap> {
  context!: ProductBootstrap;
  abstract enter(): void;
  exit(): void {}
}
export class ShellBootState extends ShellState { enter() { this.context.setStatus('准备双玩法入口'); } }
export class ShellEntryState extends ShellState { enter() { this.context.setStatus('选择玩法'); } }
export class ShellRunningState extends ShellState { enter() { this.context.setStatus('可随时继续当前玩法'); this.context.hideNavigation(); } }
export class ShellSwitchingState extends ShellState { enter() { this.context.setStatus('正在准备玩法，请稍候'); } }
export class ShellRecoverState extends ShellState { enter() { this.context.setStatus('切换未完成，可重试保存或重新选择'); } }

/** The one persistent product entry. Gameplay scenes retain their own page StateMachine. */
@ccclass('ProductBootstrap')
export class ProductBootstrap extends Component {
  readonly StateMachine = new StateMachine<ProductBootstrap>(this);
  private coordinator: SwitchCoordinator | null = null;
  private status: Label | null = null;
  private transitioning = false;
  private navigationRoot: Node | null = null;
  private navigationEpoch = 0;

  protected onLoad(): void { void this.boot().catch(cause => this.setStatus(String(cause))); }

  private async boot(): Promise<void> {
    if (this.node.parent !== director.getScene()) throw new Error('Bootstrap root must be a direct scene child');
    Layers.addLayer('ProductShell', 19);
    this.node.layer = SHELL_LAYER;
    director.addPersistRootNode(this.node);
    view.setDesignResolutionSize(750, 1334, ResolutionPolicy.FIXED_WIDTH);
    this.createNavigation();
    await this.StateMachine.changeState(ShellBootState);
    const driver: SceneDriver = {
      preflight: async descriptor => {
        const bundle = await mk.bundle.load(descriptor.bundleName);
        if (!bundle) throw new Error(`玩法资源未就绪：${descriptor.id}`);
        await new Promise<void>((resolve, reject) => bundle.preloadScene(descriptor.sceneName, err => err ? reject(err) : resolve()));
      },
      enter: async (descriptor, entry) => {
        ModuleEntryGate.bind({ ...entry,
          requestNavigation: () => entry.isCurrent() && this.showNavigation(),
          isNavigationCovered: () => this.navigationRoot?.activeInHierarchy ?? false,
        });
        // Completion of loadScene is deliberately separate from the gameplay moduleReady report.
        const scene = await mk.bundle.loadScene(descriptor.sceneName, { bundleStr: descriptor.bundleName, launchGuardFunc: entry.isCurrent });
        if (!scene) throw new Error(`玩法场景未进入：${descriptor.id}`);
      },
    };
    this.coordinator = new SwitchCoordinator(BUILD_MODES, driver, sys.localStorage);
    await this.StateMachine.changeState(ShellEntryState);
    const launch = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('mode');
    const requested = launch === 'ant' || launch === 'cook' ? launch : this.coordinator.lastPlayed;
    const mode = BUILD_MODES.some(d => d.id === requested) ? requested! : BUILD_MODES[0].id;
    await this.openMode(mode, 'launch');
  }

  public enterAnt(): void { void this.openMode('ant'); }
  public enterCook(): void { void this.openMode('cook'); }
  public retrySave(): void {
    if (this.transitioning) return;
    if (this.StateMachine.is(ShellRunningState)) {
      if (this.coordinator?.hasPendingMetadata) { const ok = this.coordinator.retryMetadata(); this.setStatus(ok ? '入口记录已保存' : '入口记录仍待保存，可继续当前玩法'); this.revealNavigation(); }
      return;
    }
    if (!this.StateMachine.is(ShellRecoverState)) return;
    if (this.coordinator?.cleanupBlockedMode) {
      void this.coordinator.retryCleanup().then(ok => this.setStatus(ok ? '清理完成，可重新选择玩法' : '玩法清理未完成，请重试清理'));
    } else void this.coordinator?.retrySave().then(async ok => {
      const businessReady = ok || !!this.coordinator?.onlyMetadataPending;
      if (businessReady) await this.StateMachine.changeState(ShellRunningState);
      this.setStatus(businessReady ? (this.coordinator?.hasPendingMetadata ? '存档已恢复，入口记录待保存；可继续当前玩法' : '保存和页面恢复完成，可继续或切换') : '保存或页面恢复未完成，可重试或重新选择玩法');
      if (!ok) this.revealNavigation();
    });
  }

  private async openMode(mode: ModeId, source: 'launch' | 'manual' = 'manual'): Promise<void> {
    if (!this.coordinator || this.transitioning) return;
    this.transitioning = true;
    try {
      await this.StateMachine.changeState(ShellSwitchingState);
      this.revealNavigation();
      const result = await this.coordinator.switchTo(mode, source);
      await this.StateMachine.changeState(result.ok || (!result.ok && (result.recoveredMode || result.canContinue)) ? ShellRunningState : ShellRecoverState);
      if (!result.ok) {
        const reasons: Record<string, string> = { playing: '当前关卡进行中，完成后可切换', adShowing: '广告播放中，请结束后再试', rewardPending: '奖励处理中，请稍候', saveFailed: '存档尚未保存，请重试保存' };
        const message = reasons[result.reason] ?? (this.coordinator.cleanupBlockedMode ? '玩法清理未完成，请重试清理' : result.canContinue || result.recoveredMode ? '目标玩法暂未准备好，稍后可重试' : '保存或页面恢复未完成，请重试');
        this.setStatus(`${result.canContinue || result.recoveredMode ? '可继续当前玩法' : '玩法尚未就绪'}；${message}`); this.revealNavigation();
      }
      else if (result.metadataPending) this.setStatus('玩法已就绪，入口记录待保存');
    } finally { this.transitioning = false; }
  }

  public setStatus(text: string): void { if (this.status) this.status.string = text; }

  public showNavigation(): boolean {
    if (this.transitioning || !this.StateMachine.is(ShellRunningState)) return false;
    this.revealNavigation(); return true;
  }

  private revealNavigation(): void {
    this.navigationEpoch++;
    const root = this.navigationRoot;
    if (!root) return;
    const size = view.getVisibleSize(), safe = sys.getSafeAreaRect(false);
    root.getComponent(UITransform)!.setContentSize(size.width, size.height);
    const backdrop = root.getComponent(Graphics)!; backdrop.clear();
    backdrop.rect(-size.width / 2, -size.height / 2, size.width, size.height); backdrop.fill();
    root.getChildByName('NavigationPanel')!.setPosition(safe.x + safe.width / 2 - size.width / 2, safe.y + safe.height / 2 - size.height / 2);
    const panel = root.getChildByName('NavigationPanel')!;
    panel.getChildByName('ContinueCurrent')!.active = this.StateMachine.is(ShellRunningState);
    const retry = panel.getChildByName('RetrySave')!;
    retry.active = this.StateMachine.is(ShellRecoverState) || !!this.coordinator?.hasPendingMetadata;
    retry.getComponentInChildren(Label)!.string = this.StateMachine.is(ShellRunningState) ? '重试入口记录' : '重试保存与恢复';
    BUILD_MODES.forEach(mode => { panel.getChildByName(`Switch_${mode.id}`)!.getComponentInChildren(Label)!.string = `${mode.id === 'ant' ? '蚂蚁搬搬搬' : '星际美食家'}${this.coordinator?.currentMode === mode.id ? '（当前）' : ''}`; });
    this.node.getChildByName('ShellCamera')!.getComponent(Camera)!.orthoHeight = size.height / 2;
    root.active = true;
  }

  public hideNavigation(): void {
    if (this.transitioning && !this.StateMachine.is(ShellRunningState)) return;
    const epoch = ++this.navigationEpoch;
    // Cook uses global input: retain the modal guard until this touch finishes.
    director.once(Director.EVENT_AFTER_DRAW, () => {
      if (epoch === this.navigationEpoch && this.navigationRoot?.isValid) this.navigationRoot.active = false;
    });
  }

  private createNavigation(): void {
    const canvas = this.node.getComponent(Canvas) ?? this.node.addComponent(Canvas);
    const cameraNode = new Node('ShellCamera'); cameraNode.layer = SHELL_LAYER; this.node.addChild(cameraNode);
    const camera = cameraNode.addComponent(Camera); camera.projection = Camera.ProjectionType.ORTHO;
    camera.visibility = SHELL_LAYER; camera.priority = 100; camera.clearFlags = Camera.ClearFlag.DEPTH_ONLY;
    cameraNode.setPosition(0, 0, 1000); canvas.cameraComponent = camera;
    const size = view.getVisibleSize(); this.node.getComponent(UITransform)?.setContentSize(size.width, size.height);
    camera.orthoHeight = size.height / 2;
    const root = this.navigationRoot = new Node('ProductNavigation'); root.layer = SHELL_LAYER; this.node.addChild(root);
    root.addComponent(UITransform).setContentSize(size.width, size.height); root.addComponent(BlockInputEvents);
    const backdrop = root.addComponent(Graphics); backdrop.fillColor = new Color(0, 0, 0, 185);
    backdrop.rect(-size.width / 2, -size.height / 2, size.width, size.height); backdrop.fill();
    const panel = new Node('NavigationPanel'); panel.layer = SHELL_LAYER; root.addChild(panel);
    panel.addComponent(UITransform).setContentSize(650, 740);
    const paper = panel.addComponent(Graphics); paper.fillColor = new Color(24, 40, 52, 255);
    paper.roundRect(-325, -370, 650, 740, 24); paper.fill();
    const makeLabel = (name: string, text: string, y: number, height: number, action?: () => void): Label => {
      const node = new Node(name); node.layer = SHELL_LAYER; panel.addChild(node); node.setPosition(0, y);
      node.addComponent(UITransform).setContentSize(570, height);
      if (action) { const plate = node.addComponent(Graphics); plate.fillColor = new Color(40, 84, 95, 255); plate.roundRect(-285, -height / 2, 570, height, 14); plate.fill(); }
      const textNode = action ? new Node(`${name}Text`) : node;
      if (action) { textNode.layer = SHELL_LAYER; node.addChild(textNode); textNode.addComponent(UITransform).setContentSize(540, height - 12); }
      const label = textNode.addComponent(Label); label.string = text; label.fontSize = action ? 36 : 28; label.lineHeight = 44;
      label.color = Color.WHITE; label.overflow = Label.Overflow.CLAMP;
      if (action) node.on(Node.EventType.TOUCH_END, action, this);
      return label;
    };
    const safe = sys.getSafeAreaRect(false);
    panel.setPosition(safe.x + safe.width / 2 - size.width / 2, safe.y + safe.height / 2 - size.height / 2);
    makeLabel('NavigationTitle', '选择玩法 · 进度独立保存', 290, 70);
    BUILD_MODES.forEach((mode, index) => makeLabel(`Switch_${mode.id}`, mode.id === 'ant' ? '蚂蚁搬搬搬' : '星际美食家', 170 - index * 120, 100,
      () => { void this.openMode(mode.id); }));
    makeLabel('ContinueCurrent', '继续当前玩法', -70, 100, () => { if (!this.transitioning && this.StateMachine.is(ShellRunningState)) this.hideNavigation(); });
    makeLabel('RetrySave', '重试保存', -190, 100, () => this.retrySave());
    this.status = makeLabel('ShellStatus', '', -290, 90);
  }
}
