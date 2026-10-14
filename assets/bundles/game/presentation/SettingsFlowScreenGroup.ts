import { _decorator, Color, isValid, Label, Node, Sprite, UITransform } from 'cc';
import mk from 'mk';
import type { P10ReadModel, P10Screen } from '../application/contracts';
import type { ViewportLayout } from '../ui/ViewportLayout';

const { ccclass, property } = _decorator;

@ccclass('SettingsFlowScreenGroup')
export class SettingsFlowScreenGroup extends mk.ViewBase {
    @property(Node) public settingsRoot: Node | null = null;
    @property(Node) public headerRoot: Node | null = null;
    @property(Sprite) public background: Sprite | null = null;
    @property(Node) public transition: Node | null = null;
    @property(Label) public currencyLabel: Label | null = null;
    @property(Node) public effectsButton: Node | null = null;
    @property(Node) public musicButton: Node | null = null;
    @property(Node) public colorBlindButton: Node | null = null;
    @property(Node) public reducedMotionButton: Node | null = null;
    @property(Label) public effectsStatus: Label | null = null;
    @property(Label) public musicStatus: Label | null = null;
    @property(Label) public colorBlindStatus: Label | null = null;
    @property(Label) public reducedMotionStatus: Label | null = null;
    @property(Node) public backButton: Node | null = null;
    @property(Node) public recoveryButton: Node | null = null;
    @property(Node) public productButton: Node | null = null;
    @property(Node) public recoveryRoot: Node | null = null;
    @property(Node) public recoveryHeader: Node | null = null;
    @property(Sprite) public recoveryBackground: Sprite | null = null;
    @property(Node) public recoveryTransition: Node | null = null;
    @property(Label) public recoveryCurrency: Label | null = null;
    @property(Label) public checkpointSummary: Label | null = null;
    @property(Label) public checkpointStatus: Label | null = null;
    @property(Node) public resumeButton: Node | null = null;
    @property(Label) public resumeLabel: Label | null = null;
    @property(Node) public resetButton: Node | null = null;
    @property(Node) public recoveryBack: Node | null = null;

    public show(screen: P10Screen): boolean {
        const active = screen === 'settings' || screen === 'recovery';
        this.node.active = active;
        if (this.settingsRoot) this.settingsRoot.active = screen === 'settings';
        if (this.recoveryRoot) this.recoveryRoot.active = screen === 'recovery';
        return active;
    }

    public settingsBindings() {
        return {
            root: this.require(this.settingsRoot, 'settingsRoot'),
            effects: this.require(this.effectsButton, 'effectsButton'),
            music: this.require(this.musicButton, 'musicButton'),
            colorBlind: this.require(this.colorBlindButton, 'colorBlindButton'),
            reducedMotion: this.require(this.reducedMotionButton, 'reducedMotionButton'),
            back: this.require(this.backButton, 'backButton'),
            recovery: this.require(this.recoveryButton, 'recoveryButton'),
            product: this.require(this.productButton, 'productButton'),
        };
    }

    public presentSettings(model: P10ReadModel, viewport: ViewportLayout): void {
        const bindings = this.settingsBindings();
        this.require(this.node.getComponent(UITransform), 'view.UITransform')
            .setContentSize(viewport.width, viewport.height);
        this.require(bindings.root.getComponent(UITransform), 'settingsRoot.UITransform')
            .setContentSize(viewport.width, viewport.height);
        this.require(this.headerRoot, 'headerRoot').setPosition(0, viewport.topY - 48, 0);
        bindings.back.setPosition(-286, viewport.bottomY + 33, 0);
        const background = this.require(this.background, 'background');
        const frame = this.require(background.spriteFrame, 'background.spriteFrame');
        const scale = Math.max(viewport.width / Math.max(1, frame.originalSize.width),
            viewport.height / Math.max(1, frame.originalSize.height));
        this.require(background.node.getComponent(UITransform), 'background.UITransform')
            .setContentSize(frame.originalSize.width * scale, frame.originalSize.height * scale);
        this.require(this.currencyLabel, 'currencyLabel').string = `金币 ${model.progress.coins}  ★ ${model.progress.totalStars}`;
        const settings = model.progress.settings;
        this.presentToggle(bindings.effects, this.effectsStatus, settings.effectsVolume > 0, false);
        this.presentToggle(bindings.music, this.musicStatus, settings.musicVolume > 0, false);
        this.presentToggle(bindings.colorBlind, this.colorBlindStatus, settings.colorBlindMode, true);
        this.presentToggle(bindings.reducedMotion, this.reducedMotionStatus, settings.reducedMotion, true);
    }

    private presentToggle(node: Node, status: Label | null, enabled: boolean, useAlready: boolean): void {
        this.require(status, node.name + '.status').string = `${enabled ? '●' : '○'} ${enabled ? (useAlready ? '已开启' : '开启') : '已关闭'}`;
        this.require(node.getComponent(Sprite), node.name + '.Sprite').color = enabled
            ? new Color(38, 184, 135, 255) : new Color(20, 49, 68, 255);
    }

    public recoveryBindings() {
        return {
            root: this.require(this.recoveryRoot, 'recoveryRoot'),
            resume: this.require(this.resumeButton, 'resumeButton'),
            reset: this.require(this.resetButton, 'resetButton'),
            back: this.require(this.recoveryBack, 'recoveryBack'),
        };
    }

    public presentRecovery(model: P10ReadModel, viewport: ViewportLayout): void {
        const bindings = this.recoveryBindings();
        this.require(this.node.getComponent(UITransform), 'view.UITransform')
            .setContentSize(viewport.width, viewport.height);
        this.require(bindings.root.getComponent(UITransform), 'recoveryRoot.UITransform')
            .setContentSize(viewport.width, viewport.height);
        this.require(this.recoveryHeader, 'recoveryHeader').setPosition(0, viewport.topY - 48, 0);
        bindings.back.setPosition(-286, viewport.bottomY + 33, 0);
        const background = this.require(this.recoveryBackground, 'recoveryBackground');
        const frame = this.require(background.spriteFrame, 'recoveryBackground.spriteFrame');
        const scale = Math.max(viewport.width / Math.max(1, frame.originalSize.width),
            viewport.height / Math.max(1, frame.originalSize.height));
        this.require(background.node.getComponent(UITransform), 'recoveryBackground.UITransform')
            .setContentSize(frame.originalSize.width * scale, frame.originalSize.height * scale);
        const progress = model.progress;
        this.require(this.recoveryCurrency, 'recoveryCurrency').string = `金币 ${progress.coins}  ★ ${progress.totalStars}`;
        this.require(this.checkpointSummary, 'checkpointSummary').string = `金币 ${progress.coins} · 星章 ${progress.totalStars} · 声望 ${progress.reputation}`;
        this.require(this.checkpointStatus, 'checkpointStatus').string = progress.hasCheckpoint
            ? '检查点有效，可恢复关卡' : '安全档有效，无未完成关卡';
        this.require(this.resumeLabel, 'resumeLabel').string = progress.hasCheckpoint ? '恢复检查点' : '返回地图';
    }

    private require<T>(value: T | null, name: string): T {
        if (!value || !isValid(value, true)) throw new Error(`Cook settings binding is missing: ${name}`);
        return value;
    }
}
