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
  public bind(onUse: (tool: ColonyTool) => void): void {
    for (const tool of ['trowel', 'slot', 'compass'] as const) {
      const button = this.button(tool);
      button.node.targetOff(this);
      button.node.on(Button.EventType.CLICK, () => onUse(tool), this);
    }
  }

  /** 显示本局免费可用次数；耗尽时仍可打开原补给入口。 */
  public setUsed(used: readonly ColonyTool[]): void {
    for (const tool of ['trowel', 'slot', 'compass'] as const) {
      const button = this.button(tool);
      button.node.active = true;
      button.interactable = true;
      const status = button.node.getChildByName('Status')?.getComponent(Label);
      if (status) status.string = used.includes(tool) ? '＋' : '1';
    }
  }

  protected onDestroy(): void {
    this.trowelButton?.node?.targetOff(this);
    this.slotButton?.node?.targetOff(this);
    this.compassButton?.node?.targetOff(this);
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
