import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const doc = (name) => readFileSync(new URL(`../../docs/${name}`, import.meta.url), 'utf8');

test('docs/api.md describes the waitlist endpoints and errors', () => {
  const api = doc('api.md');
  for (const text of [
    'POST /stock/:sku/waitlist',
    'GET /stock/:sku/waitlist',
    'DELETE /stock/:sku/waitlist/:customerId',
    'in_stock',
    'already_waiting',
    'not_waiting',
    'waiting',
  ]) {
    assert.ok(api.includes(text), `docs/api.md should mention ${text}`);
  }
});

test('docs/inventory.md describes the waitlist rules', () => {
  const inventory = doc('inventory.md');
  for (const text of ['Waitlist', 'waitlist.notified', 'Nothing else notifies']) {
    assert.ok(inventory.includes(text), `docs/inventory.md should mention ${text}`);
  }
});

test('docs/api.md describes the low-stock report', () => {
  const api = doc('api.md');
  for (const text of ['GET /reports/low-stock', 'threshold', 'left', 'validation_failed']) {
    assert.ok(api.includes(text), `docs/api.md should mention ${text}`);
  }
});
