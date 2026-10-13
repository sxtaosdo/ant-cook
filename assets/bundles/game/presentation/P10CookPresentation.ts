import {
    Color,
    EventMouse,
    EventTouch,
    HorizontalTextAlignment,
    input,
    Input,
    isValid,
    Label,
    Node,
    Sprite,
    SpriteFrame,
    UIOpacity,
    UITransform,
    Vec3,
    VerticalTextAlignment,
} from 'cc';
import mk from 'mk';
import type { CocosPresentationPort } from 'db://shidai3/index';
import type { P10Intent, P10ReadModel, P10Screen } from '../application/contracts';
import { artPathFor, SCREEN_ART_MANIFEST, ScreenArtScreen } from '../ui/ScreenArtManifest';
import { applyViewportLayout, ViewportLayout } from '../ui/ViewportLayout';
import type { IntentInputPort } from './IntentInputPort';
import { KitchenFlowScreenGroup } from './KitchenFlowScreenGroup';
import { MapFlowScreenGroup } from './MapFlowScreenGroup';
import { ProgressionScreenGroup } from './ProgressionScreenGroup';
import { SettingsFlowScreenGroup } from './SettingsFlowScreenGroup';

const PANEL_FRAME_PATH = 'resources/ui/solid/spriteFrame';

const RESTAURANT_PRESENTATION = [
    { city: '北京', icon: '饼' },
    { city: '广州', icon: '茶' },
    { city: '成都', icon: '辣' },
    { city: '西安', icon: '面' },
    { city: '苏州', icon: '笼' },
    { city: '上海', icon: '烤' },
] as const;

const DISH_NAMES: Readonly<Record<string, string>> = {
    jianbing: '煎饼', soy_milk: '豆浆', tea_egg: '茶叶蛋',
    shrimp_dumpling: '虾饺', siu_mai: '烧麦', rice_roll: '肠粉',
    mapo_tofu: '麻婆豆腐', spicy_noodle: '麻辣小面', kungpao_chicken: '宫保鸡丁',
    beef_noodle: '牛肉面', roujiamo: '肉夹馍', lamb_skewer: '羊肉串',
    wonton: '馄饨', fried_bun: '生煎', sweet_rice_cake: '甜糕',
    grilled_fish: '烤鱼', oyster: '生蚝', seafood_skewer: '海鲜串',
};

const C = {
    ink: new Color(5, 15, 30, 255),
    panel: new Color(12, 31, 52, 246),
    panel2: new Color(20, 49, 68, 255),
    cyan: new Color(38, 231, 211, 255),
    jade: new Color(38, 184, 135, 255),
    red: new Color(235, 69, 66, 255),
    gold: new Color(255, 190, 73, 255),
    cream: new Color(255, 244, 213, 255),
    muted: new Color(150, 179, 190, 255),
    danger: new Color(203, 48, 64, 255),
    black: new Color(0, 0, 0, 255),
} as const;

export interface CookPageNavigation {
    showMap(): void; showUpgrade(): void; showDecor(): void; showStory(): void;
    showSettings(): void; showUnlock(): void; showRecovery(): void;
    showProductNavigation?(): void;
    canReceiveInput?(): boolean;
}

export class P10CookPresentation implements CocosPresentationPort<P10ReadModel> {
    private readModel: P10ReadModel | null = null;
    private renderedFingerprint = '';
    private panelFrame: SpriteFrame | null = null;
    private hudTime: Label | null = null;
    private hudPatience: Label | null = null;
    private hudOrder: Label | null = null;
    private hudProgress: Label | null = null;
    private tapTargets: Array<{ node: Node; action: () => void }> = [];
    private viewport!: ViewportLayout;
    private backgroundRoot: Node | null = null;
    private contentRoot: Node | null = null;
    private safeAreaRoot: Node | null = null;
    private modalRoot: Node | null = null;
    private activePageRoot: Node | null = null;
    private transition: Node | null = null;
    private transitionOpacity: UIOpacity | null = null;
    private transitionFadeElapsed = 0;
    private artRequestToken = 0;
    private active = false;
    private cleanupSteps: Map<string, () => Promise<unknown>> | null = null;
    private shutdownTask: Promise<void> | null = null;
    private pageView: mk.ViewBase | null = null;
    private pageType: typeof MapFlowScreenGroup | null = null;
    private renderTask: Promise<void> | null = null;
    private renderError: unknown = null;
    private artTask: Promise<void> = Promise.resolve();
    private inputEnabled = true;
    public get hasRenderFailure(): boolean { return this.renderError !== null; }
    private readonly pageTypes = [MapFlowScreenGroup, KitchenFlowScreenGroup, ProgressionScreenGroup, SettingsFlowScreenGroup];
    private get node(): Node { return this.pageView?.node ?? this.moduleRoot; }
    public setInputEnabled(enabled: boolean): void { this.inputEnabled = enabled; }
    public constructor(
        private readonly moduleRoot: Node,
        private readonly intents: IntentInputPort<P10Intent>,
        private readonly navigation: CookPageNavigation,
    ) {}

