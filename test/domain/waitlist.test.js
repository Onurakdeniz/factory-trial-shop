import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isBackInStock, join, leave, waitlistView } from '../../src/domain/waitlist.js';

const input = (customerId, available = 0) => ({ customerId, available, sku: 'A-1' });

test('join appends and reports the position', () => {
  const first = join([], input('ann'), 10);
  assert.deepEqual(first, { list: [{ customerId: 'ann', since: 10 }], position: 1 });
  assert.equal(join(first.list, input('bob'), 20).position, 2);
});

test('join refuses bad ids, available stock and duplicates', () => {
  assert.throws(() => join([], input(''), 1), { code: 'validation_failed' });
  assert.throws(() => join([], input(42), 1), { code: 'validation_failed' });
  assert.throws(() => join([], input('ann', 1), 1), { code: 'in_stock' });
  const { list } = join([], input('ann'), 1);
  assert.throws(() => join(list, input('ann'), 2), { code: 'already_waiting' });
});

test('leave removes one customer or refuses', () => {
  const { list } = join(join([], input('ann'), 1).list, input('bob'), 2);
  assert.deepEqual(leave(list, 'ann', 'A-1'), [{ customerId: 'bob', since: 2 }]);
  assert.throws(() => leave(list, 'cy', 'A-1'), { code: 'not_waiting' });
});

test('back in stock means going from nothing available to something', () => {
  assert.equal(isBackInStock(0, 1), true);
  assert.equal(isBackInStock(-1, 2), true);
  assert.equal(isBackInStock(1, 5), false);
  assert.equal(isBackInStock(0, 0), false);
  assert.deepEqual(waitlistView('A-1', [{ customerId: 'ann', since: 1 }]), { sku: 'A-1', waiting: [{ customerId: 'ann', since: 1 }] });
});
