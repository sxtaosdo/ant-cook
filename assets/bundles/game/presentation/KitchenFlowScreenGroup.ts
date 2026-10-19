import { _decorator, isValid, Label, Node, Sprite, UITransform } from 'cc';
import mk from 'mk';
import type { P10ReadModel, P10Screen } from '../application/contracts';
import type { ViewportLayout } from '../ui/ViewportLayout';

const { ccclass, property } = _decorator;

@ccclass('KitchenFlowScreenGroup')
export class KitchenFlowScreenGroup extends mk.ViewBase {
    // Optional until Creator saves the authored pause page in this shared View.
    @property(Node) public pauseRoot: Node | null = null;
    @property(Node) public pauseHeaderRoot: Node | null = null;
    @property(Sprite) public pauseBackground: Sprite | null = null;
    @property(Node) public pauseTransition: Node | null = null;
    @property(Label) public pauseCurrencyLabel: Label | null = null;
    @property(Label) public pauseSummaryLabel: Label | null = null;
    @property(Node) public pauseResumeButton: Node | null = null;
    @property(Node) public pauseRestartButton: Node | null = null;
    @property(Node) public pauseExitButton: Node | null = null;

    public get hasFixedPause(): boolean { return this.pauseRoot !== null; }

    public show(screen: P10Screen): boolean {
        const active = screen === 'kitchen' || screen === 'pause' || screen === 'result';
        this.node.active = active;
        if (this.pauseRoot) this.pauseRoot.active = screen === 'pause';
        return active;
    }

    public pauseBindings() {
        const root = this.requirePause(this.pauseRoot, 'pauseRoot');
        if (root.parent !== this.node) throw new Error('Cook pauseRoot must be a direct child of its View');
        const header = this.pauseNode(this.pauseHeaderRoot, root, 'pauseHeaderRoot');
        const background = this.pauseComponent(this.pauseBackground, root, 'pauseBackground');
        const transition = this.pauseNode(this.pauseTransition, root, 'pauseTransition');
        const currency = this.pauseComponent(this.pauseCurrencyLabel, root, 'pauseCurrencyLabel');
        const summary = this.pauseComponent(this.pauseSummaryLabel, root, 'pauseSummaryLabel');
        const resume = this.pauseNode(this.pauseResumeButton, root, 'pauseResumeButton');
        const restart = this.pauseNode(this.pauseRestartButton, root, 'pauseRestartButton');
        const exit = this.pauseNode(this.pauseExitButton, root, 'pauseExitButton');
        const nodes = [header, background.node, transition, currency.node, summary.node, resume, restart, exit];
        if (new Set(nodes).size !== nodes.length) throw new Error('Cook pause bindings require distinct role nodes');
        for (const node of [root, ...nodes]) this.requirePause(node.getComponent(UITransform), `${node.name}.UITransform`);
        return { root, header, background, transition, currency, summary, resume, restart, exit };
    }

    public presentPause(model: P10ReadModel, viewport: ViewportLayout): void {
        const bindings = this.pauseBindings();
        this.requirePause(this.node.getComponent(UITransform), 'view.UITransform').setContentSize(viewport.width, viewport.height);
        this.requirePause(bindings.root.getComponent(UITransform), 'pauseRoot.UITransform').setContentSize(viewport.width, viewport.height);
        bindings.header.setPosition(0, viewport.topY - 48, 0);
        const frame = this.requirePause(bindings.background.spriteFrame, 'pauseBackground.spriteFrame');
        const scale = Math.max(viewport.width / Math.max(1, frame.originalSize.width),
            viewport.height / Math.max(1, frame.originalSize.height));
        this.requirePause(bindings.background.node.getComponent(UITransform), 'pauseBackground.UITransform')
            .setContentSize(frame.originalSize.width * scale, frame.originalSize.height * scale);
        bindings.currency.string = `金币 ${model.progress.coins}  ★ ${model.progress.totalStars}`;
        const snapshot = model.kitchen;
        bindings.summary.string = `已完成 ${snapshot?.servedOrders ?? 0}/${snapshot?.orders.length ?? 0} · 剩余 ${Math.ceil(snapshot?.remainingSeconds ?? 0)}秒`;
    }

    private requirePause<T>(value: T | null, name: string): T {
        if (!value || !isValid(value, true)) throw new Error(`Cook pause binding is missing: ${name}`);
        return value;
    }

    private pauseNode(value: Node | null, root: Node, name: string): Node {
        const node = this.requirePause(value, name);
        let ancestor: Node | null = node.parent;
        while (ancestor && ancestor !== root) ancestor = ancestor.parent;
        if (ancestor !== root) throw new Error(`Cook pause binding must belong to its root: ${name}`);
        return node;
    }

    private pauseComponent<T extends { node: Node }>(value: T | null, root: Node, name: string): T {
        const component = this.requirePause(value, name);
        this.pauseNode(component.node, root, name);
        return component;
    }
}
