import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addLine, createCart, markCheckedOut, removeLine, setLineQuantity } from '../../src/domain/cart.js';
import { ConflictError, NotFoundError, ValidationError } from '../../src/domain/errors.js';

const empty = () => createCart({ id: 'cart_1', customerId: 'c1', at: 0 });

test('createCart validates the customer, group and region', () => {
  assert.equal(empty().customerGroup, 'retail');
  assert.equal(empty().region, 'domestic');
  assert.throws(() => createCart({ id: 'c', customerId: '', at: 0 }), ValidationError);
  assert.throws(() => createCart({ id: 'c', customerId: 'c1', region: 'moon', at: 0 }), ValidationError);
  assert.throws(() => createCart({ id: 'c', customerId: 'c1', customerGroup: 'vip', at: 0 }), ValidationError);
});

test('adding the same SKU twice merges the line', () => {
  let cart = addLine(empty(), 'tea-green', 2, 1);
  cart = addLine(cart, 'TEA-GREEN', 3, 2);
  assert.deepEqual(cart.lines, [{ sku: 'TEA-GREEN', quantity: 5 }]);
  assert.equal(cart.updatedAt, 2);
});

test('a line holds at most 99 units', () => {
  const cart = addLine(empty(), 'TEA-GREEN', 99, 1);
  assert.throws(() => addLine(cart, 'TEA-GREEN', 1, 2), ValidationError);
  assert.throws(() => addLine(empty(), 'TEA-GREEN', 0, 1), ValidationError);
});

test('setLineQuantity changes or removes a line', () => {
  const cart = addLine(empty(), 'TEA-GREEN', 2, 1);
  assert.deepEqual(setLineQuantity(cart, 'TEA-GREEN', 7, 2).lines, [{ sku: 'TEA-GREEN', quantity: 7 }]);
  assert.deepEqual(setLineQuantity(cart, 'TEA-GREEN', 0, 2).lines, []);
  assert.throws(() => setLineQuantity(cart, 'MUG-WHITE', 1, 2), NotFoundError);
});

test('removeLine removes only existing lines', () => {
  const cart = addLine(addLine(empty(), 'TEA-GREEN', 1, 1), 'MUG-WHITE', 1, 1);
  assert.deepEqual(removeLine(cart, 'tea-green', 2).lines, [{ sku: 'MUG-WHITE', quantity: 1 }]);
  assert.throws(() => removeLine(cart, 'KETTLE-1', 2), NotFoundError);
});

test('a checked-out cart cannot change', () => {
  const cart = markCheckedOut(addLine(empty(), 'TEA-GREEN', 1, 1), 'ord_1', 2);
  assert.equal(cart.status, 'checked_out');
  assert.throws(() => addLine(cart, 'TEA-GREEN', 1, 3), ConflictError);
  assert.throws(() => markCheckedOut(empty(), 'ord_2', 3), ConflictError);
});
