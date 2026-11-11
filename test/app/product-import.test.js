import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importProducts } from '../../src/app/product-import.js';
import { createShop } from '../../src/app/shop.js';
import { seededShop } from './fixtures.js';

test('valid rows are imported and bad rows reported', () => {
  const shop = createShop();
  const report = importProducts(shop, 'SKU,Title,Unit Price,Tax,Colour\npot-1,Pot,29,reduced,red\npot-2,,abc,gold,blue\n');
  assert.deepEqual([report.imported, report.rejected, report.ignoredColumns], [1, 1, ['Colour']]);
  assert.deepEqual(report.errors.map((error) => [error.line, error.sku, error.field]), [
    [3, 'POT-2', 'name'],
    [3, 'POT-2', 'price'],
    [3, 'POT-2', 'tax_category'],
  ]);
  assert.equal(shop.catalog.getProduct('POT-1').taxCategory, 'reduced');
});

test('a missing required column imports nothing', () => {
  const shop = createShop();
  assert.throws(() => importProducts(shop, 'sku,name\nA-1,x\n'), (error) => error.code === 'missing_column');
  assert.equal(shop.catalog.listProducts().length, 0);
});

test('existing SKUs are updated with the columns the file has', () => {
  const { shop } = seededShop();
  const report = importProducts(shop, 'sku,name,price\nTEA-GREEN,Green tea 100 g,4.80\n');
  assert.equal(report.imported, 1);
  const tea = shop.catalog.getProduct('TEA-GREEN');
  assert.deepEqual([tea.basePriceMinor, tea.taxCategory, tea.tags], [480, 'reduced', ['tea']]);
});

test('importing a SKU added in another case updates that product instead of adding one', () => {
  const shop = createShop();
  shop.catalog.addProduct({ sku: 'mug-white', name: 'White mug', basePriceMinor: 1200 });
  const report = importProducts(shop, 'sku,name,price\nMUG-WHITE,White mug,12.90\n');
  assert.equal(report.imported, 1);
  const products = shop.catalog.listProducts();
  assert.deepEqual(products.map((p) => [p.sku, p.basePriceMinor]), [['MUG-WHITE', 1290]]);
});
