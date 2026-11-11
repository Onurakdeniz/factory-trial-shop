import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictError, NotFoundError } from '../../src/domain/errors.js';
import { seededShop } from './fixtures.js';

test('a coupon on a cart lowers the order total and is copied to the order', () => {
  const { shop } = seededShop();
  shop.promotions.addCoupon({ code: 'SAVE10', kind: 'percent', percent: 10 });
  const cart = shop.carts.createCart({ customerId: 'c1' });
  shop.carts.addItem(cart.id, { sku: 'BOOK-BREW', quantity: 1 });
  const view = shop.carts.applyCoupon(cart.id, 'save10');
  assert.deepEqual([view.discountMinor, view.totalMinor], [250, 2250 + 495]);
  const order = shop.orders.checkout(cart.id);
  assert.deepEqual([order.couponCode, order.discountMinor, order.totalMinor], ['SAVE10', 250, 2745]);
});

test('coupons are checked when applied', () => {
  const { shop, clock } = seededShop();
  shop.promotions.addCoupon({ code: 'BIG', kind: 'fixed', amountMinor: 500, minSubtotalMinor: 10000 });
  shop.promotions.addCoupon({ code: 'SOON', kind: 'fixed', amountMinor: 500, expiresAt: clock.now() + 1 });
  const cart = shop.carts.createCart({ customerId: 'c1' });
  shop.carts.addItem(cart.id, { sku: 'TEA-GREEN', quantity: 1 });
  assert.throws(() => shop.carts.applyCoupon(cart.id, 'NOPE'), NotFoundError);
  assert.throws(() => shop.carts.applyCoupon(cart.id, 'BIG'), (error) => error instanceof ConflictError && error.code === 'coupon_min_subtotal');
  clock.advance(1);
  assert.throws(() => shop.carts.applyCoupon(cart.id, 'SOON'), (error) => error.code === 'coupon_expired');
  assert.throws(() => shop.promotions.addCoupon({ code: 'big', kind: 'percent', percent: 5 }), ConflictError);
});

test('offers make units free and one offer per SKU is allowed', () => {
  const { shop } = seededShop();
  shop.promotions.addOffer({ id: 'tea-3for2', sku: 'TEA-GREEN', buy: 2, get: 1 });
  assert.throws(() => shop.promotions.addOffer({ id: 'tea-again', sku: 'TEA-GREEN', buy: 1, get: 1 }), ConflictError);
  const cart = shop.carts.createCart({ customerId: 'c1' });
  shop.carts.addItem(cart.id, { sku: 'TEA-GREEN', quantity: 3 });
  const view = shop.carts.view(cart.id);
  assert.deepEqual([view.lines[0].discountMinor, view.lines[0].taxMinor], [450, 90]);
  assert.equal(shop.carts.removeCoupon(cart.id).coupon, null);
});