    public async initializeResources(): Promise<void> {
        if (this.active) return;
        this.active = true;
        this.viewport = applyViewportLayout();
        this.moduleRoot.getComponent(UITransform)?.setContentSize(this.viewport.width, this.viewport.height);
        input.on(Input.EventType.TOUCH_END, this.handlePointer, this);
        const names = ['MapFlowGroup', 'KitchenFlowGroup', 'ProgressionGroup', 'SettingsFlowGroup'];
        await Promise.all(this.pageTypes.map((type, index) => mk.uiManage.regis(type, `prefabs/${names[index]}`,
            this.moduleRoot, { parent: this.moduleRoot, loadConfig: { bundleStr: 'game' },
                poolInitFillNum: 0, poolMinHoldNum: 0, poolMaxHoldNum: 0 })));
        if (!this.active) return;
        this.panelFrame = await mk.asset.get(PANEL_FRAME_PATH, SpriteFrame, this.moduleRoot, { bundleStr: 'game' });
        if (!this.active) return;
        if (!this.panelFrame) throw new Error('Cook panel frame did not load');
        this.panelFrame.packable = false;
    }

    public shutdown(): Promise<void> {
        if (!this.shutdownTask) this.shutdownTask = this.cleanup().catch(cause => { this.shutdownTask = null; throw cause; });
        return this.shutdownTask;
    }
    private async cleanup(): Promise<void> {
        this.active = false; this.inputEnabled = false; this.artRequestToken += 1;
        input.off(Input.EventType.TOUCH_END, this.handlePointer, this); this.tapTargets = [];
        await this.renderTask?.catch(() => undefined);
        if (!this.cleanupSteps) {
            this.cleanupSteps = new Map(this.pageTypes.map(type => [type.name, () => mk.uiManage.unregis(type)]));
            const view = this.pageView;
            if (view) this.cleanupSteps.set('activeView', () => mk.uiManage.close(view, { isDestroy: true }));
        }
        const errors: unknown[] = [];
        await Promise.all([...this.cleanupSteps].map(async ([key, operation]) => {
            try { await operation(); this.cleanupSteps!.delete(key); } catch (cause) { errors.push(cause); }
        }));
        if (errors.length) throw new AggregateError(errors, 'Cook page cleanup failed');
        this.pageView = null;
    }

    public async settleRender(): Promise<void> {
        await this.renderTask;
        if (this.renderError) throw this.renderError;
    }

    public update(deltaTime: number): void {
        this.updateArtTransition(deltaTime);
    }

    public render(readModel: P10ReadModel, force = false): void {
        this.readModel = readModel;
        if (force) { this.renderedFingerprint = ''; this.renderError = null; this.hudTime = null; }
        if (this.renderError) return;
        if (!this.active || !this.panelFrame || this.renderTask) return;
        this.renderTask = this.renderLatest().catch(cause => { this.renderError = cause; this.inputEnabled = false; })
            .finally(() => { this.renderTask = null; });
    }

    private async renderLatest(): Promise<void> {
        while (this.active && this.readModel) {
            const readModel = this.readModel;
            const fingerprint = JSON.stringify(readModel);
            if (fingerprint === this.renderedFingerprint) return;
            const type = this.typeFor(readModel.screen);
            if (this.pageType !== type) {
                if (this.pageView) await mk.uiManage.close(this.pageView, { isDestroy: true });
                this.pageView = null;
                const page = await mk.uiManage.open(type);
                if (!page) throw new Error(`Cook page ${readModel.screen} did not open`);
                if (!this.active) { await mk.uiManage.close(page, { isDestroy: true }); return; }
                this.pageView = page;
                this.pageType = type;
                page.node.layer = this.moduleRoot.layer;
            }
            if (readModel.screen === 'kitchen' && this.hudTime) { this.refreshKitchenHud(); this.renderedFingerprint = fingerprint; continue; }
            switch (readModel.screen) {
                case 'map': this.showMap(); break;
                case 'level': this.showLevel(); break;
                case 'kitchen': this.showKitchen(); break;
                case 'pause': this.showPause(); break;
                case 'result': this.showResult(); break;
                case 'upgrade': this.showUpgrade(); break;
                case 'decor': this.showDecor(); break;
                case 'story': this.showStory(); break;
                case 'unlock': this.showUnlock(); break;
                case 'settings': this.showSettings(); break;
                case 'recovery': this.showRecovery(); break;
            }
            await this.artTask;
            this.renderedFingerprint = fingerprint;
        }
    }

    private typeFor(screen: P10Screen): typeof MapFlowScreenGroup {
        return screen === 'map' || screen === 'level' || screen === 'story' ? MapFlowScreenGroup
            : screen === 'kitchen' || screen === 'pause' || screen === 'result' ? KitchenFlowScreenGroup
            : screen === 'upgrade' || screen === 'decor' || screen === 'unlock' ? ProgressionScreenGroup
            : SettingsFlowScreenGroup;
    }

    private requireReadModel(): P10ReadModel {
        if (!this.readModel) throw new Error('P10ReadModel is not available');
        return this.readModel;
    }

    private publish(intent: P10Intent): void {
        if (!this.inputEnabled || this.navigation.canReceiveInput?.() === false) return;
        this.intents.publish(intent);
    }

    private dishName(id: string): string {
        return DISH_NAMES[id] ?? id;
    }

