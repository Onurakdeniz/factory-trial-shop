import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictError, InsufficientStockError, InvalidTransitionError, ValidationError } from '../../src/domain/errors.js';
import { placeOrder, seededShop } from './fixtures.js';

test('checkout creates a placed order and holds its stock', () => {
  const { shop } = seededShop();
  const order = placeOrder(shop, { 'TEA-GREEN': 3, 'MUG-WHITE': 2 });
  assert.equal(order.status, 'placed');
  assert.equal(order.totalMinor, 4860);
  assert.deepEqual(order.allowedActions, ['pay', 'cancel']);
  assert.equal(shop.inventory.getStock('MUG-WHITE').available, 18);
  assert.equal(shop.carts.getCart(order.cartId).status, 'checked_out');
});

test('an order keeps its prices when the catalog changes', () => {
  const { shop } = seededShop();
  const order = placeOrder(shop, { 'BOOK-BREW': 1 });
  shop.catalog.updateProduct('BOOK-BREW', { basePriceMinor: 9999 });
  assert.equal(shop.orders.getOrder(order.id).subtotalMinor, 2500);
});

test('checkout fails as a whole when one line is short', () => {
  const { shop } = seededShop();
  assert.throws(() => placeOrder(shop, { 'TEA-GREEN': 2, 'KETTLE-1': 4 }), InsufficientStockError);
  assert.equal(shop.inventory.getStock('TEA-GREEN').available, 100);
  assert.equal(shop.orders.listOrders().length, 0);
});

test('an empty or checked-out cart cannot be checked out', () => {
  const { shop } = seededShop();
  const cart = shop.carts.createCart({ customerId: 'cust-1' });
  assert.throws(() => shop.orders.checkout(cart.id), ConflictError);
  const order = placeOrder(shop, { 'TEA-GREEN': 1 });
  assert.throws(() => shop.orders.checkout(order.cartId), ConflictError);
});

test('pay, ship and deliver take the units off hand', () => {
  const { shop } = seededShop();
  const order = placeOrder(shop, { 'KETTLE-1': 2 });
  shop.orders.pay(order.id, { amountMinor: order.totalMinor, reference: 'psp-1' });
  assert.equal(shop.inventory.getStock('KETTLE-1').onHand, 3);
  shop.orders.ship(order.id, { carrier: 'DHL', trackingCode: 'JD01' });
  assert.deepEqual(shop.inventory.getStock('KETTLE-1'), { sku: 'KETTLE-1', onHand: 1, reserved: 0, available: 1, holds: [], waiting: 0 });
  const delivered = shop.orders.deliver(order.id);
  assert.equal(delivered.status, 'delivered');
  assert.deepEqual(
    shop.orders.orderEvents(order.id).map((event) => event.type),
    ['order.placed', 'order.paid', 'order.shipped', 'order.delivered'],
  );
});

test('a paid order keeps its hold past the hold time', () => {
  const { shop, clock } = seededShop();
  const order = placeOrder(shop, { 'KETTLE-1': 2 });
  clock.advanceMinutes(5);
  shop.orders.pay(order.id, { amountMinor: order.totalMinor, reference: 'psp-1' });
  clock.advanceMinutes(60);
  shop.inventory.expireHolds();
  assert.equal(shop.inventory.getStock('KETTLE-1').available, 1);
});

test('an unpaid order gives its stock back when the hold expires', () => {
  const { shop, clock } = seededShop();
  placeOrder(shop, { 'KETTLE-1': 3 });
  assert.equal(shop.inventory.getStock('KETTLE-1').available, 0);
  clock.advanceMinutes(16);
  assert.equal(shop.inventory.getStock('KETTLE-1').available, 3);
});

test('payment is checked against the total and the state', () => {
  const { shop } = seededShop();
  const order = placeOrder(shop, { 'TEA-GREEN': 1 });
  assert.throws(() => shop.orders.pay(order.id, { amountMinor: 1, reference: 'psp-1' }), ValidationError);
  shop.orders.pay(order.id, { amountMinor: order.totalMinor, reference: 'psp-1' });
  assert.throws(() => shop.orders.pay(order.id, { amountMinor: order.totalMinor, reference: 'psp-2' }), InvalidTransitionError);
});

test('cancelling releases the hold, also after it expired and was swept', () => {
  const { shop, clock } = seededShop();
  const first = placeOrder(shop, { 'KETTLE-1': 1 });
  shop.orders.cancel(first.id, { reason: 'test' });
  assert.equal(shop.inventory.getStock('KETTLE-1').available, 3);
  const second = placeOrder(shop, { 'KETTLE-1': 1 });
  clock.advanceMinutes(30);
  shop.inventory.expireHolds();
  assert.equal(shop.orders.cancel(second.id).status, 'cancelled');
});

