import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictError, ValidationError } from '../../src/domain/errors.js';
import { placeOrder, seededShop } from './fixtures.js';

function paidOrder(shop, items) {
  const order = placeOrder(shop, items);
  return shop.orders.pay(order.id, { amountMinor: order.totalMinor, reference: 'psp' });
}

test('refunding a paid order before shipping frees its held units', () => {
  const { shop } = seededShop();
  const order = paidOrder(shop, { 'KETTLE-1': 3 });
  const refunded = shop.orders.refund(order.id, { lines: [{ sku: 'KETTLE-1', quantity: 1 }], reason: 'changed mind' });
  assert.equal(refunded.refundedMinor, 4799);
  assert.equal(shop.inventory.getStock('KETTLE-1').available, 1);
  shop.orders.ship(order.id, { carrier: 'DHL' });
  assert.equal(shop.inventory.getStock('KETTLE-1').onHand, 1);
});

test('returned units go back on hand only with restock', () => {
  const { shop } = seededShop();
  const order = paidOrder(shop, { 'MUG-WHITE': 2 });
  shop.orders.ship(order.id, { carrier: 'DHL' });
  shop.orders.refund(order.id, { lines: [{ sku: 'MUG-WHITE', quantity: 1 }], reason: 'returned' });
  assert.equal(shop.inventory.getStock('MUG-WHITE').onHand, 19);
  const last = shop.orders.refund(order.id, { lines: [{ sku: 'MUG-WHITE', quantity: 1 }], restock: false, reason: 'broken' });
  assert.equal(shop.inventory.getStock('MUG-WHITE').onHand, 19);
  assert.equal(last.status, 'refunded');
  assert.equal(last.refundedMinor, order.totalMinor);
  assert.deepEqual(last.allowedActions, []);
});

test('cancelling a partly refunded paid order refunds only the rest', () => {
  const { shop } = seededShop();
  const order = paidOrder(shop, { 'KETTLE-1': 3 });
  shop.orders.refund(order.id, { lines: [{ sku: 'KETTLE-1', quantity: 1 }], reason: 'returned' });
  const cancelled = shop.orders.cancel(order.id, { reason: 'customer request' });
  assert.equal(cancelled.cancellation.refundMinor, order.totalMinor - 4799);
  assert.deepEqual(cancelled.refunds.map((refund) => refund.reason), ['returned', 'cancelled']);
  assert.equal(shop.inventory.getStock('KETTLE-1').available, 3);
});

test('a refund needs a reason and a refundable order', () => {
  const { shop } = seededShop();
  const placed = placeOrder(shop, { 'TEA-GREEN': 1 });
  assert.throws(() => shop.orders.refund(placed.id, { lines: [{ sku: 'TEA-GREEN', quantity: 1 }], reason: '' }), ValidationError);
  assert.throws(() => shop.orders.refund(placed.id, { lines: [{ sku: 'TEA-GREEN', quantity: 1 }], reason: 'x' }), ConflictError);
  assert.deepEqual(shop.orders.listRefunds(placed.id), { refunds: [], refundedMinor: 0 });
});

function discountedMugOrder(shop) {
  shop.promotions.addCoupon({ code: 'SAVE10', kind: 'percent', percent: 10 });
  const cart = shop.carts.createCart({ customerId: 'cust-1' });
  shop.carts.addItem(cart.id, { sku: 'MUG-WHITE', quantity: 3 });
  shop.carts.applyCoupon(cart.id, 'SAVE10');
  const order = shop.orders.checkout(cart.id);
  return shop.orders.pay(order.id, { amountMinor: order.totalMinor, reference: 'psp' });
}

test('refunding one of three discounted mugs pays back a third of what was paid for the line', () => {
  const { shop } = seededShop();
  const order = discountedMugOrder(shop);
  assert.equal(order.totalMinor, 4383);
  const refunded = shop.orders.refund(order.id, { lines: [{ sku: 'MUG-WHITE', quantity: 1 }], reason: 'returned' });
  assert.equal(refunded.refunds[0].amountMinor, 1296);
  assert.equal(refunded.refundedMinor, 1296);
});

test('cancelling a partly refunded discounted order pays back exactly the rest', () => {
  const { shop } = seededShop();
  const order = discountedMugOrder(shop);
  shop.orders.refund(order.id, { lines: [{ sku: 'MUG-WHITE', quantity: 1 }], reason: 'returned' });
  const cancelled = shop.orders.cancel(order.id, { reason: 'customer request' });
  assert.equal(cancelled.cancellation.refundMinor, 4383 - 1296);
  assert.equal(cancelled.refundedMinor, 4383);
  assert.equal(cancelled.refunds.reduce((sum, refund) => sum + refund.amountMinor, 0), order.totalMinor);
});

test('refunding every unit of a discounted order one by one never pays back more than the total', () => {
  const { shop } = seededShop();
  const order = discountedMugOrder(shop);
  let current = order;
  for (let i = 0; i < 3; i += 1) {
    current = shop.orders.refund(order.id, { lines: [{ sku: 'MUG-WHITE', quantity: 1 }], reason: 'returned' });
  }
  assert.equal(current.refundedMinor, order.totalMinor);
  assert.equal(current.status, 'refunded');
});
