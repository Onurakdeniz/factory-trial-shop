// Refund arithmetic. Refunds are paid back gross (net plus the tax charged). A
// partial line refund is the line's gross times the quantity over the line's
// quantity, rounded half up; the refund that returns the last units of a line gets
// what is left of its gross, so a fully refunded line returns exactly its gross.
// Shipping goes back only with the last unrefunded unit of the whole order.

import { ConflictError, ValidationError } from './errors.js';
import { ratio } from './money.js';
import { normalizeSku } from './product.js';

export const REFUNDABLE_STATUSES = ['paid', 'shipped', 'delivered'];

export function assertRefundable(order) {
  if (!REFUNDABLE_STATUSES.includes(order.status)) {
    throw new ConflictError(`Cannot refund an order that is ${order.status}`, {
      code: 'not_refundable',
      details: { status: order.status },
    });
  }
  return order;
}

export function remainingQuantity(line) {
  return line.quantity - (line.refundedQuantity ?? 0);
}

/** Every unit that has not been refunded yet, as refund lines. */
export function remainingLines(order) {
  return order.lines
    .filter((line) => remainingQuantity(line) > 0)
    .map((line) => ({ sku: line.sku, quantity: remainingQuantity(line) }));
}

function refundedAmountFor(order, sku) {
  return (order.refunds ?? [])
    .flatMap((refund) => refund.lines)
    .filter((line) => line.sku === sku)
    .reduce((sum, line) => sum + line.amountMinor, 0);
}

/**
 * Works out a refund of `requested` (`[{ sku, quantity }]`) on `order` without
 * changing it. Returns `{ lines: [{ sku, quantity, amountMinor }], shippingMinor, amountMinor }`.
 */
export function planRefund(order, requested) {
  assertRefundable(order);
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new ValidationError('lines must be a non-empty list', { details: { field: 'lines' } });
  }
  const refundedAfter = new Map(order.lines.map((line) => [line.sku, line.refundedQuantity ?? 0]));
  const seen = new Set();
  const lines = requested.map((entry) => {
    const sku = normalizeSku(entry?.sku);
    const line = order.lines.find((candidate) => candidate.sku === sku);
    if (!line) throw new ValidationError(`${sku || 'The SKU'} is not on order ${order.id}`, { details: { field: 'sku', sku } });
    if (seen.has(sku)) throw new ValidationError(`${sku} appears twice in the refund`, { details: { field: 'sku', sku } });
    seen.add(sku);
    const { quantity } = entry;
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      throw new ValidationError('quantity must be a positive integer', { details: { field: 'quantity', sku } });
    }
    const remaining = remainingQuantity(line);
    if (quantity > remaining) {
      throw new ConflictError(`Only ${remaining} of ${sku} can still be refunded`, {
        code: 'refund_exceeds_quantity',
        details: { sku, requested: quantity, remaining },
      });
    }
    refundedAfter.set(sku, refundedAfter.get(sku) + quantity);
    // Their share of what was paid for the line (discount and tax included); the last units get what is left.
    const amountMinor =
      quantity === remaining
        ? line.grossMinor - refundedAmountFor(order, sku)
        : ratio(line.grossMinor, quantity, line.quantity);
    return { sku, quantity, amountMinor };
  });
  const everything = order.lines.every((line) => refundedAfter.get(line.sku) === line.quantity);
  const shippingMinor = everything ? order.shippingMinor : 0;
  return { lines, shippingMinor, amountMinor: lines.reduce((sum, line) => sum + line.amountMinor, 0) + shippingMinor };
}
