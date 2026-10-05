import { _decorator } from 'cc';
import mk from 'mk';
import type { P10Screen } from '../application/contracts';

const { ccclass } = _decorator;

@ccclass('KitchenFlowScreenGroup')
export class KitchenFlowScreenGroup extends mk.ViewBase {
    public show(screen: P10Screen): boolean {
        const active = screen === 'kitchen' || screen === 'pause' || screen === 'result';
        this.node.active = active;
        return active;
    }
}
