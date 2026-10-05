import { Layers, type Node } from 'cc';

/** Colony 场景通用助手：延迟与 UI 层级。 */
export class ColonyUtil {
  /** 等待指定秒数。 */
  public static delay(seconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }

  /** 递归将节点树设为 UI_2D 层。 */
  public static applyUiLayer(node: Node): void {
    node.layer = Layers.Enum.UI_2D;
    node.children.forEach((child) => ColonyUtil.applyUiLayer(child));
  }
}
