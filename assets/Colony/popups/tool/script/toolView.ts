import { _decorator, Button, Label, Node, Sprite, SpriteFrame, UITransform } from 'cc';
import mk from 'mk';
import { ToolModel } from './toolModel';

const { ccclass, property } = _decorator;
const ICONS: Record<string, string> = {
  '小铲子': 'trowel', '指南针': 'compass', '扩充槽位': 'slot',
};

@ccclass('ColonyToolView')
export class ColonyToolView extends mk.MVCViewBase<ToolModel> {
  @property(Node)
  public panel: Node | null = null;

  public init(model?: ToolModel): void {
    if (!model) throw new Error('Tool popup requires a model');
    this._model = model;
  }

  public open(): void {
    this.event.off('action');
    this.event.off('close');
    this.node.getChildByName('Mask')?.setSiblingIndex(0);
    this.render();
  }

  public isAvailable(): boolean { return this.node.isValid && this.node.activeInHierarchy; }

  public render(): void {
    const panel = this.panel ?? this.node.getChildByName('Panel');
    if (!panel) throw new Error('Tool panel binding is missing');
    const { page, feedback } = this._model;
    const optionCount = Math.min(3, Math.max(1, page.rows.length - 1));
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
    panel.getChildByName('Status')!.getComponent(Label)!.string = feedback || (used
      ? '本局免费次数已用完 · 额外补给最多一次'
      : page.rows[1]?.detail ?? '确认后才会使用道具');
    const icon = panel.getChildByName('Icon')!;
    const iconName = ICONS[page.title];
    if (iconName) {
      void mk.asset.get(`db://assets/Colony/art/toy-market/ui/r03/tool-${iconName}.png`, SpriteFrame, this.node)
        .then((frame) => {
          if (frame && icon.isValid && this._model.page.title === page.title) icon.getComponent(Sprite)!.spriteFrame = frame;
        });
    }
    for (let index = 0; index < 3; index += 1) {
      const option = panel.getChildByName(`Option${index}`)!;
      const row = page.rows[index + 1];
      option.active = Boolean(row);
      if (!row) continue;
      option.setPosition(0, top - 565 - index * 80, 0);
      option.getChildByName('Text')!.getComponent(Label)!.string = row.button;
      this.bind(option, row.enabled, () => this.event.emit('action', row.action));
    }
    this.bind(panel.getChildByName('Close')!, true, () => this.event.emit('close'));
  }

  private bind(node: Node, enabled: boolean, action: () => void): void {
    node.targetOff(this);
    node.getComponent(Button)!.interactable = enabled;
    node.on(Button.EventType.CLICK, action, this);
  }
}
