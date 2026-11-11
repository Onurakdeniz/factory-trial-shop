import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictError, InsufficientStockError, NotFoundError } from '../../src/domain/errors.js';
import { seededShop, STOCK } from './fixtures.js';

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

test('a customer joins the waitlist of a sold-out product and gets a position', () => {
  const { shop, clock } = seededShop();
  shop.inventory.hold('KETTLE-1', 3, { minutes: 60 });
  clock.advanceMinutes(1);
  assert.deepEqual(shop.inventory.joinWaitlist('kettle-1', 'ann'), { sku: 'KETTLE-1', customerId: 'ann', position: 1 });
  assert.equal(shop.inventory.joinWaitlist('KETTLE-1', 'bob').position, 2);
  assert.equal(shop.inventory.getStock('KETTLE-1').waiting, 2);
  const { waiting } = shop.inventory.listWaiting('KETTLE-1');
  assert.deepEqual(waiting.map((entry) => entry.customerId), ['ann', 'bob']);
  assert.equal(waiting[0].since, clock.now());
});

test('joining is refused for unknown SKUs, bad ids, products in stock and repeat joins', () => {
  const { shop } = seededShop();
  assert.throws(() => shop.inventory.joinWaitlist('NOPE-1', 'ann'), NotFoundError);
  assert.throws(() => shop.inventory.joinWaitlist('KETTLE-1', 'ann'), { code: 'in_stock' });
  shop.inventory.hold('KETTLE-1', 3, { minutes: 60 });
  assert.throws(() => shop.inventory.joinWaitlist('KETTLE-1', ''), { code: 'validation_failed' });
  assert.throws(() => shop.inventory.joinWaitlist('KETTLE-1', undefined), { code: 'validation_failed' });
  shop.inventory.joinWaitlist('KETTLE-1', 'ann');
  assert.throws(() => shop.inventory.joinWaitlist('KETTLE-1', 'ann'), { code: 'already_waiting' });
});

test('a customer can leave the waitlist', () => {
  const { shop } = seededShop();
  shop.inventory.hold('KETTLE-1', 3, { minutes: 60 });
  shop.inventory.joinWaitlist('KETTLE-1', 'ann');
  shop.inventory.leaveWaitlist('KETTLE-1', 'ann');
  assert.deepEqual(shop.inventory.listWaiting('KETTLE-1').waiting, []);
  assert.throws(() => shop.inventory.leaveWaitlist('KETTLE-1', 'ann'), { code: 'not_waiting' });
});

test('receiving goods or a positive adjustment notifies the waitlist in order and empties it', () => {
  const { shop } = seededShop();
  for (const sku of ['KETTLE-1', 'MUG-WHITE']) {
    shop.inventory.adjust(sku, -STOCK[sku], 'sold');
    shop.inventory.joinWaitlist(sku, 'ann');
    shop.inventory.joinWaitlist(sku, 'bob');
  }
  shop.inventory.receive('KETTLE-1', 5);
  shop.inventory.adjust('MUG-WHITE', 2, 'found');
  const notified = shop.events.list({ type: 'waitlist.notified' });
  assert.deepEqual(
    notified.map(({ sku, customerId }) => [sku, customerId]),
    [['KETTLE-1', 'ann'], ['KETTLE-1', 'bob'], ['MUG-WHITE', 'ann'], ['MUG-WHITE', 'bob']],
  );
  assert.deepEqual(shop.inventory.listWaiting('KETTLE-1').waiting, []);
  assert.equal(shop.inventory.getStock('MUG-WHITE').waiting, 0);
});

test('releases, expiries, extra receipts and negative adjustments notify nobody', () => {
  const { shop, clock } = seededShop();
  shop.inventory.hold('KETTLE-1', 3, { minutes: 15 });
  const kept = shop.inventory.hold('MUG-WHITE', 20, {});
  shop.inventory.joinWaitlist('KETTLE-1', 'ann');
  shop.inventory.joinWaitlist('MUG-WHITE', 'bob');
  shop.inventory.release('MUG-WHITE', kept);
  clock.advanceMinutes(20);
  shop.inventory.expireHolds();
  assert.equal(shop.inventory.getStock('KETTLE-1').available, 3);
  assert.deepEqual(shop.events.list({ type: 'waitlist.notified' }), []);
  assert.equal(shop.inventory.getStock('KETTLE-1').waiting, 1);

  shop.inventory.receive('TEA-GREEN', 1);
  shop.inventory.adjust('TEA-GREEN', -1);
  assert.deepEqual(shop.events.list({ type: 'waitlist.notified' }), []);
});
