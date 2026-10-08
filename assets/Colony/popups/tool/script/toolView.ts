import { _decorator, Button, Label, Node, Sprite, SpriteFrame, UITransform } from 'cc';
import mk from 'mk';
import { ToolModel } from './toolModel';

const { ccclass, property } = _decorator;
const ICONS: Record<string, string> = {
  '小铲子': 'trowel', '指南针': 'compass', '扩充槽位': 'slot',
};

@ccclass('ColonyToolView')
export class ColonyToolView extends mk.MVCViewBase<ToolModel> {
  private readonly boundNodes = new Set<Node>();
  private viewRoot: Node | null = null;
  private revision = 0;
  @property(Node)
  public panel: Node | null = null;

  public init(model?: ToolModel): void {
    if (!model) throw new Error('Tool popup requires a model');
    this._model = model;
  }

  public open(): void {
    this.clearBindings();
    this.viewRoot = this.node;
    this.event.off('action');
    this.event.off('close');
    this.node.getChildByName('Mask')?.setSiblingIndex(0);
    this.render();
  }

  public isAvailable(): boolean { return this.valid && !!this.viewRoot?.isValid && this.viewRoot.activeInHierarchy; }

  public render(): void {
    const revision = ++this.revision;
    const panel = this.panel ?? this.node.getChildByName('Panel');
    if (!panel) throw new Error('Tool panel binding is missing');
    const { page, feedback } = this._model;
    const optionCount = Math.min(4, Math.max(1, page.rows.length - 1));
    const height = 600 + optionCount * 80;
    const top = height / 2;
    panel.getComponent(UITransform)!.setContentSize(620, height);
    for (const [name, y] of [['Title', top - 95], ['Close', top - 80], ['Icon', top - 210], ['Description', top - 335], ['Status', top - 450]] as const) {
      const node = panel.getChildByName(name)!;
      node.setPosition(node.position.x, y, 0);
    }
    panel.getChildByName('Title')!.getComponent(Label)!.string = page.title;
    panel.getChildByName('Description')!.getComponent(Label)!.string = page.rows[0]?.detail ?? '';
    const used = !page.rows.some((item) => item.action.startsWith('free-tool:'));
    const statusDetail = page.rows[1]?.action === 'noop' ? page.rows[1].detail : '';
    panel.getChildByName('Status')!.getComponent(Label)!.string = feedback || statusDetail || (used
      ? '本局免费次数已用完 · 额外补给最多一次'
      : page.rows[1]?.detail ?? '确认后才会使用道具');
    const icon = panel.getChildByName('Icon')!;
    const iconName = ICONS[page.title];
    if (iconName) {
      void mk.asset.get(`db://assets/Colony/art/toy-market/ui/r03/tool-${iconName}.png`, SpriteFrame, this.viewRoot!)
        .then((frame) => {
          if (revision === this.revision && this.isAvailable() && frame && icon.isValid && this._model.page.title === page.title) icon.getComponent(Sprite)!.spriteFrame = frame;
        }).catch(cause => { if (revision === this.revision && this.isAvailable()) console.error('Failed to load tool icon', cause); });
    }
    for (let index = 0; index < 4; index += 1) {
      const option = panel.getChildByName(`Option${index}`)!;
      const row = page.rows[index + 1];
      option.active = Boolean(row);
      if (!row) continue;
      option.setPosition(0, top - 565 - index * 80, 0);
      option.getComponentInChildren(Label)!.string = row.button;
      this.bind(option, row.enabled, () => this.event.emit('action', row.action));
    }
    this.bind(panel.getChildByName('Close')!, true, () => this.event.emit('close'));
  }

  private bind(node: Node, enabled: boolean, action: () => void): void {
    this.boundNodes.add(node);
    node.targetOff(this);
    node.getComponent(Button)!.interactable = enabled;
    node.on(Button.EventType.CLICK, () => { if (this.isAvailable() && node.activeInHierarchy) action(); }, this);
  }
  /** Cleanup keeps ownership; this button only retries cleanup, never gameplay. */
  public showCleanupRetry(retry: () => Promise<void>): boolean {
    const root = this.node, panel = this.panel ?? root?.getChildByName('Panel');
    if (!root?.isValid || !root.activeInHierarchy || !panel) return false;
    this.clearBindings();
    const status = panel.getChildByName('Status')!.getComponent(Label)!;
    status.string = '关闭未完成 · 点击右上角重试关闭';
    for (let index = 0; index < 4; index++) panel.getChildByName(`Option${index}`)!.getComponent(Button)!.interactable = false;
    const close = panel.getChildByName('Close')!;
    close.getComponent(Button)!.interactable = true;
    this.boundNodes.add(close);
    let running = false;
    close.on(Button.EventType.CLICK, () => {
      if (running || !root.isValid || !root.activeInHierarchy) return;
      running = true;
      void retry().catch(() => { if (status.isValid) status.string = '关闭仍未完成 · 点击右上角重试'; })
        .finally(() => { running = false; });
    }, this);
    return true;
  }
  private clearBindings(): void {
    this.revision++;
    this.viewRoot = null;
    for (const node of this.boundNodes) if (node.isValid) node.targetOff(this);
    this.boundNodes.clear();
  }
  public close(): void { this.clearBindings(); }
  protected onDisable(): void { this.clearBindings(); }
  protected onDestroy(): void { this.clearBindings(); }
}
