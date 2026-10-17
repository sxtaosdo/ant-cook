import { _decorator, Color, isValid, Label, Node, Sprite, UITransform } from 'cc';
import mk from 'mk';
import type { P10ReadModel, P10Screen } from '../application/contracts';
import type { ViewportLayout } from '../ui/ViewportLayout';

const { ccclass, property } = _decorator;

@ccclass('MapFlowScreenGroup')
export class MapFlowScreenGroup extends mk.ViewBase {
    // The root opts in only after Creator has saved the complete authored map.
    @property(Node) public mapRoot: Node | null = null;
    @property(Node) public headerRoot: Node | null = null;
    @property(Node) public navigationRoot: Node | null = null;
    @property(Sprite) public background: Sprite | null = null;
    @property(Node) public transition: Node | null = null;
    @property(Label) public currencyLabel: Label | null = null;
    @property([Node]) public restaurantCards: Node[] = [];
    @property([Label]) public restaurantIcons: Label[] = [];
    @property([Label]) public restaurantNames: Label[] = [];
    @property([Label]) public restaurantCities: Label[] = [];
    @property([Label]) public restaurantProgress: Label[] = [];
    @property([Node]) public restaurantLocks: Node[] = [];
    @property([Sprite]) public restaurantEdges: Sprite[] = [];
    @property([Sprite]) public restaurantBorders: Sprite[] = [];
    @property(Node) public upgradeButton: Node | null = null;
    @property(Node) public decorButton: Node | null = null;
    @property(Node) public storyButton: Node | null = null;
    @property(Node) public settingsButton: Node | null = null;

    public get hasFixedMap(): boolean { return this.mapRoot !== null; }

    public show(screen: P10Screen): boolean {
        const active = screen === 'map' || screen === 'level' || screen === 'story';
        this.node.active = active;
        if (this.mapRoot) this.mapRoot.active = screen === 'map';
        return active;
    }

    public mapBindings() {
        const root = this.require(this.mapRoot, 'mapRoot');
        if (root.parent !== this.node) throw new Error('Cook mapRoot must be a direct child of its View');
        return {
            root,
            cards: this.requireSlots(this.restaurantCards, 6, 'restaurantCards'),
            icons: this.requireSlots(this.restaurantIcons, 6, 'restaurantIcons'),
            names: this.requireSlots(this.restaurantNames, 6, 'restaurantNames'),
            cities: this.requireSlots(this.restaurantCities, 6, 'restaurantCities'),
            progress: this.requireSlots(this.restaurantProgress, 6, 'restaurantProgress'),
            locks: this.requireSlots(this.restaurantLocks, 6, 'restaurantLocks'),
            edges: this.requireSlots(this.restaurantEdges, 6, 'restaurantEdges'),
            borders: this.requireSlots(this.restaurantBorders, 24, 'restaurantBorders'),
            upgrade: this.require(this.upgradeButton, 'upgradeButton'),
            decor: this.require(this.decorButton, 'decorButton'),
            story: this.require(this.storyButton, 'storyButton'),
            settings: this.require(this.settingsButton, 'settingsButton'),
        };
    }

    public presentMap(model: P10ReadModel, viewport: ViewportLayout,
        decorations: readonly { readonly city: string; readonly icon: string }[]): void {
        const bindings = this.mapBindings();
        if (model.catalog.restaurants.length !== 6 || decorations.length !== 6)
            throw new Error('Cook fixed map requires the existing six restaurants');
        this.require(this.node.getComponent(UITransform), 'view.UITransform').setContentSize(viewport.width, viewport.height);
        this.require(bindings.root.getComponent(UITransform), 'mapRoot.UITransform').setContentSize(viewport.width, viewport.height);
        this.require(this.headerRoot, 'headerRoot').setPosition(0, viewport.topY - 48, 0);
        this.require(this.navigationRoot, 'navigationRoot').setPosition(0, viewport.bottomY + 38, 0);
        this.require(this.transition, 'transition');
        const background = this.require(this.background, 'background');
        const frame = this.require(background.spriteFrame, 'background.spriteFrame');
        const scale = Math.max(viewport.width / Math.max(1, frame.originalSize.width),
            viewport.height / Math.max(1, frame.originalSize.height));
        this.require(background.node.getComponent(UITransform), 'background.UITransform')
            .setContentSize(frame.originalSize.width * scale, frame.originalSize.height * scale);
        this.require(this.currencyLabel, 'currencyLabel').string = `金币 ${model.progress.coins}  ★ ${model.progress.totalStars}`;
        model.catalog.restaurants.forEach((restaurant, index) => {
            const progress = model.progress.restaurants[restaurant.id];
            const unlocked = progress.unlocked;
            const color = unlocked ? (index % 2 === 0 ? new Color(235, 69, 66, 255) : new Color(38, 184, 135, 255))
                : new Color(45, 57, 67, 255);
            bindings.icons[index].string = unlocked ? decorations[index].icon : '锁';
            bindings.icons[index].color = color;
            bindings.names[index].string = restaurant.name;
            bindings.cities[index].string = `${decorations[index].city} · ${restaurant.levelIds.length}关`;
            bindings.cities[index].color = unlocked ? new Color(38, 231, 211, 255) : new Color(150, 179, 190, 255);
            bindings.progress[index].string = unlocked ? `已开至第 ${progress.highestUnlockedLevel} 关` : '完成前店解锁';
            bindings.progress[index].color = unlocked ? new Color(255, 190, 73, 255) : new Color(150, 179, 190, 255);
            bindings.locks[index].active = !unlocked;
            bindings.edges[index].color = color;
            const border = unlocked ? color : new Color(150, 179, 190, 255);
            for (let side = 0; side < 4; side++)
                bindings.borders[index * 4 + side].color = new Color(border.r, border.g, border.b, 205);
        });
    }

    private requireSlots<T>(values: T[], length: number, name: string): T[] {
        if (values.length !== length) throw new Error(`Cook map binding count is invalid: ${name}`);
        values.forEach((value, index) => this.require(value, `${name}[${index}]`));
        return values;
    }

    private require<T>(value: T | null, name: string): T {
        if (!value || !isValid(value, true)) throw new Error(`Cook map binding is missing: ${name}`);
        return value;
    }
}
