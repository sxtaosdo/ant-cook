import { _decorator, Camera, Canvas, Color, Component, director, Label, Layers, Node, sys, UITransform, view } from 'cc';
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
export class ShellRunningState extends ShellState { enter() { this.context.setStatus('可随时继续当前玩法'); } }
export class ShellSwitchingState extends ShellState { enter() { this.context.setStatus('正在准备玩法，请稍候'); } }
export class ShellRecoverState extends ShellState { enter() { this.context.setStatus('切换未完成，可重试保存或重新选择'); } }

/** The one persistent product entry. Gameplay scenes retain their own page StateMachine. */
@ccclass('ProductBootstrap')
export class ProductBootstrap extends Component {
  readonly StateMachine = new StateMachine<ProductBootstrap>(this);
  private coordinator: SwitchCoordinator | null = null;
  private status: Label | null = null;
  private transitioning = false;

  protected onLoad(): void { void this.boot().catch(cause => this.setStatus(String(cause))); }

  private async boot(): Promise<void> {
    if (this.node.parent !== director.getScene()) throw new Error('Bootstrap root must be a direct scene child');
    Layers.addLayer('ProductShell', 19);
    this.node.layer = SHELL_LAYER;
    director.addPersistRootNode(this.node);
    this.createNavigation();
    await this.StateMachine.changeState(ShellBootState);
    const driver: SceneDriver = {
      preflight: async descriptor => {
        const bundle = await mk.bundle.load(descriptor.bundleName);
        if (!bundle) throw new Error(`玩法资源未就绪：${descriptor.id}`);
        await new Promise<void>((resolve, reject) => bundle.preloadScene(descriptor.sceneName, err => err ? reject(err) : resolve()));
      },
      enter: async (descriptor, entry) => {
        ModuleEntryGate.bind(entry);
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
    if (this.coordinator?.cleanupBlockedMode) {
      void this.coordinator.retryCleanup().then(ok => this.setStatus(ok ? '清理完成，可重新选择玩法' : '玩法清理未完成，请重试清理'));
    } else void this.coordinator?.retrySave().then(ok => this.setStatus(ok ? '保存和页面恢复完成，可继续或切换' : '保存或页面恢复未完成，可重试或重新选择玩法'));
  }

  private async openMode(mode: ModeId, source: 'launch' | 'manual' = 'manual'): Promise<void> {
    if (!this.coordinator || this.transitioning) return;
    this.transitioning = true;
    try {
      await this.StateMachine.changeState(ShellSwitchingState);
      const result = await this.coordinator.switchTo(mode, source);
      await this.StateMachine.changeState(result.ok || (!result.ok && result.recoveredMode) ? ShellRunningState : ShellRecoverState);
      if (!result.ok) this.setStatus(`${this.coordinator.currentMode ? '可继续当前玩法' : '玩法尚未就绪，请重试或重新选择'}；${result.reason}`);
      else if (result.metadataPending) this.setStatus('玩法已就绪，入口记录待保存');
    } finally { this.transitioning = false; }
  }

  public setStatus(text: string): void { if (this.status) this.status.string = text; }

  private createNavigation(): void {
    const canvas = this.node.getComponent(Canvas) ?? this.node.addComponent(Canvas);
    const cameraNode = new Node('ShellCamera'); cameraNode.layer = SHELL_LAYER; this.node.addChild(cameraNode);
    const camera = cameraNode.addComponent(Camera); camera.projection = Camera.ProjectionType.ORTHO;
    camera.visibility = SHELL_LAYER; camera.priority = 100; camera.clearFlags = Camera.ClearFlag.DEPTH_ONLY;
    cameraNode.setPosition(0, 0, 1000); canvas.cameraComponent = camera;
    const size = view.getVisibleSize(); this.node.getComponent(UITransform)?.setContentSize(size.width, size.height);
    const makeLabel = (name: string, text: string, x: number, y: number, width: number, action?: () => void): Label => {
      const node = new Node(name); node.layer = SHELL_LAYER; this.node.addChild(node); node.setPosition(x, y);
      node.addComponent(UITransform).setContentSize(width, 42);
      const label = node.addComponent(Label); label.string = text; label.fontSize = 20; label.color = Color.WHITE;
      if (action) node.on(Node.EventType.TOUCH_END, action, this);
      return label;
    };
    const top = size.height / 2 - 26;
    BUILD_MODES.forEach((mode, index) => makeLabel(`Switch_${mode.id}`, mode.id === 'ant' ? '蚂蚁搬搬搬' : '星际美食家', -180 + index * 190, top, 180,
      () => { void this.openMode(mode.id); }));
    makeLabel('RetrySave', '重试保存', 250, top, 140, () => this.retrySave());
    this.status = makeLabel('ShellStatus', '', 0, top - 40, 700);
  }
}
