// Inventory: stock levels per SKU and the holds that checkouts place on them.

import { NotFoundError } from '../domain/errors.js';
import { normalizeSku } from '../domain/product.js';
import {
  adjust,
  commitReservation,
  confirmReservation,
  expireReservations,
  receive,
  reduceReservation,
  release,
  reserve,
  stockView,
} from '../domain/stock.js';

export function createInventoryService({ repos, clock, ids }) {
  function requireKnownSku(rawSku) {
    const sku = normalizeSku(rawSku);
    if (!repos.products.has(sku)) throw new NotFoundError('Product', sku);
    return sku;
  }

  function update(sku, change) {
    return repos.stock.save(change(repos.stock.get(sku)));
  }

  return {
    receive(rawSku, quantity) {
      const sku = requireKnownSku(rawSku);
      const item = update(sku, (current) => receive(current, quantity));
      repos.events.append('stock.received', { sku, quantity }, clock.now());
      return stockView(item, clock.now());
    },

    adjust(rawSku, delta, reason = 'count') {
      const sku = requireKnownSku(rawSku);
      const item = update(sku, (current) => adjust(current, delta, clock.now()));
      repos.events.append('stock.adjusted', { sku, delta, reason }, clock.now());
      return stockView(item, clock.now());
    },

    getStock(rawSku) {
      const sku = requireKnownSku(rawSku);
      return stockView(repos.stock.get(sku), clock.now());
    },

    listStock() {
      const now = clock.now();
      return repos.stock
        .list()
        .map((item) => stockView(item, now))
        .sort((a, b) => a.sku.localeCompare(b.sku));
    },

    /** Places a hold that expires after `minutes` (null: never). Returns the reservation id. */
    hold(rawSku, quantity, { orderId = null, minutes = null } = {}) {
      const sku = requireKnownSku(rawSku);
      const at = clock.now();
      const reservationId = ids.next('res');
      const expiresAt = minutes === null ? null : at + minutes * 60_000;
      update(sku, (current) => reserve(current, { reservationId, quantity, orderId, at, expiresAt }));
      return reservationId;
    },

    release(sku, reservationId) {
      update(sku, (current) => release(current, reservationId));
    },

    /**
     * Makes the holds of a paid order firm, all or nothing. A live hold is confirmed;
     * an expired one is confirmed again if its units are still available; a hold the
     * sweeper already removed is placed again. If any line cannot be held, nothing
     * is saved and InsufficientStockError is thrown. Returns the holds as they are now.
     */
    confirmAll(holds, { orderId = null } = {}) {
      const at = clock.now();
      const items = new Map();
      const confirmed = holds.map((hold) => {
        const item = items.get(hold.sku) ?? repos.stock.get(hold.sku);
        if (item.reservations.some((reservation) => reservation.id === hold.reservationId)) {
          items.set(hold.sku, confirmReservation(item, hold.reservationId, at));
          return hold;
        }
        const reservationId = ids.next('res');
        items.set(hold.sku, reserve(item, { reservationId, quantity: hold.quantity, orderId, at, expiresAt: null }));
        return { ...hold, reservationId };
      });
      for (const item of items.values()) repos.stock.save(item);
      return confirmed;
    },

    /** Units of a paid order were refunded before shipping: they come off its hold. */
    reduceHold(sku, reservationId, quantity) {
      update(sku, (current) => reduceReservation(current, reservationId, quantity));
    },

    /** Returned units in good shape go back on hand. */
    restock(rawSku, quantity, { orderId = null } = {}) {
      const sku = requireKnownSku(rawSku);
      update(sku, (current) => receive(current, quantity));
      repos.events.append('stock.returned', { sku, quantity, orderId }, clock.now());
    },

    commit(sku, reservationId) {
      update(sku, (current) => commitReservation(current, reservationId));
    },

    /** Removes expired holds everywhere; returns how many were removed. */
    expireHolds() {
      const now = clock.now();
      let removed = 0;
      for (const current of repos.stock.list()) {
        const { item, expired } = expireReservations(current, now);
        if (expired.length === 0) continue;
        repos.stock.save(item);
        removed += expired.length;
        for (const reservation of expired) {
          repos.events.append('stock.hold_expired', { sku: item.sku, reservationId: reservation.id, orderId: reservation.orderId }, now);
        }
      }
      return removed;
    },
  };
}
