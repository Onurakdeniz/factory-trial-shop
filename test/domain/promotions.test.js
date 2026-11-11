import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPromotions, couponProblem, createCoupon, createOffer } from '../../src/domain/promotions.js';
import { ValidationError } from '../../src/domain/errors.js';

const line = (sku, quantity, unitMinor) => ({ sku, quantity, unitMinor, netMinor: quantity * unitMinor });

test('createCoupon validates and upper-cases the code', () => {
  assert.deepEqual(createCoupon({ code: 'save15', kind: 'percent', percent: 15 }), {
    code: 'SAVE15', kind: 'percent', percent: 15, amountMinor: null, minSubtotalMinor: 0, expiresAt: null,
  });
  assert.throws(() => createCoupon({ code: 'x', kind: 'percent', percent: 10 }), ValidationError);
  assert.throws(() => createCoupon({ code: 'ABC', kind: 'percent', percent: 101 }), ValidationError);
  assert.throws(() => createCoupon({ code: 'ABC', kind: 'fixed', amountMinor: 0 }), ValidationError);
  assert.throws(() => createCoupon({ code: 'ABC', kind: 'gift' }), ValidationError);
});

test('a percent coupon is rounded once on the total and allocated by largest remainder', () => {
  const coupon = createCoupon({ code: 'SAVE15', kind: 'percent', percent: 15 });
  const result = applyPromotions({ lines: [line('TEA-GREEN', 1, 450), line('KETTLE-1', 1, 3999)], coupon, at: 0 });
  assert.deepEqual(result.lineDiscounts, [67, 600]);
  assert.equal(result.discountMinor, 667);
});

test('offers apply first and a fixed coupon is capped by what is left', () => {
  const offer = createOffer({ id: 'tea', sku: 'TEA-GREEN', buy: 2, get: 1 });
  const coupon = createCoupon({ code: 'BIG', kind: 'fixed', amountMinor: 5000 });
  const result = applyPromotions({ lines: [line('TEA-GREEN', 7, 450)], offers: [offer], coupon, at: 0 });
  assert.deepEqual(result.lineDiscounts, [3150]);
});

test('couponProblem reports expiry before the minimum', () => {
  const coupon = createCoupon({ code: 'ABC', kind: 'fixed', amountMinor: 100, minSubtotalMinor: 1000, expiresAt: 50 });
  assert.equal(couponProblem(coupon, { subtotalMinor: 2000, at: 49 }), null);
  assert.equal(couponProblem(coupon, { subtotalMinor: 500, at: 49 }), 'min_subtotal');
  assert.equal(couponProblem(coupon, { subtotalMinor: 500, at: 50 }), 'expired');
});