    private clear(screen: P10Screen): void {
        this.tapTargets = [];
        this.artRequestToken += 1;
        this.transitionOpacity = null;
        this.transitionFadeElapsed = 0;
        const settings = this.pageView instanceof SettingsFlowScreenGroup ? this.pageView : null;
        const fixedRoot = settings?.settingsRoot;
        // Settings and recovery share one MK View; keep the authored settings subtree alive.
        for (const child of [...this.node.children]) if (child !== fixedRoot) child.destroy();
        settings?.show(screen);
        this.backgroundRoot = this.contentRoot = this.safeAreaRoot = this.modalRoot = null;
        this.transition = null;
        this.hudTime = this.hudPatience = this.hudOrder = this.hudProgress = null;
        if (screen === 'settings') {
            this.activePageRoot = null;
            this.artTask = Promise.resolve();
            return;
        }
        this.backgroundRoot = this.layer('BackgroundRoot', 0);
        this.contentRoot = this.layer('ContentRoot', 1);
        this.safeAreaRoot = this.layer('SafeAreaRoot', 2);
        this.modalRoot = this.layer('ModalRoot', 3);
        this.activePageRoot = this.node;
        this.box('BackgroundFallback', this.backgroundRoot, 0, 0, this.viewport.width, this.viewport.height, C.ink);
        this.transition = this.box('ArtTransition', this.modalRoot, 0, 0, this.viewport.width, this.viewport.height, C.ink);
        this.artTask = this.showArt(screen);
        this.box('SceneShade', this.contentRoot, 0, 0, this.viewport.width, this.viewport.height, new Color(3, 12, 24, SCREEN_ART_MANIFEST[screen].overlayAlpha));
        this.box('CircuitTop', this.contentRoot, 0, 580, 750, 160, new Color(20, 49, 68, 218));
        this.box('CircuitBottom', this.contentRoot, 0, -620, 750, 80, new Color(20, 49, 68, 218));
    }

    private frame(title: string, subtitle: string, showBack = false): void {
        const progress = this.requireReadModel().progress;
        const top = this.viewport.topY;
        const safeRoot = this.safeAreaRoot!;
        const header = this.box('TopHeader', safeRoot, 0, top - 48, 688, 112, C.panel);
        this.neonBorder(header, 688, 112, C.cyan);
        this.text(title, safeRoot, -18, top - 34, 44, 650, 62, C.cream, HorizontalTextAlignment.LEFT, true);
        this.text(subtitle, safeRoot, -18, top - 81, 22, 650, 36, C.cyan, HorizontalTextAlignment.LEFT);
        this.text(`金币 ${progress.coins}  ★ ${progress.totalStars}`, safeRoot, 185, top - 7, 21, 310, 34, C.gold, HorizontalTextAlignment.RIGHT, true);
        if (showBack) this.button('返回', safeRoot, -286, this.viewport.bottomY + 33, 120, 66, C.panel2, () => {
            this.navigation.showMap();
        });
    }

    private showMap(): void {
        const model = this.requireReadModel();
        this.clear('map');
        this.frame('街巷食光', '六店烟火 · 霓虹食途');
        const sectionHeader = this.box('MapSectionHeader', this.node, 0, 454, 650, 58, C.panel2);
        this.text('选择餐厅', sectionHeader, 0, 0, 30, 620, 48, C.gold, HorizontalTextAlignment.CENTER, true);
        model.catalog.restaurants.forEach((restaurant, index) => {
            const presentation = RESTAURANT_PRESENTATION[index];
            const progress = model.progress.restaurants[restaurant.id];
            const x = index % 2 === 0 ? -174 : 174;
            const y = 330 - Math.floor(index / 2) * 252;
            const unlocked = progress.unlocked;
            const color = unlocked ? (index % 2 === 0 ? C.red : C.jade) : new Color(45, 57, 67, 255);
            const card = this.box(`Restaurant${index}`, this.node, x, y, 310, 210, C.panel);
            if (!unlocked) this.box('LockedOverlay', card, 0, 0, 302, 202, new Color(4, 11, 20, 225));
            this.neonBorder(card, 310, 210, unlocked ? color : C.muted);
            this.box('NeonEdge', card, 0, 94, 310, 10, color);
            this.text(unlocked ? presentation.icon : '锁', card, -104, 18, 54, 78, 78, color, HorizontalTextAlignment.CENTER, true);
            this.text(restaurant.name, card, 42, 38, 29, 190, 42, C.cream, HorizontalTextAlignment.LEFT, true);
            this.text(`${presentation.city} · ${restaurant.levelIds.length}关`, card, 42, -8, 19, 190, 34, unlocked ? C.cyan : C.muted, HorizontalTextAlignment.LEFT);
            this.text(unlocked ? `已开至第 ${progress.highestUnlockedLevel} 关` : '完成前店解锁', card, 42, -55, 18, 190, 30, unlocked ? C.gold : C.muted, HorizontalTextAlignment.LEFT);
            if (unlocked) this.tap(card, () => {
                this.publish({ type: 'p10.select-restaurant', payload: { restaurantIndex: index } });
            });
        });
        const navigationY = this.viewport.bottomY + 38;
        const navigation = this.box('MapNavigation', this.safeAreaRoot!, 0, navigationY, 696, 92, C.panel);
        this.neonBorder(navigation, 696, 92, C.cyan);
        this.button('升级', this.safeAreaRoot!, -228, navigationY, 132, 66, C.red, () => this.navigation.showUpgrade());
        this.button('装修', this.safeAreaRoot!, -76, navigationY, 132, 66, C.jade, () => this.navigation.showDecor());
        this.button('剧情', this.safeAreaRoot!, 76, navigationY, 132, 66, C.panel2, () => this.navigation.showStory());
        this.button('设置', this.safeAreaRoot!, 228, navigationY, 132, 66, C.panel2, () => this.navigation.showSettings());
    }

