import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProduct, normalizeSku, updateProduct } from '../../src/domain/product.js';
import { ValidationError } from '../../src/domain/errors.js';

const valid = { sku: 'TEA-GREEN', name: ' Green tea ', basePriceMinor: 450, taxCategory: 'reduced' };

test('createProduct trims the name and fills defaults', () => {
  const product = createProduct(valid);
  assert.equal(product.sku, 'TEA-GREEN');
  assert.equal(product.name, 'Green tea');
  assert.equal(product.active, true);
  assert.deepEqual(product.tags, []);
  assert.equal(product.description, '');
});

test('createProduct defaults the tax category to standard', () => {
  const { taxCategory, ...rest } = valid;
  assert.equal(createProduct(rest).taxCategory, 'standard');
});

test('createProduct rejects bad input', () => {
  assert.throws(() => createProduct({ ...valid, sku: 'x' }), ValidationError);
  assert.throws(() => createProduct({ ...valid, sku: 'TEA GREEN' }), ValidationError);
  assert.throws(() => createProduct({ ...valid, name: '  ' }), ValidationError);
  assert.throws(() => createProduct({ ...valid, name: 'x'.repeat(121) }), ValidationError);
  assert.throws(() => createProduct({ ...valid, basePriceMinor: 4.5 }), ValidationError);
  assert.throws(() => createProduct({ ...valid, basePriceMinor: -1 }), ValidationError);
  assert.throws(() => createProduct({ ...valid, taxCategory: 'luxury' }), ValidationError);
});

test('tags are trimmed, lower-cased and de-duplicated', () => {
  assert.deepEqual(createProduct({ ...valid, tags: ['Tea', 'tea ', 'Organic'] }).tags, ['tea', 'organic']);
});

test('updateProduct keeps the SKU and validates the result', () => {
  const product = createProduct(valid);
  const updated = updateProduct(product, { basePriceMinor: 500, active: false });
  assert.equal(updated.sku, 'TEA-GREEN');
  assert.equal(updated.basePriceMinor, 500);
  assert.equal(updated.active, false);
  assert.throws(() => updateProduct(product, { sku: 'OTHER' }), ValidationError);
  assert.throws(() => updateProduct(product, { basePriceMinor: -5 }), ValidationError);
});

test('normalizeSku trims and upper-cases', () => {
  assert.equal(normalizeSku('  mug-white '), 'MUG-WHITE');
  assert.equal(normalizeSku(undefined), '');
});
