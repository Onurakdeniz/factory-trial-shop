// Orders and their state machine.
//
//   placed ──pay──▶ paid ──ship──▶ shipped ──deliver──▶ delivered
//     │               │  ╲             ╲                   ╱
//     └────cancel─────┴───╲─▶ cancelled ╲── last refund ──▶ refunded
//
// A paid, shipped or delivered order can be refunded in parts (see refunds.js);
// when every unit is refunded it becomes `refunded`, a final status. An order keeps
// the prices it was placed with; later price changes never touch it.

import { InvalidTransitionError, ValidationError } from './errors.js';
import { assertMinor } from './money.js';
import { planRefund, remainingLines } from './refunds.js';

export const ORDER_STATUSES = ['placed', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded'];

const TRANSITIONS = {
  pay: { from: ['placed'], to: 'paid' },
  ship: { from: ['paid'], to: 'shipped' },
  deliver: { from: ['shipped'], to: 'delivered' },
  cancel: { from: ['placed', 'paid'], to: 'cancelled' },
};

export const ORDER_ACTIONS = Object.keys(TRANSITIONS);

export function canTransition(order, action) {
  const rule = TRANSITIONS[action];
  return Boolean(rule && rule.from.includes(order.status));
}

/** The actions that are allowed now, for clients that render buttons. */
export function allowedActions(order) {
  return ORDER_ACTIONS.filter((action) => canTransition(order, action));
}

function transition(order, action, at, changes = {}) {
  if (!canTransition(order, action)) throw new InvalidTransitionError(order.status, action);
  const to = TRANSITIONS[action].to;
  return {
    ...order,
    ...changes,
    status: to,
    updatedAt: at,
    history: [...order.history, { from: order.status, to, action, at }],
  };
}

/**
 * Creates an order from a priced cart. `holds` are the stock reservations taken at
 * checkout: `[{ sku, reservationId, quantity }]`.
 */
export function createOrder({ id, cart, quote, holds, at }) {
  if (quote.lines.length === 0) throw new ValidationError('an order needs at least one line');
  return {
    id,
    cartId: cart.id,
    customerId: cart.customerId,
    customerGroup: quote.customerGroup,
    region: quote.region,
    status: 'placed',
    lines: quote.lines.map((line) => ({
      sku: line.sku,
      name: line.name,
      quantity: line.quantity,
      unitMinor: line.unitMinor,
      netMinor: line.netMinor,
      taxRateBp: line.taxRateBp,
      taxMinor: line.taxMinor,
      grossMinor: line.grossMinor,
      discountMinor: line.discountMinor ?? 0,
      refundedQuantity: 0,
    })),
    subtotalMinor: quote.subtotalMinor,
    discountMinor: quote.discountMinor ?? 0,
    couponCode: quote.coupon?.applied && quote.couponMinor > 0 ? quote.coupon.code : null,
    taxMinor: quote.taxMinor,
    shippingMinor: quote.shippingMinor,
    totalMinor: quote.totalMinor,
    holds,
    payment: null,
    shipment: null,
    cancellation: null,
    refunds: [],
    refundedMinor: 0,
    createdAt: at,
    updatedAt: at,
    history: [{ from: null, to: 'placed', action: 'place', at }],
  };
}

/** Records a payment. The shop takes payment in full only. */
export function payOrder(order, { amountMinor, reference, at }) {
  assertMinor(amountMinor, 'amountMinor');
  if (typeof reference !== 'string' || reference.trim() === '') {
    throw new ValidationError('payment reference is required', { details: { field: 'reference' } });
  }
  if (!canTransition(order, 'pay')) throw new InvalidTransitionError(order.status, 'pay');
  if (amountMinor !== order.totalMinor) {
    throw new ValidationError(`payment of ${amountMinor} does not match the order total ${order.totalMinor}`, {
      code: 'payment_amount_mismatch',
      details: { expected: order.totalMinor, received: amountMinor },
    });
  }
  return transition(order, 'pay', at, { payment: { amountMinor, reference: reference.trim(), paidAt: at } });
}

export function shipOrder(order, { carrier, trackingCode, at }) {
  if (typeof carrier !== 'string' || carrier.trim() === '') {
    throw new ValidationError('carrier is required', { details: { field: 'carrier' } });
  }
  return transition(order, 'ship', at, {
    shipment: { carrier: carrier.trim(), trackingCode: trackingCode ?? null, shippedAt: at, deliveredAt: null },
  });
}

export function deliverOrder(order, { at }) {
  return transition(order, 'deliver', at, { shipment: { ...order.shipment, deliveredAt: at } });
}

function appendRefund(order, { id, plan, reason, restocked, at }) {
  const entry = { id, at, reason, lines: plan.lines, shippingMinor: plan.shippingMinor, amountMinor: plan.amountMinor, restocked };
  const lines = order.lines.map((line) => {
    const refunded = plan.lines.find((candidate) => candidate.sku === line.sku);
    return refunded ? { ...line, refundedQuantity: (line.refundedQuantity ?? 0) + refunded.quantity } : line;
  });
  return {
    ...order,
    lines,
    refunds: [...(order.refunds ?? []), entry],
    refundedMinor: (order.refundedMinor ?? 0) + plan.amountMinor,
    updatedAt: at,
  };
}

/**
 * Adds a refund (from planRefund) to the order's ledger. When every unit is
 * refunded, the order becomes `refunded`.
 */
export function recordRefund(order, { id, plan, reason, restocked = false, at }) {
  const next = appendRefund(order, { id, plan, reason, restocked, at });
  if (!next.lines.every((line) => line.refundedQuantity === line.quantity)) return next;
  return { ...next, status: 'refunded', history: [...order.history, { from: order.status, to: 'refunded', action: 'refund', at }] };
}

/**
 * Cancels an order. A paid order gets back what has not been refunded yet, as one
 * more ledger entry with reason "cancelled".
 */
export function cancelOrder(order, { reason = 'customer request', at, refundId = null }) {
  if (!canTransition(order, 'cancel')) throw new InvalidTransitionError(order.status, 'cancel');
  let current = order;
  let refundMinor = 0;
  if (order.status === 'paid') {
    // The rest of the payment: everything charged for the order, less what was refunded already.
    const restMinor = order.subtotalMinor + order.taxMinor + order.shippingMinor - (order.refundedMinor ?? 0);
    const plan = { ...planRefund(order, remainingLines(order)), amountMinor: restMinor };
    current = appendRefund(order, { id: refundId, plan, reason: 'cancelled', restocked: false, at });
    refundMinor = restMinor;
  }
  const payment = current.payment ? { ...current.payment, refundedMinor: current.refundedMinor } : null;
  return transition(current, 'cancel', at, { payment, cancellation: { reason, refundMinor, cancelledAt: at } });
}

/** A short view for order lists. */
export function summarizeOrder(order) {
  return {
    id: order.id,
    customerId: order.customerId,
    status: order.status,
    itemCount: order.lines.reduce((count, line) => count + line.quantity, 0),
    totalMinor: order.totalMinor,
    createdAt: order.createdAt,
  };
}
