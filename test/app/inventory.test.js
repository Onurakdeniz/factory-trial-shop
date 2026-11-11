import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictError, InsufficientStockError, NotFoundError } from '../../src/domain/errors.js';
import { seededShop } from './fixtures.js';

test('stock is listed per SKU', () => {
  const { shop } = seededShop();
  assert.deepEqual(
    shop.inventory.listStock().map((item) => [item.sku, item.onHand, item.available]),
    [
      ['BOOK-BREW', 10, 10],
      ['KETTLE-1', 3, 3],
      ['MUG-WHITE', 20, 20],
      ['TEA-GREEN', 100, 100],
    ],
  );
});

test('only catalog SKUs can be stocked', () => {
  const { shop } = seededShop();
  assert.throws(() => shop.inventory.receive('NOPE-1', 5), NotFoundError);
  assert.throws(() => shop.inventory.getStock('NOPE-1'), NotFoundError);
});

test('holds reduce availability until they expire', () => {
  const { shop, clock } = seededShop();
  shop.inventory.hold('KETTLE-1', 2, { orderId: 'ord_x', minutes: 15 });
  assert.equal(shop.inventory.getStock('KETTLE-1').available, 1);
  assert.throws(() => shop.inventory.hold('KETTLE-1', 2, { minutes: 15 }), InsufficientStockError);
  clock.advanceMinutes(15);
  assert.equal(shop.inventory.getStock('KETTLE-1').available, 3);
});

test('expireHolds sweeps expired holds and logs them', () => {
  const { shop, clock } = seededShop();
  shop.inventory.hold('KETTLE-1', 1, { orderId: 'ord_a', minutes: 15 });
  shop.inventory.hold('TEA-GREEN', 1, { orderId: 'ord_b', minutes: 60 });
  clock.advanceMinutes(20);
  assert.equal(shop.inventory.expireHolds(), 1);
  assert.equal(shop.inventory.expireHolds(), 0);
  assert.deepEqual(
    shop.events.list({ type: 'stock.hold_expired' }).map((event) => event.orderId),
    ['ord_a'],
  );
});

test('adjustments cannot take stock below the held units', () => {
  const { shop } = seededShop();
  shop.inventory.hold('KETTLE-1', 2, { minutes: 15 });
  assert.equal(shop.inventory.adjust('KETTLE-1', -1, 'broken').onHand, 2);
  assert.throws(() => shop.inventory.adjust('KETTLE-1', -1, 'broken'), ConflictError);
});
