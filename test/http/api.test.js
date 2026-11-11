import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../../src/http/app.js';
import { seededShop } from '../app/fixtures.js';

function api() {
  const { shop, clock } = seededShop();
  const app = createApp(shop);
  const call = (method, path, body) => app.handle({ method, path, body });
  return { app, shop, clock, call };
}

test('health and unknown routes', async () => {
  const { call } = api();
  assert.deepEqual(await call('GET', '/health'), { status: 200, body: { status: 'ok' } });
  const missing = await call('GET', '/nope');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'route_not_found');
  const wrongMethod = await call('PUT', '/products');
  assert.equal(wrongMethod.status, 405);
});

test('products can be created, read, listed and changed', async () => {
  const { call } = api();
  const created = await call('POST', '/products', { sku: 'POT-1', name: 'Tea pot', basePriceMinor: 2900 });
  assert.equal(created.status, 201);
  assert.equal(created.body.sku, 'POT-1');
  assert.equal((await call('GET', '/products/pot-1')).body.name, 'Tea pot');
  const patched = await call('PATCH', '/products/POT-1', { basePriceMinor: 3100 });
  assert.equal(patched.body.basePriceMinor, 3100);
  const list = await call('GET', '/products?tag=kitchen');
  assert.deepEqual(list.body.products.map((p) => p.sku), ['KETTLE-1', 'MUG-WHITE']);
});

test('errors carry a status and a code', async () => {
  const { call } = api();
  const invalid = await call('POST', '/products', { sku: 'x', name: 'Bad', basePriceMinor: 1 });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'validation_failed');
  const duplicate = await call('POST', '/products', { sku: 'TEA-GREEN', name: 'Again', basePriceMinor: 1 });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, 'product_exists');
  const missing = await call('GET', '/products/NOPE-1');
  assert.equal(missing.status, 404);
  const noBody = await call('POST', '/products');
  assert.equal(noBody.status, 400);
  assert.equal(noBody.body.error.code, 'invalid_body');
});

test('a cart goes through checkout, payment, shipping and delivery', async () => {
  const { call } = api();
  const cart = await call('POST', '/carts', { customerId: 'cust-9' });
  assert.equal(cart.status, 201);
  const id = cart.body.id;
  await call('POST', `/carts/${id}/items`, { sku: 'TEA-GREEN', quantity: 3 });
  const view = await call('POST', `/carts/${id}/items`, { sku: 'MUG-WHITE', quantity: 2 });
  assert.equal(view.body.totalMinor, 4860);
  const order = await call('POST', `/carts/${id}/checkout`);
  assert.equal(order.status, 201);
  const orderId = order.body.id;
  const paid = await call('POST', `/orders/${orderId}/pay`, { amountMinor: 4860, reference: 'psp-7' });
  assert.equal(paid.body.status, 'paid');
  await call('POST', `/orders/${orderId}/ship`, { carrier: 'DHL', trackingCode: 'T1' });
  const delivered = await call('POST', `/orders/${orderId}/deliver`);
  assert.equal(delivered.body.status, 'delivered');
  assert.equal((await call('GET', '/stock/MUG-WHITE')).body.onHand, 18);
  assert.deepEqual((await call('GET', '/orders?status=delivered')).body.orders.map((o) => o.id), [orderId]);
});

test('invalid transitions are 409', async () => {
  const { call } = api();
  const cart = await call('POST', '/carts', { customerId: 'cust-9' });
  await call('POST', `/carts/${cart.body.id}/items`, { sku: 'BOOK-BREW' });
  const order = await call('POST', `/carts/${cart.body.id}/checkout`);
  const shipped = await call('POST', `/orders/${order.body.id}/ship`, { carrier: 'DHL' });
  assert.equal(shipped.status, 409);
  assert.equal(shipped.body.error.code, 'invalid_transition');
});

test('cart lines can be changed through the API', async () => {
  const { call } = api();
  const { body: cart } = await call('POST', '/carts', { customerId: 'c', region: 'world' });
  await call('POST', `/carts/${cart.id}/items`, { sku: 'TEA-GREEN', quantity: 1 });
  const changed = await call('PATCH', `/carts/${cart.id}/items/TEA-GREEN`, { quantity: 5 });
  assert.equal(changed.body.lines[0].quantity, 5);
  assert.equal(changed.body.shippingMinor, 1995);
  const removed = await call('DELETE', `/carts/${cart.id}/items/TEA-GREEN`);
  assert.deepEqual(removed.body.lines, []);
  assert.equal(removed.body.shippingMinor, 0);
});

test('stock endpoints receive, adjust and sweep', async () => {
  const { call, clock } = api();
  assert.equal((await call('POST', '/stock/KETTLE-1/receive', { quantity: 2 })).body.onHand, 5);
  assert.equal((await call('POST', '/stock/KETTLE-1/adjust', { delta: -1, reason: 'dropped' })).body.onHand, 4);
  const cart = await call('POST', '/carts', { customerId: 'c' });
  await call('POST', `/carts/${cart.body.id}/items`, { sku: 'KETTLE-1', quantity: 4 });
  await call('POST', `/carts/${cart.body.id}/checkout`);
  const short = await call('POST', '/stock/KETTLE-1/adjust', { delta: -1 });
  assert.equal(short.status, 409);
  clock.advanceMinutes(20);
  assert.deepEqual((await call('POST', '/stock/expire-holds')).body, { expired: 1 });
  assert.equal((await call('GET', '/stock')).body.stock.length, 4);
});

