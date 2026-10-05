import { _decorator } from 'cc';
import mk from 'mk';
import type { P10Screen } from '../application/contracts';

const { ccclass } = _decorator;

@ccclass('SettingsFlowScreenGroup')
export class SettingsFlowScreenGroup extends mk.ViewBase {
    public show(screen: P10Screen): boolean {
        const active = screen === 'settings' || screen === 'recovery';
        this.node.active = active;
        return active;
    }
}