    private showLevel(): void {
        const model = this.requireReadModel();
        const { restaurantIndex, levelPage } = model.selection;
        const restaurant = model.catalog.restaurants[restaurantIndex] ?? model.catalog.restaurants[0];
        const presentation = RESTAURANT_PRESENTATION[restaurantIndex] ?? RESTAURANT_PRESENTATION[0];
        this.clear('level');
        this.frame(restaurant.name, `${presentation.city} · 今日营业`, true);
        this.box('Hero', this.node, 0, 350, 650, 238, C.panel);
        this.text(presentation.icon, this.node, -220, 352, 88, 150, 120, C.red, HorizontalTextAlignment.CENTER, true);
        this.text('灶火已开，迎接今晚食客', this.node, 75, 390, 30, 400, 50, C.cream, HorizontalTextAlignment.LEFT, true);
        this.text('完成订单 · 保持耐心 · 冲击连击', this.node, 75, 337, 21, 400, 40, C.cyan, HorizontalTextAlignment.LEFT);
        this.text('关卡选择', this.node, 0, 184, 28, 600, 42, C.gold, HorizontalTextAlignment.CENTER, true);
        const pageSize = 6;
        const pageCount = Math.ceil(restaurant.levelIds.length / pageSize);
        const pageStart = levelPage * pageSize;
        restaurant.levelIds.slice(pageStart, pageStart + pageSize).forEach((levelId, localIndex) => {
            const i = pageStart + localIndex;
            const x = -220 + (localIndex % 3) * 220;
            const y = 65 - Math.floor(localIndex / 3) * 142;
            const levelProgress = model.progress.levels[levelId];
            const unlocked = levelProgress.unlocked;
            const stars = '★'.repeat(levelProgress.bestStars) + '☆'.repeat(3 - levelProgress.bestStars);
            this.button(unlocked ? `${i + 1}\n${stars}` : '锁定', this.node, x, y, 184, 112, unlocked ? C.panel2 : new Color(42, 49, 58), () => {
                if (!unlocked) return;
                this.publish({ type: 'p10.start-level', payload: { levelIndex: i } });
            });
        });
        this.button('‹', this.node, -180, -168, 90, 54, levelPage > 0 ? C.panel2 : C.ink, () => {
            if (levelPage > 0) this.publish({ type: 'p10.set-level-page', payload: { page: levelPage - 1 } });
        });
        this.text(`${levelPage + 1}/${pageCount}`, this.node, 0, -168, 21, 150, 38, C.gold, HorizontalTextAlignment.CENTER, true);
        this.button('›', this.node, 180, -168, 90, 54, levelPage < pageCount - 1 ? C.panel2 : C.ink, () => {
            if (levelPage < pageCount - 1) this.publish({ type: 'p10.set-level-page', payload: { page: levelPage + 1 } });
        });
        this.box('Boost', this.node, 0, -245, 650, 120, C.panel);
        this.text('助力', this.node, -255, -236, 24, 90, 38, C.gold, HorizontalTextAlignment.LEFT, true);
        this.text('⚡ 快速出餐    ♨ 防焦护盾    ♥ 耐心加成', this.node, 60, -245, 21, 500, 46, C.cream, HorizontalTextAlignment.CENTER);
    }

    private showKitchen(): void {
        const model = this.requireReadModel();
        const level = model.level ?? model.catalog.levels[0];
        const { restaurantIndex, levelIndex } = model.selection;
        if (!level) return;
        this.clear('kitchen');
        const restaurant = model.catalog.restaurants[restaurantIndex] ?? model.catalog.restaurants[0];
        this.frame(`${restaurant.name} · ${levelIndex + 1}`, '高峰营业中');
        this.button('Ⅱ', this.safeAreaRoot!, 292, this.viewport.topY - 94, 72, 62, C.panel2, () => this.publish({ type: 'p10.pause', payload: {} }));
        this.box('Hud', this.node, 0, 430, 650, 150, C.panel);
        this.hudTime = this.text('', this.node, -220, 452, 30, 190, 50, C.gold, HorizontalTextAlignment.CENTER, true);
        this.hudPatience = this.text('', this.node, 0, 452, 28, 220, 50, C.cyan, HorizontalTextAlignment.CENTER, true);
        this.hudProgress = this.text('', this.node, 225, 452, 28, 190, 50, C.cream, HorizontalTextAlignment.CENTER, true);
        this.text('顾客订单', this.node, 0, 316, 25, 620, 40, C.gold, HorizontalTextAlignment.CENTER, true);
        this.box('OrderCard', this.node, 0, 232, 610, 220, C.panel2);
        this.hudOrder = this.text('', this.node, 0, 228, 38, 560, 58, C.cream, HorizontalTextAlignment.CENTER, true);
        this.text('点击对应菜品完成上菜，错误操作会损失耐心', this.node, 0, 160, 18, 580, 32, C.muted, HorizontalTextAlignment.CENTER);
        this.box('Counter', this.node, 0, -38, 650, 230, C.panel);
        this.text('备餐台', this.node, 0, 58, 23, 600, 36, C.cyan, HorizontalTextAlignment.CENTER, true);
        level.dishPool.forEach((dishId, index) => {
            const x = -210 + index * 210;
            const buttonColor = index % 2 === 0 ? C.red : C.jade;
            this.button(this.dishName(dishId), this.node, x, -35, 180, 118, buttonColor, () => this.serve(dishId));
        });
        this.box('Station', this.node, 0, -265, 650, 170, C.panel2);
        this.text('切配  ✓    炉灶  ♨    装盘  ◎', this.node, 0, -235, 28, 590, 48, C.cream, HorizontalTextAlignment.CENTER, true);
        this.text('连击提升金币；顾客耐心耗尽或时间归零将失败', this.node, 0, -307, 19, 600, 38, C.gold, HorizontalTextAlignment.CENTER);
        this.refreshKitchenHud();
    }