test('price lists can be added and removed', async () => {
  const { call } = api();
  const added = await call('POST', '/price-lists', { id: 'sale', name: 'Sale', priority: 50, entries: { 'TEA-GREEN': { unitMinor: 400 } } });
  assert.equal(added.status, 201);
  assert.equal((await call('GET', '/price-lists')).body.priceLists.length, 3);
  assert.equal((await call('DELETE', '/price-lists/sale')).status, 204);
  assert.equal((await call('DELETE', '/price-lists/sale')).status, 404);
});

test('promotions through the API', async () => {
  const { call } = api();
  assert.equal((await call('POST', '/promotions/coupons', { code: 'TAKE5', kind: 'fixed', amountMinor: 500 })).status, 201);
  assert.equal((await call('POST', '/promotions/offers', { id: 'mug-2for1', sku: 'MUG-WHITE', buy: 1, get: 1 })).status, 201);
  assert.equal((await call('GET', '/promotions')).body.offers.length, 1);
  const { body: cart } = await call('POST', '/carts', { customerId: 'c' });
  await call('POST', `/carts/${cart.id}/items`, { sku: 'MUG-WHITE', quantity: 2 });
  const applied = await call('POST', `/carts/${cart.id}/coupon`, { code: 'take5' });
  assert.deepEqual([applied.body.discountMinor, applied.body.coupon.code], [1700, 'TAKE5']);
  const removed = await call('DELETE', `/carts/${cart.id}/coupon`);
  assert.equal(removed.body.discountMinor, 1200);
  assert.equal((await call('POST', `/carts/${cart.id}/coupon`, { code: 'NOPE' })).body.error.code, 'coupon_not_found');
});

test('refunds through the API', async () => {
  const { call } = api();
  const { body: cart } = await call('POST', '/carts', { customerId: 'c' });
  await call('POST', `/carts/${cart.id}/items`, { sku: 'TEA-GREEN', quantity: 2 });
  const { body: order } = await call('POST', `/carts/${cart.id}/checkout`);
  await call('POST', `/orders/${order.id}/pay`, { amountMinor: order.totalMinor, reference: 'p' });
  const refunded = await call('POST', `/orders/${order.id}/refunds`, { lines: [{ sku: 'TEA-GREEN', quantity: 1 }], reason: 'returned' });
  assert.equal(refunded.status, 201);
  assert.equal(refunded.body.refundedMinor, 495);
  const tooMany = await call('POST', `/orders/${order.id}/refunds`, { lines: [{ sku: 'TEA-GREEN', quantity: 2 }], reason: 'x' });
  assert.equal(tooMany.status, 409);
  assert.equal(tooMany.body.error.code, 'refund_exceeds_quantity');
  const ledger = await call('GET', `/orders/${order.id}/refunds`);
  assert.equal(ledger.body.refunds.length, 1);
});

test('products can be imported from CSV', async () => {
  const { call } = api();
  const response = await call('POST', '/products/import', { csv: 'sku,name,price\nPOT-1,Tea pot,29\n' });
  assert.deepEqual([response.status, response.body.imported], [200, 1]);
  assert.equal((await call('POST', '/products/import', { csv: 'sku\nX-1\n' })).body.error.code, 'missing_column');
});

test('the waitlist can be joined, read and left over HTTP', async () => {
  const { shop, call } = api();
  assert.equal((await call('POST', '/stock/nope/waitlist', { customerId: 'ann' })).body.error.code, 'not_found');
  assert.equal((await call('POST', '/stock/kettle-1/waitlist', { customerId: 'ann' })).body.error.code, 'in_stock');
  shop.inventory.adjust('KETTLE-1', -3);
  assert.equal((await call('POST', '/stock/kettle-1/waitlist', {})).status, 400);
  assert.equal((await call('POST', '/stock/kettle-1/waitlist', { customerId: '' })).body.error.code, 'validation_failed');
  const joined = await call('POST', '/stock/kettle-1/waitlist', { customerId: 'ann' });
  assert.deepEqual(joined, { status: 201, body: { sku: 'KETTLE-1', customerId: 'ann', position: 1 } });
  assert.equal((await call('POST', '/stock/KETTLE-1/waitlist', { customerId: 'ann' })).body.error.code, 'already_waiting');
  await call('POST', '/stock/KETTLE-1/waitlist', { customerId: 'bob' });
  const listed = await call('GET', '/stock/KETTLE-1/waitlist');
  assert.deepEqual(listed.body.waiting.map((w) => w.customerId), ['ann', 'bob']);
  assert.equal((await call('GET', '/stock/KETTLE-1')).body.waiting, 2);
  assert.deepEqual(await call('DELETE', '/stock/KETTLE-1/waitlist/ann'), { status: 204, body: null });
  const gone = await call('DELETE', '/stock/KETTLE-1/waitlist/ann');
  assert.equal(gone.status, 404);
  assert.equal(gone.body.error.code, 'not_waiting');
  await call('POST', '/stock/KETTLE-1/receive', { quantity: 1 });
  assert.deepEqual(shop.events.list({ type: 'waitlist.notified' }).map((e) => e.customerId), ['bob']);
  assert.deepEqual((await call('GET', '/stock/KETTLE-1/waitlist')).body.waiting, []);
});

test('GET /customers/:customerId/orders/export answers filename and csv', async () => {
  const { shop, call } = api();
  const { placeOrder } = await import('../app/fixtures.js');
  const order = placeOrder(shop, { 'TEA-GREEN': 1 }, { customerId: 'c9' });
  const res = await call('GET', '/customers/c9/orders/export');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { filename: 'orders-c9.csv', csv: `order_id,status,total\n${order.id},placed,9.90\n` });
  assert.equal((await call('GET', '/customers/none/orders/export')).body.csv, 'order_id,status,total\n');
});
