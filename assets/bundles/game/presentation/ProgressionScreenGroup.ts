import { _decorator } from 'cc';
import mk from 'mk';
import type { P10Screen } from '../application/contracts';

const { ccclass } = _decorator;

@ccclass('ProgressionScreenGroup')
export class ProgressionScreenGroup extends mk.ViewBase {
    public show(screen: P10Screen): boolean {
        const active = screen === 'upgrade' || screen === 'decor' || screen === 'unlock';
        this.node.active = active;
        return active;
    }
}
