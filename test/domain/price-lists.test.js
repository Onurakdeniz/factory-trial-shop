import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createPriceList,
  isPriceListActive,
  nextTierHint,
  resolveUnitPrice,
} from '../../src/domain/price-lists.js';
import { createProduct } from '../../src/domain/product.js';
import { ValidationError } from '../../src/domain/errors.js';

const AT = Date.UTC(2026, 0, 5);
const tea = createProduct({ sku: 'TEA-GREEN', name: 'Green tea', basePriceMinor: 450, taxCategory: 'reduced' });
const mug = createProduct({ sku: 'MUG-WHITE', name: 'White mug', basePriceMinor: 1200 });
const book = createProduct({ sku: 'BOOK-BREW', name: 'Brewing book', basePriceMinor: 2500, taxCategory: 'zero' });
const products = [tea, mug, book];

const volume = createPriceList({
  id: 'mug-volume',
  name: 'Mug volume',
  entries: { 'MUG-WHITE': { unitMinor: 1200, tiers: [{ minQty: 10, unitMinor: 950 }, { minQty: 6, unitMinor: 1050 }] } },
});
const wholesale = createPriceList({
  id: 'wholesale',
  name: 'Wholesale',
  customerGroup: 'wholesale',
  priority: 10,
  entries: { 'MUG-WHITE': { unitMinor: 900 } },
});

test('createPriceList validates and sorts tiers', () => {
  assert.deepEqual(volume.entries['MUG-WHITE'].tiers.map((tier) => tier.minQty), [6, 10]);
  assert.throws(() => createPriceList({ id: 'Bad Id', name: 'x', entries: {} }), ValidationError);
  assert.throws(() => createPriceList({ id: 'a', name: 'x', entries: { 'MUG-WHITE': { unitMinor: 1.5 } } }), ValidationError);
  assert.throws(
    () => createPriceList({ id: 'a', name: 'x', entries: { 'MUG-WHITE': { unitMinor: 1, tiers: [{ minQty: 1, unitMinor: 1 }] } } }),
    ValidationError,
  );
  assert.throws(() => createPriceList({ id: 'a', name: 'x', validFrom: 10, validTo: 5, entries: {} }), ValidationError);
});

test('a price list is active inside its window and for its group', () => {
  const seasonal = createPriceList({ id: 's', name: 'S', validFrom: AT, validTo: AT + 1000, entries: {} });
  assert.equal(isPriceListActive(seasonal, AT - 1, 'retail'), false);
  assert.equal(isPriceListActive(seasonal, AT, 'retail'), true);
  assert.equal(isPriceListActive(seasonal, AT + 1000, 'retail'), false);
  assert.equal(isPriceListActive(wholesale, AT, 'retail'), false);
  assert.equal(isPriceListActive(wholesale, AT, 'wholesale'), true);
});

test('resolveUnitPrice falls back to the base price', () => {
  assert.deepEqual(resolveUnitPrice({ product: tea, quantity: 2, priceLists: [volume], at: AT }), {
    unitMinor: 450,
    source: { type: 'base' },
  });
});

test('resolveUnitPrice picks the largest tier that fits', () => {
  const at = (quantity) => resolveUnitPrice({ product: mug, quantity, priceLists: [volume], at: AT }).unitMinor;
  assert.equal(at(5), 1200);
  assert.equal(at(6), 1050);
  assert.equal(at(12), 950);
});

test('the higher priority list wins for its group', () => {
  const price = resolveUnitPrice({ product: mug, quantity: 12, priceLists: [volume, wholesale], at: AT, customerGroup: 'wholesale' });
  assert.deepEqual(price, { unitMinor: 900, source: { type: 'price_list', priceListId: 'wholesale', minQty: 1 } });
});

test('nextTierHint suggests the next cheaper tier', () => {
  assert.deepEqual(nextTierHint({ product: mug, quantity: 4, priceLists: [volume], at: AT }), { addQuantity: 2, unitMinor: 1050 });
  assert.equal(nextTierHint({ product: mug, quantity: 12, priceLists: [volume], at: AT }), null);
  assert.equal(nextTierHint({ product: tea, quantity: 1, priceLists: [volume], at: AT }), null);
});