    private serve(dishId: string): void {
        const model = this.requireReadModel();
        if (model.screen !== 'kitchen' || !model.kitchen) return;
        const pending = model.kitchen.orders.find((order) => order.state === 'Pending');
        if (!pending) return;
        this.publish({ type: 'p10.serve-dish', payload: { dishId } });
    }

    private refreshKitchenHud(): void {
        const snapshot = this.requireReadModel().kitchen;
        if (!this.hudTime || !snapshot) return;
        const pending = snapshot.orders.find((order) => order.state === 'Pending');
        const patience = pending ? Math.round(pending.patienceRemaining / pending.patienceMax * 100) : 0;
        this.hudTime.string = `时间 ${Math.ceil(snapshot.remainingSeconds)}s`;
        this.hudPatience!.string = `耐心 ${patience}%`;
        this.hudProgress!.string = `${snapshot.servedOrders}/${snapshot.orders.length}  连击×${snapshot.combo}`;
        this.hudOrder!.string = pending ? `请上：${this.dishName(pending.dishId)}` : '订单已处理完毕';
        this.hudPatience!.color = patience < 30 ? C.danger : C.cyan;
    }

    private showPause(): void {
        const model = this.requireReadModel();
        this.clear('pause');
        this.frame('营业暂停', '计时与顾客耐心已冻结');
        const snapshot = model.kitchen;
        this.text('Ⅱ', this.node, 0, 260, 110, 180, 150, C.cyan, HorizontalTextAlignment.CENTER, true);
        this.text(`已完成 ${snapshot?.servedOrders ?? 0}/${snapshot?.orders.length ?? 0} · 剩余 ${Math.ceil(snapshot?.remainingSeconds ?? 0)}秒`, this.node, 0, 120, 25, 600, 48, C.cream, HorizontalTextAlignment.CENTER);
        this.button('继续营业', this.node, 0, -10, 420, 86, C.jade, () => this.publish({ type: 'p10.resume', payload: {} }));
        this.button('重新开始', this.node, 0, -125, 420, 78, C.panel2, () => this.publish({ type: 'p10.restart', payload: { reason: 'pause-menu' } }));
        this.button('退出关卡', this.node, 0, -230, 420, 78, C.danger, () => {
            this.publish({ type: 'p10.abandon', payload: {} });
        });
    }

    private showResult(): void {
        const model = this.requireReadModel();
        const { lastSuccess } = model;
        this.clear('result');
        this.frame(lastSuccess ? '营业成功' : '营业失败', lastSuccess ? '烟火正盛，口碑上涨' : '调整节奏，再燃灶火');
        const summary = this.box('ResultSummary', this.node, 0, 230, 560, 300, C.panel);
        this.neonBorder(summary, 560, 300, lastSuccess ? C.gold : C.red);
        this.text(lastSuccess ? '福' : '再', summary, 0, 70, 118, 220, 180, lastSuccess ? C.gold : C.red, HorizontalTextAlignment.CENTER, true);
        const stars = model.result?.stars ?? 0;
        this.text('★'.repeat(stars) + '☆'.repeat(3 - stars), summary, 0, -80, 58, 500, 80, lastSuccess ? C.gold : C.muted, HorizontalTextAlignment.CENTER, true);
        const score = model.result?.score ?? 0;
        this.box('ScoreCard', this.node, 0, 18, 560, 128, C.panel);
        this.text(`得分 ${score}   星级 ${stars}`, this.node, 0, 32, 24, 520, 48, C.cream, HorizontalTextAlignment.CENTER, true);
        this.text(lastSuccess ? '奖励已保存至安全档' : '本局不扣除资源', this.node, 0, -25, 19, 500, 34, C.cyan, HorizontalTextAlignment.CENTER);
        const restaurant = model.catalog.restaurants[model.selection.restaurantIndex] ?? model.catalog.restaurants[0];
        const chapterComplete = lastSuccess && model.selection.levelIndex >= restaurant.levelIds.length - 1;
        const allContentComplete = chapterComplete && model.selection.restaurantIndex === model.catalog.restaurants.length - 1;
        this.button(lastSuccess ? (allContentComplete ? '查看全内容完成' : chapterComplete ? '查看新店' : '继续下一关') : '再次挑战', this.node, 0, -150, 450, 88, lastSuccess ? C.jade : C.red, () => {
            this.publish({ type: 'p10.next-after-result', payload: {} });
        });
        this.button('返回地图', this.node, 0, -265, 450, 76, C.panel2, () => this.navigation.showMap());
        if (chapterComplete) this.button('查看解锁', this.node, 0, -365, 450, 70, C.gold, () => this.navigation.showUnlock());
    }

