import { ProductionKitchen } from './productionKitchen';
import type { KitchenRules } from './kitchenRules';
import type { KitchenRunReadModel, LevelConfig, OrderReadModel } from './types';
import { RunStatus } from './types';

interface MutableOrder {
    id: string;
    dishId: string;
    state: 'Pending' | 'Served' | 'Expired';
    patienceRemaining: number;
    patienceMax: number;
    baseScore: number;
}

export class KitchenRun {
    private readonly production: ProductionKitchen | null;
    private readonly config: LevelConfig;
    private readonly attemptIdValue: string;
    private readonly orders: MutableOrder[];
    private statusValue: KitchenRunReadModel['status'] = RunStatus.Running;
    private remainingSecondsValue: number;
    private scoreValue = 0;
    private comboValue = 0;
    private maxComboValue = 0;
    private servedOrdersValue = 0;
    private lostCustomersValue = 0;
    private starsValue = 0;
    private failureReasonValue: KitchenRunReadModel['failureReason'];

    public constructor(config: LevelConfig, attemptId: string, options?: { rules: KitchenRules; upgrades: Readonly<Record<string, number>> }) {
        if (!attemptId.trim()) {
            throw new Error('attemptId is required');
        }
        this.production = options ? new ProductionKitchen(config, attemptId, options.rules, options.upgrades) : null;
        this.config = config;
        this.attemptIdValue = attemptId;
        this.remainingSecondsValue = config.durationSeconds;
        this.orders = Array.from({ length: config.orderCount }, (_, index) => ({
            id: `${attemptId}-order-${index + 1}`,
            dishId: config.dishPool[index % config.dishPool.length],
            state: 'Pending',
            patienceRemaining: config.orderPatienceSeconds + index * 2,
            patienceMax: config.orderPatienceSeconds + index * 2,
            baseScore: config.orderBaseScore,
        }));
    }

    public get snapshot(): KitchenRunReadModel {
        if (this.production) return this.production.snapshot;
        return {
            levelId: this.config.id,
            attemptId: this.attemptIdValue,
            status: this.statusValue,
            remainingSeconds: this.remainingSecondsValue,
            score: this.scoreValue,
            combo: this.comboValue,
            maxCombo: this.maxComboValue,
            servedOrders: this.servedOrdersValue,
            lostCustomers: this.lostCustomersValue,
            stars: this.starsValue,
            failureReason: this.failureReasonValue,
            orders: this.orders.map((order): OrderReadModel => ({ ...order })),
        };
    }

    public startCooking(dishId: string): KitchenRunReadModel { return this.requireProduction().startCooking(dishId); }
    public addTopping(slotId: string, toppingId: string): KitchenRunReadModel { return this.requireProduction().addTopping(slotId, toppingId); }
    public serveReady(slotId: string, customerId?: string): KitchenRunReadModel { return this.requireProduction().serveReady(slotId, customerId); }
    public discardFood(slotId: string): KitchenRunReadModel { return this.requireProduction().discardFood(slotId); }
    private requireProduction(): ProductionKitchen { if (!this.production) throw new Error('Production rules are not configured'); return this.production; }

    public serveOrder(orderId: string): KitchenRunReadModel {
        if (this.production) throw new Error('请先制作，再点击成熟成品上菜');
        this.requireRunning();
        const order = this.orders.find((candidate) => candidate.id === orderId);
        if (!order || order.state !== 'Pending') {
            throw new Error(`Order is not available: ${orderId}`);
        }

        const patienceRatio = order.patienceRemaining / order.patienceMax;
        const patienceBonus = Math.floor(order.baseScore * 0.5 * patienceRatio);
        const comboBonus = this.comboValue * 10;
        this.scoreValue += order.baseScore + patienceBonus + comboBonus;
        order.state = 'Served';
        this.servedOrdersValue += 1;
        this.comboValue += 1;
        this.maxComboValue = Math.max(this.maxComboValue, this.comboValue);
        this.resolveEndCondition();
        return this.snapshot;
    }

    public tick(seconds: number): KitchenRunReadModel {
        if (this.production) return this.production.tick(seconds);
        this.requireRunning();
        if (!Number.isFinite(seconds) || seconds < 0) {
            throw new Error('tick seconds must be a non-negative finite number');
        }

        this.remainingSecondsValue = Math.max(0, this.remainingSecondsValue - seconds);
        let expired = false;
        for (const order of this.orders) {
            if (order.state !== 'Pending') {
                continue;
            }
            order.patienceRemaining = Math.max(0, order.patienceRemaining - seconds);
            if (order.patienceRemaining === 0) {
                order.state = 'Expired';
                this.lostCustomersValue += 1;
                expired = true;
            }
        }
        if (expired) {
            this.comboValue = 0;
        }
        this.resolveEndCondition();
        return this.snapshot;
    }

    private resolveEndCondition(): void {
        if (this.lostCustomersValue >= this.config.maxLostCustomers) {
            this.finishFailed('TOO_MANY_LOST');
            return;
        }

        const allOrdersResolved = this.orders.every((order) => order.state !== 'Pending');
        if (!allOrdersResolved && this.remainingSecondsValue > 0) {
            return;
        }

        this.starsValue = this.config.starThresholds.filter((threshold) => this.scoreValue >= threshold).length;
        if (this.starsValue > 0) {
            this.statusValue = RunStatus.Completed;
        } else {
            this.finishFailed('TARGET_NOT_MET');
        }
    }

    private finishFailed(reason: 'TARGET_NOT_MET' | 'TOO_MANY_LOST'): void {
        this.statusValue = RunStatus.Failed;
        this.failureReasonValue = reason;
        this.starsValue = 0;
    }

    private requireRunning(): void {
        if (this.statusValue !== RunStatus.Running) {
            throw new Error(`Kitchen run is already ${this.statusValue}`);
        }
    }
}
