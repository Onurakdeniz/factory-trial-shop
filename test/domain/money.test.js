import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  allocate,
  applyRate,
  assertMinor,
  formatMinor,
  multiplyMinor,
  parseMajor,
  ratio,
  sumMinor,
} from '../../src/domain/money.js';
import { ValidationError } from '../../src/domain/errors.js';

test('assertMinor accepts integers and rejects floats', () => {
  assert.equal(assertMinor(1250), 1250);
  assert.throws(() => assertMinor(12.5), ValidationError);
  assert.throws(() => assertMinor('12'), ValidationError);
});

test('sumMinor and multiplyMinor stay in integers', () => {
  assert.equal(sumMinor([100, 250, -50]), 300);
  assert.equal(multiplyMinor(450, 3), 1350);
  assert.throws(() => multiplyMinor(450, 1.5), ValidationError);
});

test('ratio rounds half away from zero', () => {
  assert.equal(ratio(1000, 1, 3), 333);
  assert.equal(ratio(1001, 1, 2), 501);
  assert.equal(ratio(-1001, 1, 2), -501);
  assert.equal(ratio(999, 2, 3), 666);
});

test('applyRate takes basis points', () => {
  assert.equal(applyRate(1000, 2000), 200);
  assert.equal(applyRate(1005, 1000), 101);
  assert.equal(applyRate(3999, 2000), 800);
  assert.equal(applyRate(1234, 0), 0);
});

test('allocate keeps the total and gives leftovers to the largest remainders', () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(allocate(10, [1, 3]), [3, 7]);
  assert.deepEqual(allocate(0, [5, 5]), [0, 0]);
  const parts = allocate(997, [1350, 2400, 3999]);
  assert.equal(parts.reduce((a, b) => a + b, 0), 997);
});

test('formatMinor prints major units with two decimals', () => {
  assert.equal(formatMinor(1250), '12.50 EUR');
  assert.equal(formatMinor(5), '0.05 EUR');
  assert.equal(formatMinor(-1999), '-19.99 EUR');
});

test('parseMajor reads decimal major units', () => {
  assert.equal(parseMajor('12'), 1200);
  assert.equal(parseMajor('12.5'), 1250);
  assert.equal(parseMajor(' 0.07 '), 7);
  assert.throws(() => parseMajor('12.345'), ValidationError);
  assert.throws(() => parseMajor('12,50'), ValidationError);
});
