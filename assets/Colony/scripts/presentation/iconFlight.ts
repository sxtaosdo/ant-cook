import { Color, Node, SpriteFrame, tween, Tween, UIOpacity, UITransform, Vec3 } from 'cc';
import { NodeFactory } from './nodeFactory';

export interface IconFlightHandle { finished: Promise<'completed' | 'cancelled'>; cancel(): void }
/** Visual effects only. All animated values are driven by Cocos tween. */
export class IconFlight {
  private readonly factory = new NodeFactory();
  private readonly pool = this.factory.pool('icon-flight');
  private readonly handles = new Set<IconFlightHandle>();
  constructor(private readonly layer: Node) {}
  public fly(start: Node, end: Node, icon: SpriteFrame, quantity: number, durationMs: number, color = Color.WHITE): IconFlightHandle {
    if (!Number.isSafeInteger(quantity) || quantity < 0 || !Number.isFinite(durationMs) || durationMs <= 0) throw new Error('Invalid icon flight parameters');
    const transform = this.layer.getComponent(UITransform)!;
    const origin = transform.convertToNodeSpaceAR(start.worldPosition);
    const nodes: { node: Node; state: { t: number } }[] = [];
    let resolve!: (status: 'completed' | 'cancelled') => void;
    let settled = false, arrived = 0;
    const finish = (status: 'completed' | 'cancelled'): void => {
      if (settled) return;
      settled = true;
      for (const entry of nodes) { Tween.stopAllByTarget(entry.state); this.pool.put(entry.node); }
      this.handles.delete(handle); resolve(status);
    };
    const handle: IconFlightHandle = { finished: new Promise(r => { resolve = r; }), cancel: () => finish('cancelled') };
    this.handles.add(handle);
    if (!quantity) { finish('completed'); return handle; }
    const total = durationMs / 1000, burst = quantity > 1 ? Math.min(0.08, total / 4) : 0;
    for (let index = 0; index < quantity; index++) {
      const angle = index * Math.PI * 2 / quantity;
      const spread = quantity > 1 ? new Vec3(origin.x + Math.cos(angle) * 30, origin.y + Math.sin(angle) * 30) : origin.clone();
      const node = this.factory.acquire(this.pool, 'flying-icon', origin.x, origin.y, 30, 30, this.layer);
      this.factory.token(node, color, icon);
      const opacity = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
      tween(opacity).to(total, { opacity: 180 }, { easing: 'cubicIn' }).start();
      const state = { t: 0 }; nodes.push({ node, state });
      const travel = (): void => {
        tween(state).to(total - burst, { t: 1 }, { easing: 'cubicOut', onUpdate: () => {
          if (!end.isValid || !this.layer.isValid) { handle.cancel(); return; }
          const target = transform.convertToNodeSpaceAR(end.worldPosition), t = state.t, u = 1 - t;
          const cx = spread.x + (target.x - spread.x) * 0.2, cy = Math.max(spread.y, target.y) + 70 + index % 3 * 12;
          node.setPosition(u*u*spread.x + 2*u*t*cx + t*t*target.x, u*u*spread.y + 2*u*t*cy + t*t*target.y);
        } }).call(() => { if (++arrived === quantity) finish('completed'); }).start();
        tween(node).to(total - burst, { scale: new Vec3(0.8, 0.8, 1) }, { easing: 'cubicOut' }).start();
      };
      if (burst) tween(node).to(burst, { position: spread }, { easing: 'quadOut' }).call(travel).start();
      else travel();
    }
    return handle;
  }
  public dispose(): void { for (const handle of [...this.handles]) handle.cancel(); this.pool.clear(); }
}
