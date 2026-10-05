import { instantiate, Node, Prefab } from 'cc';
import mk from 'mk';
import { ColonyUtil } from '../colonyUtil';

/** A transient visual owned and cancelled by one PlayState. */
export class HardLevelNotice {
  private node: Node | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private finish: (() => void) | null = null;
  private cancelled = false;
  public async show(owner: Node, parent: Node, current: () => boolean): Promise<void> {
    const prefab = await mk.asset.get('db://assets/Colony/ui/hardLevelNotice.prefab', Prefab, owner);
    if (this.cancelled || !current() || !parent.isValid) return;
    if (!prefab) throw new Error('高难度提示未加载');
    this.node = instantiate(prefab); ColonyUtil.applyUiLayer(this.node);
    this.node.parent = parent; this.node.setPosition(0, 0, 0); this.node.active = true;
    await new Promise<void>(resolve => {
      this.finish = resolve; this.timer = setTimeout(() => this.dispose(), 2000);
    });
  }
  public dispose(): void {
    this.cancelled = true;
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    this.node?.destroy(); this.node = null;
    this.finish?.(); this.finish = null;
  }
}
