import { _decorator, Button, Label } from 'cc';
import mk from 'mk';
import type { ColonyTool } from '../application/contracts';

const { ccclass, property } = _decorator;

@ccclass('ColonyToolBarView')
/** 道具栏：铲子 / 扩槽 / 指南针按钮。 */
export class ColonyToolBarView extends mk.StaticViewBase {
  @property(Button)
  private trowelButton: Button | null = null;

  @property(Button)
  private slotButton: Button | null = null;

  @property(Button)
  private compassButton: Button | null = null;

  @property(Button) private trowelCount: Button | null = null;
  @property(Button) private slotCount: Button | null = null;
  @property(Button) private compassCount: Button | null = null;

  protected onLoad(): void {
    this.button('trowel');
    this.button('slot');
    this.button('compass');
  }

  public setFirstLevelSkin(enabled: boolean): void {
    const dock = this.node.getChildByName('ToolDock');
    if (!dock) throw new Error('ToolBar Prefab is missing ToolDock');
    dock.active = enabled;
    dock.setSiblingIndex(0);
  }

  /** 绑定道具点击回调。 */
  public bind(onUse: (tool: ColonyTool) => void, onCount: (tool: ColonyTool) => void): void {
    for (const tool of ['trowel', 'slot', 'compass'] as const) {
      const button = this.button(tool);
      button.node.targetOff(this);
      button.node.on(Button.EventType.CLICK, () => onUse(tool), this);
      const count = this.count(tool);
      count.node.targetOff(this);
      count.node.on(Button.EventType.CLICK, () => onCount(tool), this);
    }
  }

  /** 显示本局免费可用次数；耗尽时仍可打开原补给入口。 */
  public setUsed(used: readonly ColonyTool[], slotCount = 5, available?: Partial<Record<ColonyTool, number>>): void {
    for (const tool of ['trowel', 'slot', 'compass'] as const) {
      const button = this.button(tool);
      button.node.active = true;
      button.interactable = true;
      const status = button.node.getChildByName('Status')?.getComponent(Label);
      if (status) status.string = tool === 'slot' && slotCount >= 6 && !used.includes(tool) ? '满'
        : available?.[tool] !== undefined ? available[tool]! > 0 ? String(available[tool]) : '＋' : used.includes(tool) ? '＋' : '1';
    }
  }

  protected onDestroy(): void {
    this.trowelButton?.node?.targetOff(this);
    this.slotButton?.node?.targetOff(this);
    this.compassButton?.node?.targetOff(this);
    for (const count of [this.trowelCount, this.slotCount, this.compassCount]) count?.node?.targetOff(this);
  }

  private count(tool: ColonyTool): Button {
    const count = { trowel: this.trowelCount, slot: this.slotCount, compass: this.compassCount }[tool];
    if (!count) throw new Error(`ToolBar Prefab is missing the ${tool} count binding`);
    return count;
  }

  /** 按道具名取序列化按钮。 */
  private button(tool: ColonyTool): Button {
    const buttonByTool: Record<ColonyTool, Button | null> = {
      trowel: this.trowelButton,
      slot: this.slotButton,
      compass: this.compassButton,
    };
    const button = buttonByTool[tool];
    if (!button) throw new Error(`ToolBar Prefab is missing the ${tool} button binding`);
    return button;
  }
}