    private showUpgrade(): void {
        const model = this.requireReadModel();
        this.clear('upgrade');
        this.frame('工位升级', '更快加工 · 更稳出餐', true);
        const restaurantIndex = model.selection.restaurantIndex;
        const restaurant = model.catalog.restaurants[restaurantIndex] ?? model.catalog.restaurants[0];
        const stationIds = ['prep', 'grill', 'tray'];
        const names = ['精工切配台', '聚能霓虹灶', '恒温装盘台'];
        names.forEach((name, index) => {
            const y = 330 - index * 220;
            const quote = model.upgradeQuotes[stationIds[index]];
            const level = quote?.currentLevel ?? 1;
            const cost = quote?.price ?? null;
            const affordable = quote?.affordable ?? false;
            this.box(`Upgrade${index}`, this.node, 0, y, 640, 176, C.panel);
            this.text(['刀', '火', '盘'][index], this.node, -245, y + 6, 54, 90, 80, index === 1 ? C.red : C.cyan, HorizontalTextAlignment.CENTER, true);
            this.text(`${name}  Lv.${level}`, this.node, -25, y + 38, 28, 370, 44, C.cream, HorizontalTextAlignment.LEFT, true);
            this.text(`效率 +${level * 8}% · 下级 +8%`, this.node, -25, y - 12, 20, 370, 34, C.cyan, HorizontalTextAlignment.LEFT);
            this.button(cost === null ? '已满级' : `${cost} 金币`, this.node, 210, y - 8, 180, 64, affordable ? C.jade : C.danger, () => {
                if (!affordable) return;
                this.publish({ type: 'p10.purchase-upgrade', payload: { restaurantId: restaurant.id, stationId: stationIds[index] } });
            });
        });
        this.text('升级永久生效，资源不足时按钮显示赤色', this.node, 0, -385, 20, 620, 38, C.muted, HorizontalTextAlignment.CENTER);
    }

    private showDecor(): void {
        const model = this.requireReadModel();
        this.clear('decor');
        this.frame('餐厅装修', '旧巷新霓 · 烟火焕新', true);
        const restaurant = model.catalog.restaurants[model.selection.restaurantIndex] ?? model.catalog.restaurants[0];
        const progress = model.progress.restaurants[restaurant.id];
        const names = ['雨巷霓虹门楼', '电子水墨灯阵', '赛博灶神壁画'];
        names.forEach((name, index) => {
            const y = 330 - index * 220;
            const milestone = restaurant.renovationMilestones[index];
            const active = progress.renovations.includes(milestone);
            this.box(`Decor${index}`, this.node, 0, y, 640, 178, active ? C.panel2 : C.panel);
            this.text(['门', '灯', '神'][index], this.node, -240, y + 5, 58, 100, 80, active ? C.gold : C.muted, HorizontalTextAlignment.CENTER, true);
            this.text(name, this.node, -20, y + 35, 27, 380, 42, C.cream, HorizontalTextAlignment.LEFT, true);
            this.text(active ? '已布置 · 里程碑达成' : `通关第 ${milestone} 关解锁`, this.node, -20, y - 14, 20, 380, 34, active ? C.cyan : C.muted, HorizontalTextAlignment.LEFT);
            this.button(active ? '已启用' : '未解锁', this.node, 225, y - 5, 150, 62, active ? C.jade : C.panel2, () => undefined);
        });
        this.text(`当前餐厅声望：${model.progress.reputation}`, this.node, 0, -380, 22, 600, 40, C.gold, HorizontalTextAlignment.CENTER, true);
    }

    private showStory(): void {
        const model = this.requireReadModel();
        const storyPage = model.selection.storyPage;
        const restaurant = model.catalog.restaurants[model.selection.restaurantIndex] ?? model.catalog.restaurants[0];
        const pages = restaurant.levelIds.map((id) => model.catalog.levels.find((candidate) => candidate.id === id)!).filter(Boolean);
        const story = pages[storyPage] ?? pages[0];
        this.clear('story');
        this.frame('剧情档案', `章节 ${storyPage + 1}/${pages.length}`, true);
        this.box('StoryArt', this.node, 0, 180, 640, 430, C.panel);
        this.text(['雨', '巷', '火'][storyPage % 3], this.node, 0, 245, 150, 280, 210, storyPage % 3 === 2 ? C.red : C.cyan, HorizontalTextAlignment.CENTER, true);
        this.text(story.story.title, this.node, 0, 52, 34, 560, 52, C.gold, HorizontalTextAlignment.CENTER, true);
        this.box('Dialogue', this.node, 0, -140, 640, 190, C.panel2);
        this.text('掌勺人', this.node, -235, -86, 22, 130, 36, C.cyan, HorizontalTextAlignment.LEFT, true);
        this.text(story.story.intro, this.node, 0, -145, 23, 560, 100, C.cream, HorizontalTextAlignment.LEFT);
        this.button(storyPage < pages.length - 1 ? '继续' : '完成', this.node, 0, -310, 360, 80, C.red, () => {
            if (storyPage < pages.length - 1) {
                this.publish({ type: 'p10.set-story-page', payload: { page: storyPage + 1 } });
            } else {
                this.publish({ type: 'p10.set-story-page', payload: { page: 0 } });
                this.navigation.showMap();
            }
        });
    }

