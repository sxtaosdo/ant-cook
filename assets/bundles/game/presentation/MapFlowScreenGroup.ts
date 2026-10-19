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

    // Optional until Creator saves the complete Level tree in this shared View.
    @property(Node) public levelRoot: Node | null = null;
    @property(Node) public levelHeaderRoot: Node | null = null;
    @property(Sprite) public levelBackground: Sprite | null = null;
    @property(Node) public levelTransition: Node | null = null;
    @property(Label) public levelCurrencyLabel: Label | null = null;
    @property(Label) public levelRestaurantTitle: Label | null = null;
    @property(Label) public levelRestaurantSubtitle: Label | null = null;
    @property(Label) public levelRestaurantIcon: Label | null = null;
    @property([Node]) public levelButtons: Node[] = [];
    @property([Label]) public levelLabels: Label[] = [];
    @property([Sprite]) public levelPanels: Sprite[] = [];
    @property(Sprite) public levelPreviousButton: Sprite | null = null;
    @property(Sprite) public levelNextButton: Sprite | null = null;
    @property(Label) public levelPageLabel: Label | null = null;
    @property(Node) public levelBackButton: Node | null = null;

    public get hasFixedMap(): boolean { return this.mapRoot !== null; }
    public get hasFixedLevel(): boolean { return this.levelRoot !== null; }

    public show(screen: P10Screen): boolean {
        const active = screen === 'map' || screen === 'level' || screen === 'story';
        this.node.active = active;
        if (this.mapRoot) this.mapRoot.active = screen === 'map';
        if (this.levelRoot) this.levelRoot.active = screen === 'level';
        return active;
    }

    public levelBindings() {
        const root = this.requireLevel(this.levelRoot, 'levelRoot');
        if (root.parent !== this.node) throw new Error('Cook levelRoot must be a direct child of its View');
        if (this.levelButtons.length !== 6 || this.levelLabels.length !== 6 || this.levelPanels.length !== 6
            || new Set(this.levelButtons).size !== 6) throw new Error('Cook level requires six distinct bound slots');
        const buttons = this.levelButtons.map((node, index) => this.levelNode(node, root, `levelButtons[${index}]`));
        const labels = this.levelLabels.map((label, index) => this.levelComponent(label, buttons[index], `levelLabels[${index}]`));
        const panels = this.levelPanels.map((panel, index) => {
            const bound = this.levelComponent(panel, root, `levelPanels[${index}]`);
            if (bound.node !== buttons[index]) throw new Error(`Cook level panel must belong to its slot: ${index}`);
            return bound;
        });
        const previous = this.levelComponent(this.levelPreviousButton, root, 'levelPreviousButton');
        const next = this.levelComponent(this.levelNextButton, root, 'levelNextButton');
        const back = this.levelNode(this.levelBackButton, root, 'levelBackButton');
        for (const node of [...buttons, previous.node, next.node, back])
            this.requireLevel(node.getComponent(UITransform), `${node.name}.UITransform`);
        return {
            root, buttons, labels, panels, previous, next, back,
            header: this.levelNode(this.levelHeaderRoot, root, 'levelHeaderRoot'),
            background: this.levelComponent(this.levelBackground, root, 'levelBackground'),
            transition: this.levelNode(this.levelTransition, root, 'levelTransition'),
            currency: this.levelComponent(this.levelCurrencyLabel, root, 'levelCurrencyLabel'),
            title: this.levelComponent(this.levelRestaurantTitle, root, 'levelRestaurantTitle'),
            subtitle: this.levelComponent(this.levelRestaurantSubtitle, root, 'levelRestaurantSubtitle'),
            icon: this.levelComponent(this.levelRestaurantIcon, root, 'levelRestaurantIcon'),
            page: this.levelComponent(this.levelPageLabel, root, 'levelPageLabel'),
        };
    }

    public presentLevel(model: P10ReadModel, viewport: ViewportLayout,
        decoration: { readonly city: string; readonly icon: string }): void {
        const bindings = this.levelBindings();
        const restaurant = model.catalog.restaurants[model.selection.restaurantIndex] ?? model.catalog.restaurants[0];
        const pageStart = model.selection.levelPage * 6;
        this.requireLevel(this.node.getComponent(UITransform), 'view.UITransform').setContentSize(viewport.width, viewport.height);
        this.requireLevel(bindings.root.getComponent(UITransform), 'levelRoot.UITransform').setContentSize(viewport.width, viewport.height);
        bindings.header.setPosition(0, viewport.topY - 48, 0);
        bindings.back.setPosition(-286, viewport.bottomY + 33, 0);
        const frame = this.requireLevel(bindings.background.spriteFrame, 'levelBackground.spriteFrame');
        const scale = Math.max(viewport.width / Math.max(1, frame.originalSize.width),
            viewport.height / Math.max(1, frame.originalSize.height));
        this.requireLevel(bindings.background.node.getComponent(UITransform), 'levelBackground.UITransform')
            .setContentSize(frame.originalSize.width * scale, frame.originalSize.height * scale);
        bindings.currency.string = `金币 ${model.progress.coins}  ★ ${model.progress.totalStars}`;
        bindings.title.string = restaurant.name;
        bindings.subtitle.string = `${decoration.city} · 今日营业`;
        bindings.icon.string = decoration.icon;
        bindings.buttons.forEach((button, slot) => {
            const levelId = restaurant.levelIds[pageStart + slot];
            button.active = levelId !== undefined;
            if (levelId === undefined) { bindings.labels[slot].string = ''; return; }
            const progress = model.progress.levels[levelId];
            const stars = '★'.repeat(progress.bestStars) + '☆'.repeat(3 - progress.bestStars);
            bindings.labels[slot].string = progress.unlocked ? `${pageStart + slot + 1}\n${stars}` : '锁定';
            bindings.panels[slot].color = progress.unlocked ? new Color(20, 49, 68, 255) : new Color(42, 49, 58, 255);
        });
        const pageCount = Math.ceil(restaurant.levelIds.length / 6);
        bindings.page.string = `${model.selection.levelPage + 1}/${pageCount}`;
        bindings.previous.color = model.selection.levelPage > 0 ? new Color(20, 49, 68, 255) : new Color(5, 15, 30, 255);
        bindings.next.color = model.selection.levelPage < pageCount - 1 ? new Color(20, 49, 68, 255) : new Color(5, 15, 30, 255);
    }

    private requireLevel<T>(value: T | null, name: string): T {
        if (!value || !isValid(value, true)) throw new Error(`Cook level binding is missing: ${name}`);
        return value;
    }

    private levelNode(value: Node | null, root: Node, name: string): Node {
        const node = this.requireLevel(value, name);
        let ancestor: Node | null = node.parent;
        while (ancestor && ancestor !== root) ancestor = ancestor.parent;
        if (ancestor !== root) throw new Error(`Cook level binding must belong to its root: ${name}`);
        return node;
    }

    private levelComponent<T extends { node: Node }>(value: T | null, root: Node, name: string): T {
        const component = this.requireLevel(value, name);
        this.levelNode(component.node, root, name);
        return component;
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
