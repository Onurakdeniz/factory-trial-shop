// A cart is a list of `{ sku, quantity }` lines owned by one customer. Prices are
// not stored on the cart; they are computed when the cart is quoted.

import { ConflictError, NotFoundError, ValidationError } from './errors.js';
import { assertSku, normalizeSku } from './product.js';
import { assertCustomerGroup } from './price-lists.js';
import { assertRegion } from './totals.js';

export const MAX_LINE_QUANTITY = 99;
export const MAX_LINES = 50;

function assertLineQuantity(quantity) {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new ValidationError('quantity must be a positive integer', { details: { field: 'quantity' } });
  }
  if (quantity > MAX_LINE_QUANTITY) {
    throw new ValidationError(`quantity must be at most ${MAX_LINE_QUANTITY}`, { details: { field: 'quantity' } });
  }
  return quantity;
}

export function createCart({ id, customerId, customerGroup = 'retail', region = 'domestic', at }) {
  if (typeof customerId !== 'string' || customerId.trim() === '') {
    throw new ValidationError('customerId is required', { details: { field: 'customerId' } });
  }
  return {
    id,
    customerId: customerId.trim(),
    customerGroup: assertCustomerGroup(customerGroup),
    region: assertRegion(region),
    status: 'open',
    lines: [],
    couponCode: null,
    createdAt: at,
    updatedAt: at,
  };
}

export function assertOpen(cart) {
  if (cart.status !== 'open') {
    throw new ConflictError(`Cart ${cart.id} is ${cart.status}`, { code: 'cart_closed' });
  }
  return cart;
}

/** Adds units of a SKU; an existing line for the same SKU is increased. */
export function addLine(cart, rawSku, quantity, at) {
  assertOpen(cart);
  const sku = assertSku(normalizeSku(rawSku));
  assertLineQuantity(quantity);
  const existing = cart.lines.find((line) => line.sku === sku);
  if (existing) {
    const lines = cart.lines.map((line) =>
      line.sku === sku ? { sku, quantity: assertLineQuantity(line.quantity + quantity) } : line,
    );
    return { ...cart, lines, updatedAt: at };
  }
  if (cart.lines.length >= MAX_LINES) {
    throw new ValidationError(`a cart holds at most ${MAX_LINES} lines`);
  }
  return { ...cart, lines: [...cart.lines, { sku, quantity }], updatedAt: at };
}

/** Sets the quantity of a line; 0 removes it. */
export function setLineQuantity(cart, rawSku, quantity, at) {
  assertOpen(cart);
  const sku = normalizeSku(rawSku);
  if (!cart.lines.some((line) => line.sku === sku)) throw new NotFoundError('Cart line', sku);
  if (quantity === 0) return removeLine(cart, sku, at);
  assertLineQuantity(quantity);
  return { ...cart, lines: cart.lines.map((line) => (line.sku === sku ? { sku, quantity } : line)), updatedAt: at };
}

export function removeLine(cart, rawSku, at) {
  assertOpen(cart);
  const sku = normalizeSku(rawSku);
  if (!cart.lines.some((line) => line.sku === sku)) throw new NotFoundError('Cart line', sku);
  return { ...cart, lines: cart.lines.filter((line) => line.sku !== sku), updatedAt: at };
}

export function markCheckedOut(cart, orderId, at) {
  assertOpen(cart);
  if (cart.lines.length === 0) throw new ConflictError('Cannot check out an empty cart', { code: 'cart_empty' });
  return { ...cart, status: 'checked_out', orderId, updatedAt: at };
}

/** Puts a coupon code on the cart (replacing any other), or removes it with null. */
export function setCoupon(cart, code, at) {
  assertOpen(cart);
  return { ...cart, couponCode: code, updatedAt: at };
}
