import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NotFoundError, ValidationError } from '../../src/domain/errors.js';
import { seededShop } from './fixtures.js';

test('a cart view prices its lines with the current catalog', () => {
  const { shop } = seededShop();
  const cart = shop.carts.createCart({ customerId: 'cust-1' });
  shop.carts.addItem(cart.id, { sku: 'TEA-GREEN', quantity: 3 });
  shop.carts.addItem(cart.id, { sku: 'mug-white', quantity: 2 });
  const view = shop.carts.view(cart.id);
  assert.equal(view.status, 'open');
  assert.deepEqual(
    view.lines.map((line) => [line.sku, line.unitMinor, line.netMinor, line.taxMinor]),
    [
      ['TEA-GREEN', 450, 1350, 135],
      ['MUG-WHITE', 1200, 2400, 480],
    ],
  );
  assert.equal(view.subtotalMinor, 3750);
  assert.equal(view.taxMinor, 615);
  assert.equal(view.shippingMinor, 495);
  assert.equal(view.totalMinor, 4860);
});

test('the view suggests the next volume tier', () => {
  const { shop } = seededShop();
  const cart = shop.carts.createCart({ customerId: 'cust-1' });
  shop.carts.addItem(cart.id, { sku: 'MUG-WHITE', quantity: 4 });
  assert.deepEqual(shop.carts.view(cart.id).lines[0].hint, { addQuantity: 2, unitMinor: 1050 });
});

test('wholesale carts get the wholesale price list', () => {
  const { shop } = seededShop();
  const cart = shop.carts.createCart({ customerId: 'b2b-1', customerGroup: 'wholesale', region: 'eu' });
  shop.carts.addItem(cart.id, { sku: 'MUG-WHITE', quantity: 10 });
  const view = shop.carts.view(cart.id);
  assert.equal(view.lines[0].unitMinor, 800);
  assert.equal(view.subtotalMinor, 8000);
  assert.equal(view.shippingMinor, 995);
});

test('price changes reach open carts', () => {
  const { shop } = seededShop();
  const cart = shop.carts.createCart({ customerId: 'cust-1' });
  shop.carts.addItem(cart.id, { sku: 'BOOK-BREW', quantity: 1 });
  shop.catalog.updateProduct('BOOK-BREW', { basePriceMinor: 2000 });
  assert.equal(shop.carts.view(cart.id).subtotalMinor, 2000);
});

test('unknown and inactive products cannot be added', () => {
  const { shop } = seededShop();
  const cart = shop.carts.createCart({ customerId: 'cust-1' });
  assert.throws(() => shop.carts.addItem(cart.id, { sku: 'NOPE-1', quantity: 1 }), ValidationError);
  shop.catalog.deactivateProduct('KETTLE-1');
  assert.throws(() => shop.carts.addItem(cart.id, { sku: 'KETTLE-1', quantity: 1 }), ValidationError);
});

test('lines can be changed and removed', () => {
  const { shop } = seededShop();
  const cart = shop.carts.createCart({ customerId: 'cust-1' });
  shop.carts.addItem(cart.id, { sku: 'TEA-GREEN', quantity: 1 });
  shop.carts.setQuantity(cart.id, 'TEA-GREEN', 4);
  assert.equal(shop.carts.getCart(cart.id).lines[0].quantity, 4);
  shop.carts.removeItem(cart.id, 'TEA-GREEN');
  assert.deepEqual(shop.carts.getCart(cart.id).lines, []);
  assert.throws(() => shop.carts.removeItem(cart.id, 'TEA-GREEN'), NotFoundError);
  assert.throws(() => shop.carts.getCart('cart_9999'), NotFoundError);
});
