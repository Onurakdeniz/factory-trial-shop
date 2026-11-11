import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../../src/http/app.js';
import { startServer } from '../../src/http/server.js';
import { seededShop } from '../app/fixtures.js';

let running;
let base;

before(async () => {
  const { shop } = seededShop();
  running = await startServer({ app: createApp(shop), port: 0 });
  base = `http://127.0.0.1:${running.port}`;
});

after(() => running.close());

test('the server answers JSON', async () => {
  const response = await fetch(`${base}/products/TEA-GREEN`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal((await response.json()).basePriceMinor, 450);
});

test('the server parses JSON bodies and query strings', async () => {
  const created = await fetch(`${base}/carts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ customerId: 'web-1' }),
  });
  assert.equal(created.status, 201);
  const list = await fetch(`${base}/products?tag=books`);
  assert.deepEqual((await list.json()).products.map((p) => p.sku), ['BOOK-BREW']);
});

test('invalid JSON is a 400', async () => {
  const response = await fetch(`${base}/carts`, { method: 'POST', body: '{"customerId":' });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'invalid_json');
});

test('204 responses have no body', async () => {
  const response = await fetch(`${base}/price-lists/mug-volume`, { method: 'DELETE' });
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
});