    private showUnlock(): void {
        const model = this.requireReadModel();
        this.clear('unlock');
        this.frame('内容解锁', '新的烟火坐标已接入');
        this.text('解', this.node, 0, 300, 130, 230, 180, C.gold, HorizontalTextAlignment.CENTER, true);
        const restaurants = model.catalog.restaurants;
        const unlockedCount = restaurants.filter((restaurant) => model.progress.restaurants[restaurant.id].unlocked).length;
        const allContentComplete = model.progress.restaurants[restaurants[restaurants.length - 1].id].chapterComplete;
        const next = Math.max(0, Math.min(restaurants.length - 1, unlockedCount - 1));
        this.text(allContentComplete ? '全城烟火' : restaurants[next].name, this.node, 0, 126, 42, 620, 64, C.cream, HorizontalTextAlignment.CENTER, true);
        this.text(allContentComplete ? '六店全部通关' : `${RESTAURANT_PRESENTATION[next].city} · 新章节`, this.node, 0, 62, 24, 600, 42, C.cyan, HorizontalTextAlignment.CENTER);
        this.box('UnlockList', this.node, 0, -90, 580, 130, C.panel);
        this.text(allContentComplete ? '全部餐厅  +  全部菜谱  +  全部故事' : '新餐厅  +  新菜谱  +  新顾客故事', this.node, 0, -76, 23, 540, 44, C.gold, HorizontalTextAlignment.CENTER, true);
        this.button(allContentComplete ? '返回地图' : '领取并前往', this.node, 0, -235, 430, 86, C.jade, () => {
            this.navigation.showMap();
        });
    }

    private showSettings(): void {
        const model = this.requireReadModel();
        this.clear('settings');
        const view = this.pageView;
        if (!(view instanceof SettingsFlowScreenGroup)) throw new Error('Cook settings view is unavailable');
        view.presentSettings(model, this.viewport);
        const bindings = view.settingsBindings();
        this.transition = view.transition;
        if (this.transition) this.transition.active = true;
        this.finishArtTransition();
        const settings = model.progress.settings;
        this.tap(bindings.effects, () => {
            this.publish({ type: 'p10.toggle-setting', payload: { key: 'effectsVolume', value: settings.effectsVolume > 0 ? 0 : 1 } });
        });
        this.tap(bindings.music, () => {
            this.publish({ type: 'p10.toggle-setting', payload: { key: 'musicVolume', value: settings.musicVolume > 0 ? 0 : 1 } });
        });
        this.tap(bindings.colorBlind, () => {
            this.publish({ type: 'p10.toggle-setting', payload: { key: 'colorBlindMode', value: !settings.colorBlindMode } });
        });
        this.tap(bindings.reducedMotion, () => {
            this.publish({ type: 'p10.toggle-setting', payload: { key: 'reducedMotion', value: !settings.reducedMotion } });
        });
        this.tap(bindings.back, () => this.navigation.showMap());
        this.tap(bindings.recovery, () => this.navigation.showRecovery());
        this.tap(bindings.product, () => this.navigation.showProductNavigation?.());
    }

    private showRecovery(): void {
        const model = this.requireReadModel();
        this.clear('recovery');
        this.frame('存档恢复', '检查点有效 · 可安全回退', true);
        const progress = model.progress;
        this.text('盾', this.node, 0, 300, 110, 200, 160, C.cyan, HorizontalTextAlignment.CENTER, true);
        this.box('Checkpoint', this.node, 0, 110, 610, 180, C.panel);
        this.text('最近安全检查点', this.node, -200, 155, 24, 300, 40, C.gold, HorizontalTextAlignment.LEFT, true);
        this.text(`金币 ${progress.coins} · 星章 ${progress.totalStars} · 声望 ${progress.reputation}`, this.node, 0, 92, 22, 540, 40, C.cream, HorizontalTextAlignment.CENTER);
        this.text(progress.hasCheckpoint ? '检查点有效，可恢复关卡' : '安全档有效，无未完成关卡', this.node, 0, 42, 19, 540, 34, C.cyan, HorizontalTextAlignment.CENTER);
        this.button(progress.hasCheckpoint ? '恢复检查点' : '返回地图', this.node, 0, -90, 450, 82, C.jade, () => {
            if (progress.hasCheckpoint) this.publish({ type: 'p10.resume-checkpoint', payload: {} });
            else this.navigation.showMap();
        });
        this.button('重置演示存档', this.node, 0, -205, 450, 76, C.danger, () => {
            this.publish({ type: 'p10.reset-save', payload: {} });
        });
        this.text('重置只影响本地演示数据，不操作微信云存档', this.node, 0, -340, 19, 610, 38, C.muted, HorizontalTextAlignment.CENTER);
    }

    private async showArt(name: ScreenArtScreen): Promise<void> {
        const owner = this.backgroundRoot;
        if (!owner) throw new Error('Cook art owner is missing');
        const requestToken = this.artRequestToken;
        const artPath = artPathFor(name, this.requireReadModel().lastSuccess);
        const frame = await mk.asset.get(artPath, SpriteFrame, null, { bundleStr: 'game' });
        if (!frame) throw new Error(`Cook art did not load: ${artPath}`);
        if (!this.active || requestToken !== this.artRequestToken || !isValid(owner, true)) {
            mk.Release.release(frame);
            return;
        }
        mk.Release.followRelease(owner, frame);
        const node = new Node(`Art_${name}`);
        owner.addChild(node);
        node.layer = this.node.layer;
        const sprite = node.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.color = Color.WHITE;
        const source = frame.originalSize;
        const scale = Math.max(this.viewport.width / Math.max(1, source.width), this.viewport.height / Math.max(1, source.height));
        node.addComponent(UITransform).setContentSize(source.width * scale, source.height * scale);
        sprite.spriteFrame = frame;
        this.finishArtTransition();
    }

