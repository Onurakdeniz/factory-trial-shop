import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createShop } from '../../src/app/shop.js';
import { ConflictError, NotFoundError, ValidationError } from '../../src/domain/errors.js';
import { PRODUCTS, seededShop } from './fixtures.js';

test('products are listed by SKU', () => {
  const { shop } = seededShop();
  assert.deepEqual(
    shop.catalog.listProducts().map((product) => product.sku),
    ['BOOK-BREW', 'KETTLE-1', 'MUG-WHITE', 'TEA-GREEN'],
  );
  assert.deepEqual(shop.catalog.listProducts({ tag: 'kitchen' }).map((p) => p.sku), ['KETTLE-1', 'MUG-WHITE']);
});

test('a SKU can be added only once', () => {
  const shop = createShop();
  shop.catalog.addProduct(PRODUCTS[0]);
  assert.throws(() => shop.catalog.addProduct({ ...PRODUCTS[0] }), ConflictError);
});

test('getProduct normalizes the SKU and throws for unknown ones', () => {
  const { shop } = seededShop();
  assert.equal(shop.catalog.getProduct(' tea-green').name, 'Green tea 100 g');
  assert.throws(() => shop.catalog.getProduct('NOPE-1'), NotFoundError);
});

test('updates are validated and deactivation hides products from active lists', () => {
  const { shop } = seededShop();
  assert.throws(() => shop.catalog.updateProduct('TEA-GREEN', { basePriceMinor: 1.5 }), ValidationError);
  shop.catalog.deactivateProduct('KETTLE-1');
  assert.equal(shop.catalog.getProduct('KETTLE-1').active, false);
  assert.equal(shop.catalog.listProducts({ activeOnly: true }).some((p) => p.sku === 'KETTLE-1'), false);
});

test('returned products are copies', () => {
  const { shop } = seededShop();
  const product = shop.catalog.getProduct('TEA-GREEN');
  product.basePriceMinor = 1;
  assert.equal(shop.catalog.getProduct('TEA-GREEN').basePriceMinor, 450);
});

test('price lists are kept in the order they were added', () => {
  const { shop } = seededShop();
  assert.deepEqual(shop.catalog.listPriceLists().map((list) => list.id), ['mug-volume', 'wholesale-2026']);
  assert.throws(() => shop.catalog.addPriceList({ id: 'mug-volume', name: 'again', entries: {} }), ConflictError);
  shop.catalog.removePriceList('mug-volume');
  assert.deepEqual(shop.catalog.listPriceLists().map((list) => list.id), ['wholesale-2026']);
});

test('catalog changes are logged', () => {
  const { shop } = seededShop();
  shop.catalog.updateProduct('TEA-GREEN', { basePriceMinor: 500 });
  const events = shop.events.list({ type: 'product.updated' });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].fields, ['basePriceMinor']);
});
