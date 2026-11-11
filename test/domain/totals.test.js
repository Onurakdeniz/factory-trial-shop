import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPriceList } from '../../src/domain/price-lists.js';
import { formatQuote, priceCart, priceLine, shippingFor, taxBreakdown, taxRateFor } from '../../src/domain/totals.js';
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

test('tax rates by category', () => {
  assert.equal(taxRateFor('standard'), 2000);
  assert.equal(taxRateFor('reduced'), 1000);
  assert.equal(taxRateFor('zero'), 0);
  assert.throws(() => taxRateFor('luxury'), ValidationError);
});

test('priceLine rounds tax half up per line', () => {
  const odd = createProduct({ sku: 'ODD-1', name: 'Odd', basePriceMinor: 335, taxCategory: 'reduced' });
  const line = priceLine({ product: odd, quantity: 3, at: AT });
  assert.equal(line.netMinor, 1005);
  assert.equal(line.taxMinor, 101);
  assert.equal(line.grossMinor, 1106);
});

test('shipping depends on region and subtotal', () => {
  assert.equal(shippingFor('domestic', 4999, 1), 495);
  assert.equal(shippingFor('domestic', 5000, 1), 0);
  assert.equal(shippingFor('eu', 9999, 1), 995);
  assert.equal(shippingFor('world', 1_000_000, 1), 1995);
  assert.equal(shippingFor('world', 0, 0), 0);
  assert.throws(() => shippingFor('mars', 0, 1), ValidationError);
});

test('priceCart totals lines, tax and shipping', () => {
  const quote = priceCart({
    lines: [{ sku: 'TEA-GREEN', quantity: 3 }, { sku: 'MUG-WHITE', quantity: 2 }],
    products,
    priceLists: [volume],
    at: AT,
  });
  assert.equal(quote.subtotalMinor, 3750);
  assert.equal(quote.taxMinor, 615);
  assert.equal(quote.shippingMinor, 495);
  assert.equal(quote.totalMinor, 4860);
  assert.equal(quote.itemCount, 5);
});

test('priceCart rejects unknown, inactive and duplicate lines', () => {
  const inactive = { ...book, active: false };
  assert.throws(() => priceCart({ lines: [{ sku: 'NOPE-1', quantity: 1 }], products, at: AT }), ValidationError);
  assert.throws(() => priceCart({ lines: [{ sku: 'BOOK-BREW', quantity: 1 }], products: [inactive], at: AT }), ValidationError);
  assert.throws(
    () => priceCart({ lines: [{ sku: 'TEA-GREEN', quantity: 1 }, { sku: 'tea-green', quantity: 1 }], products, at: AT }),
    ValidationError,
  );
});

test('taxBreakdown groups by rate', () => {
  const quote = priceCart({
    lines: [{ sku: 'TEA-GREEN', quantity: 1 }, { sku: 'MUG-WHITE', quantity: 1 }, { sku: 'BOOK-BREW', quantity: 1 }],
    products,
    at: AT,
  });
  assert.deepEqual(taxBreakdown(quote.lines), [
    { taxRateBp: 2000, netMinor: 1200, taxMinor: 240 },
    { taxRateBp: 1000, netMinor: 450, taxMinor: 45 },
    { taxRateBp: 0, netMinor: 2500, taxMinor: 0 },
  ]);
});

test('formatQuote prints a total line', () => {
  const quote = priceCart({ lines: [{ sku: 'TEA-GREEN', quantity: 2 }], products, at: AT });
  assert.match(formatQuote(quote), /Total\s+14\.85 EUR/);
});