    private finishArtTransition(): void {
        const transition = this.transition;
        if (!transition || !isValid(transition, true)) return;
        const opacity = transition.getComponent(UIOpacity) ?? transition.addComponent(UIOpacity);
        if (this.requireReadModel().progress.settings.reducedMotion) {
            transition.active = false;
            return;
        }
        opacity.opacity = 255;
        this.transitionOpacity = opacity;
        this.transitionFadeElapsed = 0;
    }

    private updateArtTransition(deltaTime: number): void {
        const opacity = this.transitionOpacity;
        if (!opacity || !isValid(opacity, true)) {
            this.transitionOpacity = null;
            return;
        }
        this.transitionFadeElapsed += deltaTime;
        opacity.opacity = Math.max(0, Math.round(255 * (1 - this.transitionFadeElapsed / 0.16)));
        if (this.transitionFadeElapsed >= 0.16) {
            opacity.node.active = false;
            this.transitionOpacity = null;
        }
    }

    private layer(name: string, siblingIndex: number): Node {
        const node = new Node(name);
        this.node.addChild(node);
        node.layer = this.node.layer;
        node.setSiblingIndex(siblingIndex);
        node.addComponent(UITransform).setContentSize(this.viewport.width, this.viewport.height);
        return node;
    }

    private box(name: string, parent: Node, x: number, y: number, width: number, height: number, color: Color): Node {
        if (parent === this.node && this.activePageRoot) parent = this.activePageRoot;
        const node = new Node(name);
        parent.addChild(node);
        node.layer = parent.layer;
        node.setPosition(new Vec3(x, y, 0));
        const transform = node.addComponent(UITransform);
        const sprite = node.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.type = Sprite.Type.SIMPLE;
        sprite.spriteFrame = this.panelFrame;
        sprite.color = color;
        transform.setContentSize(width, height);
        if (name.startsWith('Button_') || name === 'Hud' || name === 'OrderCard' || name === 'ScoreCard' || name === 'Checkpoint') {
            this.neonBorder(node, width, height, color === C.red || color === C.danger ? C.red : C.cyan);
        }
        if (this.transition && parent === this.modalRoot && isValid(this.transition, true)) {
            this.transition.setSiblingIndex(parent.children.length - 1);
        }
        return node;
    }

    private neonBorder(parent: Node, width: number, height: number, color: Color): void {
        const addStrip = (name: string, x: number, y: number, stripWidth: number, stripHeight: number): void => {
            const strip = new Node(name);
            parent.addChild(strip);
            strip.layer = parent.layer;
            strip.setPosition(x, y);
            const transform = strip.addComponent(UITransform);
            const sprite = strip.addComponent(Sprite);
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            sprite.type = Sprite.Type.SIMPLE;
            sprite.spriteFrame = this.panelFrame;
            sprite.color = new Color(color.r, color.g, color.b, 205);
            transform.setContentSize(stripWidth, stripHeight);
        };
        addStrip('NeonTop', 0, height / 2 - 2, width, 4);
        addStrip('NeonBottom', 0, -height / 2 + 2, width, 4);
        addStrip('NeonLeft', -width / 2 + 2, 0, 4, height);
        addStrip('NeonRight', width / 2 - 2, 0, 4, height);
    }

    private text(
        value: string,
        parent: Node,
        x: number,
        y: number,
        fontSize: number,
        width: number,
        height: number,
        color: Color,
        align = HorizontalTextAlignment.CENTER,
        outline = false,
    ): Label {
        if (parent === this.node && this.activePageRoot) parent = this.activePageRoot;
        const node = new Node(`Text_${value.slice(0, 8)}`);
        parent.addChild(node);
        node.layer = parent.layer;
        node.setPosition(new Vec3(x, y, 0));
        const transform = node.addComponent(UITransform);
        transform.setContentSize(width, height);
        const label = node.addComponent(Label);
        label.string = value;
        label.fontSize = fontSize;
        label.lineHeight = Math.round(fontSize * 1.3);
        label.color = color;
        label.horizontalAlign = align;
        label.verticalAlign = VerticalTextAlignment.CENTER;
        label.overflow = Label.Overflow.SHRINK;
        if (outline) {
            label.enableOutline = true;
            label.outlineColor = C.black;
            label.outlineWidth = 2;
        }
        if (this.transition && parent === this.modalRoot && isValid(this.transition, true)) {
            this.transition.setSiblingIndex(parent.children.length - 1);
        }
        return label;
    }

    private button(label: string, parent: Node, x: number, y: number, width: number, height: number, color: Color, action: () => void): Node {
        const node = this.box(`Button_${label.replace(/\n/g, '_')}`, parent, x, y, width, height, color);
        this.text(label, node, 0, 0, Math.min(25, Math.round(height * 0.28)), width - 18, height - 10, C.cream, HorizontalTextAlignment.CENTER, true);
        this.tap(node, action);
        return node;
    }

    private tap(node: Node, action: () => void): void {
        this.tapTargets.push({ node, action });
    }

    private handlePointer(event: EventTouch | EventMouse): void {
        if (!this.inputEnabled || !this.active || this.navigation.canReceiveInput?.() === false) return;
        const point = event.getUILocation();
        for (let index = this.tapTargets.length - 1; index >= 0; index -= 1) {
            const target = this.tapTargets[index];
            if (!target.node.isValid || !target.node.activeInHierarchy) continue;
            const transform = target.node.getComponent(UITransform);
            if (transform?.getBoundingBoxToWorld().contains(point)) {
                target.action();
                return;
            }
        }
    }
}
