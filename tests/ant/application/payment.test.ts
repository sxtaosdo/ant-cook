import assert from 'node:assert/strict';
import test from 'node:test';
import { DIAMOND_PRODUCTS, UnavailablePaymentPort } from '../../assets/Colony/scripts/application/payment.js';

test('diamond shop exposes fixed products without bonuses', () => {
  assert.deepEqual(DIAMOND_PRODUCTS, [
    { id: 'diamonds-60', priceYuan: 6, diamonds: 60 },
    { id: 'diamonds-180', priceYuan: 18, diamonds: 180 },
    { id: 'diamonds-300', priceYuan: 30, diamonds: 300 },
  ]);
});

test('unavailable payment provider never creates or confirms an order', async () => {
  const payment = new UnavailablePaymentPort();
  assert.equal((await payment.createOrder('diamonds-60')).status, 'unavailable');
  assert.deepEqual(await payment.queryOrder('missing-order'), {
    status: 'unavailable', orderId: 'missing-order', message: '充值暂未开放',
  });
});
