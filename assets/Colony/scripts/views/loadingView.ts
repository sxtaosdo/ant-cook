import { _decorator, Label, Node } from 'cc';
import mk from 'mk';

const { ccclass, property } = _decorator;

@ccclass('ColonyLoadingView')
/** 加载页：进度条与错误文案。 */
export class ColonyLoadingView extends mk.StaticViewBase {
  @property(Label)
  private progressLabel: Label | null = null;

  @property(Node)
  private progressFill: Node | null = null;

  protected onLoad(): void {
    if (!this.progressLabel || !this.progressFill) {
      throw new Error('Loading Prefab is missing required editor bindings');
    }
  }

  /** 显示或隐藏加载页。 */
  public setVisible(visible: boolean): void {
    this.node.active = visible;
  }

  /** 设置 0~1 进度并刷新文案/填充。 */
  public setProgress(progress: number): void {
    if (!this.progressLabel || !this.progressFill) {
      throw new Error('Loading Prefab is missing required editor bindings');
    }
    const normalized = Math.min(1, Math.max(0, progress));
    this.progressLabel.string = `补给准备中  ${Math.round(normalized * 100)}%`;
    this.progressFill.setScale(normalized, 1, 1);
  }

  /** 展示启动失败文案。 */
  public setError(message: string): void {
    if (!this.progressLabel) throw new Error('Loading Prefab is missing required editor bindings');
    this.progressLabel.string = message;
  }
}
