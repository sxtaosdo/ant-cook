export type FoodState = 'Idle' | 'Cooking' | 'Ready' | 'Burnt';
export interface ProductionSlotReadModel {
  readonly id: string; readonly stationId: string; readonly dishId: string | null; readonly stationLabel?: string; readonly dishLabel?: string | null;
  readonly toppingIds: readonly string[]; readonly state: FoodState; readonly remainingSeconds: number; readonly burnRemainingSeconds: number | null;
}
export interface CustomerItemReadModel { readonly id: string; readonly dishId: string; readonly toppingIds: readonly string[]; readonly dishLabel: string; readonly state: 'Pending' | 'Served' | 'Expired'; }
export interface CustomerReadModel {
  readonly id: string; readonly state: 'Waiting' | 'Active' | 'Served' | 'Lost';
  readonly patienceRemaining: number; readonly patienceMax: number; readonly items: readonly CustomerItemReadModel[];
}
export interface KitchenProductionReadModel {
  readonly recipes: readonly { readonly dishId: string; readonly label: string; readonly plateStationId?: string; readonly toppings: readonly { readonly id: string; readonly label: string }[] }[];
  readonly slots: readonly ProductionSlotReadModel[]; readonly customers: readonly CustomerReadModel[];
  readonly baseCoins: number; readonly comboCoins: number; readonly earnedCoins: number;
  readonly burntCount: number; readonly discardedCount: number; readonly elapsedSeconds: number;
  readonly configSource: string;
  readonly goal: { readonly mode: 'timed' | 'customers'; readonly metric: 'coins' | 'dishes' | 'customers'; readonly target: number; readonly current: number };
  readonly keepEarningsOnFailure: boolean;
}
