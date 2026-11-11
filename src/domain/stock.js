// Stock of one SKU: units on hand and the holds (reservations) placed on them.
//
// A checkout places a hold with an expiry time so abandoned orders give their
// units back. Paying confirms the hold (it no longer expires); shipping commits it,
// which takes the units off hand. Expired holds no longer count as reserved, even
// before the sweeper removes them.

import { ConflictError, InsufficientStockError, NotFoundError, ValidationError } from './errors.js';

function assertUnits(quantity, field = 'quantity') {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new ValidationError(`${field} must be a positive integer`, { details: { field } });
  }
  return quantity;
}

export function createStockItem(sku) {
  return { sku, onHand: 0, reservations: [] };
}

export function isReservationLive(reservation, at) {
  return reservation.expiresAt === null || reservation.expiresAt > at;
}

export function reservedQuantity(item, at) {
  return item.reservations
    .filter((reservation) => isReservationLive(reservation, at))
    .reduce((sum, reservation) => sum + reservation.quantity, 0);
}

export function availableQuantity(item, at) {
  return item.onHand - reservedQuantity(item, at);
}

function findReservation(item, reservationId) {
  const reservation = item.reservations.find((candidate) => candidate.id === reservationId);
  if (!reservation) throw new NotFoundError('Reservation', reservationId);
  return reservation;
}

function withoutReservation(item, reservationId) {
  return item.reservations.filter((reservation) => reservation.id !== reservationId);
}

/** Goods received from a supplier. */
export function receive(item, quantity) {
  assertUnits(quantity);
  return { ...item, onHand: item.onHand + quantity };
}

/** A manual correction after a count; cannot take on-hand below what is reserved. */
export function adjust(item, delta, at) {
  if (!Number.isSafeInteger(delta) || delta === 0) {
    throw new ValidationError('delta must be a non-zero integer', { details: { field: 'delta' } });
  }
  const onHand = item.onHand + delta;
  if (onHand < reservedQuantity(item, at)) {
    throw new ConflictError(`Adjustment would leave ${item.sku} below its reserved units`, {
      code: 'adjustment_below_reserved',
      details: { sku: item.sku, onHand, reserved: reservedQuantity(item, at) },
    });
  }
  return { ...item, onHand };
}

/** Places a hold. `expiresAt` null means the hold does not expire. */
export function reserve(item, { reservationId, quantity, orderId = null, at, expiresAt = null }) {
  assertUnits(quantity);
  if (item.reservations.some((reservation) => reservation.id === reservationId)) {
    throw new ConflictError(`Reservation ${reservationId} already exists`);
  }
  const available = availableQuantity(item, at);
  if (quantity > available) throw new InsufficientStockError(item.sku, quantity, available);
  const reservation = { id: reservationId, quantity, orderId, createdAt: at, expiresAt };
  return { ...item, reservations: [...item.reservations, reservation] };
}

/** Gives the units of a hold back (order cancelled before shipping). */
export function release(item, reservationId) {
  findReservation(item, reservationId);
  return { ...item, reservations: withoutReservation(item, reservationId) };
}

/** Takes `quantity` units off a hold (part of a paid order was refunded); a hold that reaches 0 goes. */
export function reduceReservation(item, reservationId, quantity) {
  assertUnits(quantity);
  const reservation = findReservation(item, reservationId);
  if (quantity >= reservation.quantity) return { ...item, reservations: withoutReservation(item, reservationId) };
  const reservations = item.reservations.map((candidate) =>
    candidate.id === reservationId ? { ...reservation, quantity: reservation.quantity - quantity } : candidate,
  );
  return { ...item, reservations };
}

/**
 * Turns a checkout hold into a firm hold that no longer expires (the order is paid).
 * A hold that already expired no longer protects its units: it is made firm again
 * only if the units are still available at `at`, otherwise this throws
 * InsufficientStockError. (Confirming an expired hold without that check used to
 * bring it back on top of holds that took its units, and stock went negative.)
 */
export function confirmReservation(item, reservationId, at) {
  const reservation = findReservation(item, reservationId);
  if (!isReservationLive(reservation, at)) {
    const available = availableQuantity(item, at);
    if (reservation.quantity > available) throw new InsufficientStockError(item.sku, reservation.quantity, available);
  }
  const reservations = item.reservations.map((candidate) =>
    candidate.id === reservationId ? { ...reservation, expiresAt: null } : candidate,
  );
  return { ...item, reservations };
}

/** The units of a hold leave the warehouse (order shipped). Never takes on-hand below zero. */
export function commitReservation(item, reservationId) {
  const reservation = findReservation(item, reservationId);
  if (reservation.quantity > item.onHand) {
    throw new InsufficientStockError(item.sku, reservation.quantity, item.onHand);
  }
  return {
    ...item,
    onHand: item.onHand - reservation.quantity,
    reservations: withoutReservation(item, reservationId),
  };
}

/** Removes holds that expired at or before `at`; returns the new item and the removed holds. */
export function expireReservations(item, at) {
  const expired = item.reservations.filter((reservation) => !isReservationLive(reservation, at));
  if (expired.length === 0) return { item, expired };
  return { item: { ...item, reservations: item.reservations.filter((r) => isReservationLive(r, at)) }, expired };
}

/** The public view of a stock item at a moment. */
export function stockView(item, at) {
  const reserved = reservedQuantity(item, at);
  return {
    sku: item.sku,
    onHand: item.onHand,
    reserved,
    available: item.onHand - reserved,
    holds: item.reservations
      .filter((reservation) => isReservationLive(reservation, at))
      .map(({ id, quantity, orderId, expiresAt }) => ({ id, quantity, orderId, expiresAt })),
  };
}

/**
 * The active products with `threshold` units or fewer left (available: on hand minus live holds),
 * fewest first, then by SKU. A product without a stock item has 0 left.
 */
export function lowStock(items, products, threshold, at) {
  const bySku = new Map(items.map((item) => [item.sku, item]));
  return products
    .filter((product) => product.active)
    .map((product) => {
      const item = bySku.get(product.sku);
      return { sku: product.sku, name: product.name, left: item ? availableQuantity(item, at) : 0 };
    })
    .filter((line) => line.left <= threshold)
    .sort((a, b) => a.left - b.left || a.sku.localeCompare(b.sku));
}
