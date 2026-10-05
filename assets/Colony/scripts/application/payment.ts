export interface DiamondProduct {
  id: 'diamonds-60' | 'diamonds-180' | 'diamonds-300';
  priceYuan: 6 | 18 | 30;
  diamonds: 60 | 180 | 300;
}

export const DIAMOND_PRODUCTS: readonly DiamondProduct[] = Object.freeze([
  Object.freeze({ id: 'diamonds-60', priceYuan: 6, diamonds: 60 }),
  Object.freeze({ id: 'diamonds-180', priceYuan: 18, diamonds: 180 }),
  Object.freeze({ id: 'diamonds-300', priceYuan: 30, diamonds: 300 }),
]);

export type PaymentOrder =
  | { status: 'unavailable'; productId: DiamondProduct['id']; message: string }
  | { status: 'pending'; productId: DiamondProduct['id']; orderId: string };

export type PaymentOrderStatus =
  | { status: 'unavailable'; orderId: string; message: string }
  | { status: 'pending' | 'failed'; orderId: string }
  | { status: 'confirmed'; orderId: string; productId: DiamondProduct['id']; diamonds: number };

/** A production provider must report confirmed only after server-side order verification. */
export interface PaymentPort {
  products(): readonly DiamondProduct[];
  createOrder(productId: DiamondProduct['id']): Promise<PaymentOrder>;
  queryOrder(orderId: string): Promise<PaymentOrderStatus>;
}

/** Local development never simulates a purchase or grants diamonds. */
export class UnavailablePaymentPort implements PaymentPort {
  public products(): readonly DiamondProduct[] { return DIAMOND_PRODUCTS; }
  public async createOrder(productId: DiamondProduct['id']): Promise<PaymentOrder> {
    return { status: 'unavailable', productId, message: '充值暂未开放' };
  }
  public async queryOrder(orderId: string): Promise<PaymentOrderStatus> {
    return { status: 'unavailable', orderId, message: '充值暂未开放' };
  }
}
