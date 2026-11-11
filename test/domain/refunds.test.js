import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planRefund, remainingLines } from '../../src/domain/refunds.js';
import { recordRefund } from '../../src/domain/order.js';
import { ConflictError, ValidationError } from '../../src/domain/errors.js';

const order = (status = 'paid') => ({
  id: 'ord_1',
  status,
  shippingMinor: 495,
  lines: [
    { sku: 'KETTLE-1', quantity: 3, unitMinor: 3999, netMinor: 11997, taxMinor: 2399, grossMinor: 14396, refundedQuantity: 0 },
    { sku: 'CUP-1', quantity: 2, unitMinor: 335, netMinor: 670, taxMinor: 67, grossMinor: 737, refundedQuantity: 0 },
  ],
  refunds: [],
  refundedMinor: 0,
  history: [],
});

test('a partial line refund is rounded half up', () => {
  assert.deepEqual(planRefund(order(), [{ sku: 'cup-1', quantity: 1 }]), {
    lines: [{ sku: 'CUP-1', quantity: 1, amountMinor: 369 }],
    shippingMinor: 0,
    amountMinor: 369,
  });
});

test('the last units of a line get the rest of its gross, and the last unit of the order the shipping', () => {
  let current = order();
  const amounts = [];
  for (const [sku, quantity] of [['KETTLE-1', 1], ['KETTLE-1', 1], ['KETTLE-1', 1], ['CUP-1', 2]]) {
    const plan = planRefund(current, [{ sku, quantity }]);
    amounts.push([plan.lines[0].amountMinor, plan.shippingMinor]);
    current = recordRefund(current, { id: `r${amounts.length}`, plan, reason: 'test', at: 1 });
  }
  assert.deepEqual(amounts, [[4799, 0], [4799, 0], [4798, 0], [737, 495]]);
  assert.equal(current.refundedMinor, 14396 + 737 + 495);
  assert.equal(current.status, 'refunded');
  assert.deepEqual(remainingLines(current), []);
});

test('refunds are refused for the wrong status, too many units and bad lines', () => {
  assert.throws(() => planRefund(order('placed'), [{ sku: 'CUP-1', quantity: 1 }]), (error) => error.code === 'not_refundable');
  assert.throws(() => planRefund(order(), [{ sku: 'CUP-1', quantity: 3 }]), (error) => error instanceof ConflictError && error.code === 'refund_exceeds_quantity');
  assert.throws(() => planRefund(order(), [{ sku: 'NOPE-1', quantity: 1 }]), ValidationError);
  assert.throws(() => planRefund(order(), [{ sku: 'CUP-1', quantity: 0 }]), ValidationError);
  assert.throws(() => planRefund(order(), [{ sku: 'CUP-1', quantity: 1 }, { sku: 'cup-1', quantity: 1 }]), ValidationError);
  assert.throws(() => planRefund(order(), []), ValidationError);
});

test('a discounted line refunds its share of the gross, which already has the discount', () => {
  const discounted = order();
  discounted.lines = [
    { sku: 'MUG-WHITE', quantity: 3, unitMinor: 1200, netMinor: 3240, discountMinor: 360, taxMinor: 648, grossMinor: 3888, refundedQuantity: 0 },
  ];
  assert.equal(planRefund(discounted, [{ sku: 'MUG-WHITE', quantity: 1 }]).lines[0].amountMinor, 1296);
});
