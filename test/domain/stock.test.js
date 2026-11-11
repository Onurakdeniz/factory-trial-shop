import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  adjust,
  availableQuantity,
  commitReservation,
  confirmReservation,
  createStockItem,
  expireReservations,
  lowStock,
  receive,
  release,
  reserve,
  reservedQuantity,
  stockView,
} from '../../src/domain/stock.js';
import { ConflictError, InsufficientStockError, NotFoundError, ValidationError } from '../../src/domain/errors.js';

const stocked = (units) => receive(createStockItem('TEA-GREEN'), units);

test('receive adds units on hand', () => {
  assert.equal(stocked(5).onHand, 5);
  assert.throws(() => receive(createStockItem('TEA-GREEN'), 0), ValidationError);
});

test('reserve holds units and refuses more than available', () => {
  const item = reserve(stocked(5), { reservationId: 'r1', quantity: 3, at: 0, expiresAt: 1000 });
  assert.equal(availableQuantity(item, 0), 2);
  assert.throws(() => reserve(item, { reservationId: 'r2', quantity: 3, at: 0 }), InsufficientStockError);
  assert.throws(() => reserve(item, { reservationId: 'r1', quantity: 1, at: 0 }), ConflictError);
});

test('an expired hold no longer counts as reserved', () => {
  const item = reserve(stocked(5), { reservationId: 'r1', quantity: 3, at: 0, expiresAt: 1000 });
  assert.equal(reservedQuantity(item, 999), 3);
  assert.equal(reservedQuantity(item, 1000), 0);
  assert.equal(availableQuantity(item, 1000), 5);
});

test('expireReservations removes only expired holds', () => {
  let item = reserve(stocked(5), { reservationId: 'r1', quantity: 1, at: 0, expiresAt: 1000 });
  item = reserve(item, { reservationId: 'r2', quantity: 1, at: 0, expiresAt: 5000 });
  item = reserve(item, { reservationId: 'r3', quantity: 1, at: 0, expiresAt: null });
  const { item: swept, expired } = expireReservations(item, 2000);
  assert.deepEqual(expired.map((r) => r.id), ['r1']);
  assert.deepEqual(swept.reservations.map((r) => r.id), ['r2', 'r3']);
});

test('release gives the units back', () => {
  const item = release(reserve(stocked(5), { reservationId: 'r1', quantity: 2, at: 0 }), 'r1');
  assert.equal(availableQuantity(item, 0), 5);
  assert.throws(() => release(item, 'r1'), NotFoundError);
});

test('confirm makes a live hold permanent', () => {
  const item = confirmReservation(reserve(stocked(5), { reservationId: 'r1', quantity: 2, at: 0, expiresAt: 1000 }), 'r1', 0);
  assert.equal(reservedQuantity(item, 10_000), 2);
});

test('commit takes the units off hand', () => {
  const item = commitReservation(reserve(stocked(5), { reservationId: 'r1', quantity: 2, at: 0 }), 'r1');
  assert.equal(item.onHand, 3);
  assert.equal(item.reservations.length, 0);
});

test('adjust cannot go below the reserved units', () => {
  const item = reserve(stocked(5), { reservationId: 'r1', quantity: 3, at: 0 });
  assert.equal(adjust(item, -2, 0).onHand, 3);
  assert.throws(() => adjust(item, -3, 0), ConflictError);
  assert.throws(() => adjust(item, 0, 0), ValidationError);
});

test('stockView shows live holds only', () => {
  let item = reserve(stocked(5), { reservationId: 'r1', quantity: 1, at: 0, expiresAt: 1000, orderId: 'o1' });
  item = reserve(item, { reservationId: 'r2', quantity: 2, at: 0, expiresAt: 5000, orderId: 'o2' });
  assert.deepEqual(stockView(item, 2000), {
    sku: 'TEA-GREEN',
    onHand: 5,
    reserved: 2,
    available: 3,
    holds: [{ id: 'r2', quantity: 2, orderId: 'o2', expiresAt: 5000 }],
  });
});

test('confirming an expired hold needs the units to be still available', () => {
  let item = reserve(stocked(3), { reservationId: 'r1', quantity: 3, at: 0, expiresAt: 1000 });
  assert.equal(reservedQuantity(confirmReservation(item, 'r1', 2000), 5000), 3);
  item = reserve(item, { reservationId: 'r2', quantity: 2, at: 2000, expiresAt: 3000 });
  assert.throws(() => confirmReservation(item, 'r1', 2000), InsufficientStockError);
});

test('commit never takes on-hand below zero', () => {
  const item = { sku: 'TEA-GREEN', onHand: 1, reservations: [{ id: 'r1', quantity: 2, orderId: null, createdAt: 0, expiresAt: null }] };
  assert.throws(() => commitReservation(item, 'r1'), InsufficientStockError);
});

test('lowStock keeps active products at or under the threshold, fewest first, then by SKU', () => {
  const products = [
    { sku: 'B', name: 'Bee', active: true },
    { sku: 'A', name: 'Ay', active: true },
    { sku: 'C', name: 'Sea', active: true },
    { sku: 'D', name: 'Dee', active: false },
    { sku: 'E', name: 'Eee', active: true },
    { sku: 'F', name: 'Eff', active: true },
  ];
  const items = [
    { sku: 'A', onHand: 5, reservations: [] },
    { sku: 'B', onHand: 5, reservations: [] },
    { sku: 'C', onHand: 9, reservations: [{ id: 'r1', quantity: 6, orderId: null, createdAt: 0, expiresAt: null }] },
    { sku: 'D', onHand: 0, reservations: [] },
    { sku: 'F', onHand: 6, reservations: [{ id: 'r2', quantity: 6, orderId: null, createdAt: 0, expiresAt: 100 }] },
  ];
  assert.deepEqual(lowStock(items, products, 5, 0), [
    { sku: 'E', name: 'Eee', left: 0 },
    { sku: 'F', name: 'Eff', left: 0 },
    { sku: 'C', name: 'Sea', left: 3 },
    { sku: 'A', name: 'Ay', left: 5 },
    { sku: 'B', name: 'Bee', left: 5 },
  ]);
  assert.deepEqual(lowStock(items, products, 0, 200).map((line) => line.sku), ['E']);
  assert.deepEqual(lowStock(items, products, 0, 0).map((line) => line.sku), ['E', 'F']);
});
