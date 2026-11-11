import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  allowedActions,
  canTransition,
  cancelOrder,
  createOrder,
  deliverOrder,
  payOrder,
  shipOrder,
  summarizeOrder,
} from '../../src/domain/order.js';
import { InvalidTransitionError, ValidationError } from '../../src/domain/errors.js';

const quote = {
  customerGroup: 'retail',
  region: 'domestic',
  lines: [
    { sku: 'TEA-GREEN', name: 'Green tea', quantity: 3, unitMinor: 450, netMinor: 1350, taxRateBp: 1000, taxMinor: 135, grossMinor: 1485 },
  ],
  subtotalMinor: 1350,
  taxMinor: 135,
  shippingMinor: 495,
  totalMinor: 1980,
};
const placed = () =>
  createOrder({
    id: 'ord_1',
    cart: { id: 'cart_1', customerId: 'c1' },
    quote,
    holds: [{ sku: 'TEA-GREEN', reservationId: 'res_1', quantity: 3 }],
    at: 100,
  });

test('a new order is placed and keeps its prices', () => {
  const order = placed();
  assert.equal(order.status, 'placed');
  assert.equal(order.totalMinor, 1980);
  assert.equal(order.lines[0].grossMinor, 1485);
  assert.deepEqual(order.history, [{ from: null, to: 'placed', action: 'place', at: 100 }]);
});

test('payment must match the total', () => {
  assert.throws(() => payOrder(placed(), { amountMinor: 1979, reference: 'p1', at: 200 }), (error) => error.code === 'payment_amount_mismatch');
  assert.throws(() => payOrder(placed(), { amountMinor: 1980, reference: '', at: 200 }), ValidationError);
  const paid = payOrder(placed(), { amountMinor: 1980, reference: 'p1', at: 200 });
  assert.equal(paid.status, 'paid');
  assert.deepEqual(paid.payment, { amountMinor: 1980, reference: 'p1', paidAt: 200 });
});

test('the happy path goes placed, paid, shipped, delivered', () => {
  let order = payOrder(placed(), { amountMinor: 1980, reference: 'p1', at: 200 });
  order = shipOrder(order, { carrier: 'DHL', trackingCode: 'X1', at: 300 });
  order = deliverOrder(order, { at: 400 });
  assert.equal(order.status, 'delivered');
  assert.equal(order.shipment.deliveredAt, 400);
  assert.deepEqual(order.history.map((entry) => entry.to), ['placed', 'paid', 'shipped', 'delivered']);
});

test('invalid transitions are refused', () => {
  assert.throws(() => shipOrder(placed(), { carrier: 'DHL', at: 1 }), InvalidTransitionError);
  assert.throws(() => deliverOrder(placed(), { at: 1 }), InvalidTransitionError);
  const shipped = shipOrder(payOrder(placed(), { amountMinor: 1980, reference: 'p1', at: 2 }), { carrier: 'DHL', at: 3 });
  assert.throws(() => cancelOrder(shipped, { at: 4 }), InvalidTransitionError);
  assert.equal(canTransition(shipped, 'deliver'), true);
});

test('cancelling a paid order refunds it in full', () => {
  const cancelled = cancelOrder(payOrder(placed(), { amountMinor: 1980, reference: 'p1', at: 2 }), { reason: 'changed mind', at: 3 });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.payment.refundedMinor, 1980);
  assert.deepEqual(cancelled.cancellation, { reason: 'changed mind', refundMinor: 1980, cancelledAt: 3 });
});

test('cancelling a placed order refunds nothing', () => {
  const cancelled = cancelOrder(placed(), { at: 3 });
  assert.equal(cancelled.cancellation.refundMinor, 0);
  assert.equal(cancelled.payment, null);
});

test('allowedActions and summarizeOrder', () => {
  assert.deepEqual(allowedActions(placed()), ['pay', 'cancel']);
  assert.deepEqual(summarizeOrder(placed()), { id: 'ord_1', customerId: 'c1', status: 'placed', itemCount: 3, totalMinor: 1980, createdAt: 100 });
});
