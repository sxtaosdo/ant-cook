import { _decorator } from 'cc';
import mk from 'mk';
import type { P10Screen } from '../application/contracts';

const { ccclass } = _decorator;

@ccclass('MapFlowScreenGroup')
export class MapFlowScreenGroup extends mk.ViewBase {
    public show(screen: P10Screen): boolean {
        const active = screen === 'map' || screen === 'level' || screen === 'story';
        this.node.active = active;
        return active;
    }
}
