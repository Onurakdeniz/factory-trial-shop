// Orders: checkout turns a cart into an order and holds its stock; payment,
// shipping, delivery and cancellation move the order through its states and keep
// the stock holds in step.

import { ConflictError, NotFoundError, ValidationError } from '../domain/errors.js';
import { assertOpen, markCheckedOut } from '../domain/cart.js';
import {
  ORDER_STATUSES,
  allowedActions,
  cancelOrder,
  createOrder,
  deliverOrder,
  payOrder,
  recordRefund,
  shipOrder,
  summarizeOrder,
} from '../domain/order.js';
import { planRefund } from '../domain/refunds.js';

export const DEFAULT_HOLD_MINUTES = 15;

export function createOrderService({ repos, clock, ids, carts, inventory, holdMinutes = DEFAULT_HOLD_MINUTES }) {
  function view(order) {
    return { ...order, allowedActions: allowedActions(order) };
  }

  function save(order, eventType, data = {}) {
    repos.orders.save(order);
    repos.events.append(eventType, { orderId: order.id, ...data }, clock.now());
    return view(order);
  }

  /** Holds stock for every line; if one line cannot be held, the holds taken so far are released. */
  function holdLines(orderId, lines) {
    const holds = [];
    try {
      for (const line of lines) {
        const reservationId = inventory.hold(line.sku, line.quantity, { orderId, minutes: holdMinutes });
        holds.push({ sku: line.sku, reservationId, quantity: line.quantity });
      }
    } catch (error) {
      for (const hold of holds) inventory.release(hold.sku, hold.reservationId);
      throw error;
    }
    return holds;
  }

  function checkout(cartId) {
    const cart = assertOpen(repos.carts.require(cartId));
    if (cart.lines.length === 0) throw new ConflictError('Cannot check out an empty cart', { code: 'cart_empty' });
    const quote = carts.quote(cartId);
    const orderId = ids.next('ord');
    const holds = holdLines(orderId, quote.lines);
    const at = clock.now();
    const order = createOrder({ id: orderId, cart, quote, holds, at });
    repos.carts.save(markCheckedOut(cart, orderId, at));
    return save(order, 'order.placed', { totalMinor: order.totalMinor });
  }

  function pay(orderId, { amountMinor, reference } = {}) {
    const order = repos.orders.require(orderId);
    const paid = payOrder(order, { amountMinor, reference, at: clock.now() });
    // Throws insufficient_stock (and changes nothing) when a lapsed hold's units are gone.
    const holds = inventory.confirmAll(order.holds, { orderId });
    return save({ ...paid, holds }, 'order.paid', { amountMinor });
  }

  function ship(orderId, { carrier, trackingCode } = {}) {
    const order = repos.orders.require(orderId);
    const shipped = shipOrder(order, { carrier, trackingCode, at: clock.now() });
    for (const hold of order.holds) inventory.commit(hold.sku, hold.reservationId);
    return save(shipped, 'order.shipped', { carrier: shipped.shipment.carrier });
  }

  function deliver(orderId) {
    const order = repos.orders.require(orderId);
    return save(deliverOrder(order, { at: clock.now() }), 'order.delivered');
  }

  function cancel(orderId, { reason } = {}) {
    const order = repos.orders.require(orderId);
    const refundId = order.status === 'paid' ? ids.next('ref') : null;
    const cancelled = cancelOrder(order, { reason, at: clock.now(), refundId });
    for (const hold of order.holds) {
      try {
        inventory.release(hold.sku, hold.reservationId);
      } catch (error) {
        // The hold may already have expired and been swept; nothing to give back then.
        if (!(error instanceof NotFoundError)) throw error;
      }
    }
    return save(cancelled, 'order.cancelled', { reason: cancelled.cancellation.reason });
  }

  /**
   * Refunds some units of a paid, shipped or delivered order. Before shipping the
   * units come off the order's hold; after shipping they go back on hand only with
   * `restock`.
   */
  function refund(orderId, { lines, restock = true, reason } = {}) {
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new ValidationError('reason is required', { details: { field: 'reason' } });
    }
    if (typeof restock !== 'boolean') throw new ValidationError('restock must be true or false', { details: { field: 'restock' } });
    const order = repos.orders.require(orderId);
    const plan = planRefund(order, lines);
    const beforeShipping = order.status === 'paid';
    let holds = order.holds;
    if (beforeShipping) {
      holds = order.holds
        .map((hold) => {
          const refunded = plan.lines.find((line) => line.sku === hold.sku);
          if (!refunded) return hold;
          inventory.reduceHold(hold.sku, hold.reservationId, refunded.quantity);
          return { ...hold, quantity: hold.quantity - refunded.quantity };
        })
        .filter((hold) => hold.quantity > 0);
    } else if (restock) {
      for (const line of plan.lines) inventory.restock(line.sku, line.quantity, { orderId });
    }
    const refunded = recordRefund(
      { ...order, holds },
      { id: ids.next('ref'), plan, reason: reason.trim(), restocked: !beforeShipping && restock, at: clock.now() },
    );
    return save(refunded, 'order.refunded', { amountMinor: plan.amountMinor });
  }

  function listRefunds(orderId) {
    const order = repos.orders.require(orderId);
    return { refunds: order.refunds ?? [], refundedMinor: order.refundedMinor ?? 0 };
  }

  function getOrder(orderId) {
    return view(repos.orders.require(orderId));
  }

  function listOrders({ status, customerId } = {}) {
    if (status !== undefined && !ORDER_STATUSES.includes(status)) {
      throw new ValidationError(`status must be one of ${ORDER_STATUSES.join(', ')}`, { details: { field: 'status' } });
    }
    return repos.orders
      .list((order) => (status === undefined || order.status === status) && (customerId === undefined || order.customerId === customerId))
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .map(summarizeOrder);
  }

  /** What happened to an order, oldest first. */
  function orderEvents(orderId) {
    repos.orders.require(orderId);
    return repos.events.list({ orderId });
  }

  /** Totals per status, for the back-office dashboard. */
  function statusReport() {
    const report = Object.fromEntries(ORDER_STATUSES.map((status) => [status, { count: 0, totalMinor: 0 }]));
    for (const order of repos.orders.list()) {
      report[order.status].count += 1;
      report[order.status].totalMinor += order.totalMinor;
    }
    return report;
  }

  return { checkout, pay, ship, deliver, cancel, refund, listRefunds, getOrder, listOrders, orderEvents, statusReport };
}