test('cancelling a paid order records a full refund', () => {
  const { shop } = seededShop();
  const order = placeOrder(shop, { 'TEA-GREEN': 2 });
  shop.orders.pay(order.id, { amountMinor: order.totalMinor, reference: 'psp-1' });
  const cancelled = shop.orders.cancel(order.id, { reason: 'out of town' });
  assert.equal(cancelled.cancellation.refundMinor, order.totalMinor);
  assert.equal(shop.inventory.getStock('TEA-GREEN').available, 100);
});

test('orders can be listed by status and reported', () => {
  const { shop } = seededShop();
  const a = placeOrder(shop, { 'TEA-GREEN': 1 });
  placeOrder(shop, { 'BOOK-BREW': 1 });
  shop.orders.pay(a.id, { amountMinor: a.totalMinor, reference: 'psp-1' });
  assert.deepEqual(shop.orders.listOrders({ status: 'paid' }).map((o) => o.id), [a.id]);
  assert.equal(shop.orders.listOrders().length, 2);
  assert.throws(() => shop.orders.listOrders({ status: 'lost' }), ValidationError);
  const report = shop.orders.statusReport();
  assert.equal(report.paid.count, 1);
  assert.equal(report.placed.totalMinor, 2500 + 495);
});

test('a late payment for units sold to someone else is refused and stock stays whole', () => {
  const { shop, clock } = seededShop();
  const first = placeOrder(shop, { 'KETTLE-1': 3 });
  clock.advanceMinutes(20);
  const second = placeOrder(shop, { 'KETTLE-1': 3 });
  assert.throws(() => shop.orders.pay(first.id, { amountMinor: first.totalMinor, reference: 'late' }), InsufficientStockError);
  assert.equal(shop.orders.getOrder(first.id).status, 'placed');
  assert.equal(shop.orders.getOrder(first.id).payment, null);
  shop.orders.pay(second.id, { amountMinor: second.totalMinor, reference: 'psp-2' });
  shop.orders.ship(second.id, { carrier: 'DHL' });
  assert.deepEqual(shop.inventory.getStock('KETTLE-1'), { sku: 'KETTLE-1', onHand: 0, reserved: 0, available: 0, holds: [], waiting: 0 });
});

test('a late payment takes a firm hold again when the units are still there, swept or not', () => {
  const { shop, clock } = seededShop();
  const unswept = placeOrder(shop, { 'KETTLE-1': 1 });
  const swept = placeOrder(shop, { 'KETTLE-1': 1 });
  clock.advanceMinutes(20);
  shop.orders.pay(unswept.id, { amountMinor: unswept.totalMinor, reference: 'late-1' });
  shop.inventory.expireHolds();
  shop.orders.pay(swept.id, { amountMinor: swept.totalMinor, reference: 'late-2' });
  clock.advanceMinutes(60);
  assert.equal(shop.inventory.getStock('KETTLE-1').reserved, 2);
});

test('a late payment changes nothing when one of its lines cannot be held again', () => {
  const { shop, clock } = seededShop();
  const first = placeOrder(shop, { 'TEA-GREEN': 5, 'KETTLE-1': 2 });
  clock.advanceMinutes(20);
  shop.inventory.expireHolds();
  placeOrder(shop, { 'KETTLE-1': 2 });
  assert.throws(() => shop.orders.pay(first.id, { amountMinor: first.totalMinor, reference: 'late' }), InsufficientStockError);
  assert.equal(shop.inventory.getStock('TEA-GREEN').reserved, 0);
});

test('exportOrders lists only that customer\'s orders as CSV, oldest first', () => {
  const { shop, clock } = seededShop();
  const first = placeOrder(shop, { 'TEA-GREEN': 3, 'MUG-WHITE': 2 }, { customerId: 'cust-1' });
  clock.advance?.(1000);
  placeOrder(shop, { 'BOOK-BREW': 1 }, { customerId: 'cust-2' });
  const second = placeOrder(shop, { 'BOOK-BREW': 1 }, { customerId: 'cust-1' });
  shop.orders.cancel(second.id);
  const { filename, csv } = shop.orders.exportOrders('cust-1');
  assert.equal(filename, 'orders-cust-1.csv');
  assert.equal(csv, `order_id,status,total\n${first.id},placed,48.60\n${second.id},cancelled,29.95\n`);
});

test('exportOrders gives a customer without orders just the header line', () => {
  const { shop } = seededShop();
  assert.deepEqual(shop.orders.exportOrders('nobody'), { filename: 'orders-nobody.csv', csv: 'order_id,status,total\n' });
});
