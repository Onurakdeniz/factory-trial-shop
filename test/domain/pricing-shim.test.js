import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as shim from '../../src/domain/pricing.js';
import * as priceLists from '../../src/domain/price-lists.js';
import * as totals from '../../src/domain/totals.js';

test('the deprecated pricing.js re-exports both new modules unchanged', () => {
  for (const [name, value] of Object.entries(priceLists)) assert.equal(shim[name], value, name);
  for (const [name, value] of Object.entries(totals)) assert.equal(shim[name], value, name);
  assert.equal(Object.keys(shim).length, Object.keys(priceLists).length + Object.keys(totals).length);
});
