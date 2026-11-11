import assert from 'node:assert/strict';
import { test } from 'node:test';
import { run } from '../../src/cli/main.js';
import { PRICE_LISTS, PRODUCTS, STOCK } from '../app/fixtures.js';

const CATALOG = JSON.stringify({ products: PRODUCTS, priceLists: PRICE_LISTS, stock: STOCK });

function fakeIo(files = { 'catalog.json': CATALOG }) {
  const out = [];
  const err = [];
  const written = {};
  return {
    io: {
      stdout: { write: (text) => out.push(text) },
      stderr: { write: (text) => err.push(text) },
      readFile: (path) => {
        if (!(path in files)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return files[path];
      },
      writeFile: (path, text) => {
        written[path] = text;
      },
    },
    stdout: () => out.join(''),
    stderr: () => err.join(''),
    written,
  };
}

test('catalog lists the products', async () => {
  const io = fakeIo();
  assert.equal(await run(['catalog', '--data', 'catalog.json'], io.io), 0);
  assert.match(io.stdout(), /TEA-GREEN\s+Green tea 100 g\s+4\.50 EUR\s+reduced/);
  assert.match(io.stdout(), /4 products/);
});

test('catalog --json prints the records', async () => {
  const io = fakeIo();
  await run(['catalog', '--data=catalog.json', '--json'], io.io);
  assert.equal(JSON.parse(io.stdout()).length, 4);
});

test('quote prices a basket', async () => {
  const io = fakeIo();
  const code = await run(['quote', '--data', 'catalog.json', '--item', 'TEA-GREEN=3', '--item', 'MUG-WHITE=2'], io.io);
  assert.equal(code, 0);
  assert.match(io.stdout(), /Subtotal\s+37\.50 EUR/);
  assert.match(io.stdout(), /Total\s+48\.60 EUR/);
});

test('quote --json uses the group and region', async () => {
  const io = fakeIo();
  await run(['quote', '--data', 'catalog.json', '--item', 'MUG-WHITE=10', '--group', 'wholesale', '--region', 'eu', '--json'], io.io);
  const quote = JSON.parse(io.stdout());
  assert.equal(quote.subtotalMinor, 8000);
  assert.equal(quote.shippingMinor, 995);
});

test('stock lists units on hand', async () => {
  const io = fakeIo();
  await run(['stock', '--data', 'catalog.json'], io.io);
  assert.match(io.stdout(), /KETTLE-1\s+3/);
});

test('usage errors exit with 2, shop errors with 1', async () => {
  const unknown = fakeIo();
  assert.equal(await run(['frobnicate'], unknown.io), 2);
  assert.match(unknown.stderr(), /Unknown command/);
  const noData = fakeIo();
  assert.equal(await run(['catalog'], noData.io), 2);
  const missingFile = fakeIo();
  assert.equal(await run(['catalog', '--data', 'nope.json'], missingFile.io), 2);
  assert.match(missingFile.stderr(), /ENOENT/);
  const badItem = fakeIo();
  assert.equal(await run(['quote', '--data', 'catalog.json', '--item', 'TEA-GREEN'], badItem.io), 2);
  const unknownSku = fakeIo();
  assert.equal(await run(['quote', '--data', 'catalog.json', '--item', 'NOPE-1=1'], unknownSku.io), 1);
  assert.match(unknownSku.stderr(), /Unknown product NOPE-1/);
});

test('help prints the usage', async () => {
  const io = fakeIo();
  assert.equal(await run([], io.io), 0);
  assert.match(io.stdout(), /Usage: shop <command>/);
});

test('import-products imports a CSV and writes the catalog', async () => {
  const io = fakeIo({ 'catalog.json': CATALOG, 'new.csv': 'sku,name,price\nPOT-1,Tea pot,29\nBAD-1,,1\n' });
  assert.equal(await run(['import-products', 'new.csv', '--data', 'catalog.json', '--out', 'out.json'], io.io), 1);
  assert.match(io.stdout(), /imported 1, rejected 1/);
  assert.match(io.stderr(), /line 3 \(BAD-1\): name/);
  const out = JSON.parse(io.written['out.json']);
  assert.equal(out.products.length, 5);
  assert.equal(out.stock['TEA-GREEN'], 100);
  const missing = fakeIo({ 'bad.csv': 'sku,name\nA-1,x\n' });
  assert.equal(await run(['import-products', 'bad.csv'], missing.io), 2);
});

test('a catalog file with two products for one SKU fails naming both entries', async () => {
  const products = [
    { sku: 'mug-white', name: 'Mug', basePriceMinor: 1200 },
    { sku: 'MUG-WHITE', name: 'Mug', basePriceMinor: 1290 },
  ];
  const io = fakeIo({ 'catalog.json': JSON.stringify({ products }) });
  assert.notEqual(await run(['catalog', '--data', 'catalog.json'], io.io), 0);
  assert.match(io.stderr(), /MUG-WHITE.*products\[0\].*mug-white.*products\[1\].*MUG-WHITE/);
});
