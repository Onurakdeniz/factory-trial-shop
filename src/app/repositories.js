// In-memory repositories. Records are cloned on the way in and out, so callers can
// never change stored state by mutating an object they hold.

import { NotFoundError } from '../domain/errors.js';
import { createStockItem } from '../domain/stock.js';

const clone = (value) => (value === undefined ? undefined : structuredClone(value));

/** A keyed collection that keeps insertion order. */
export function createMemoryRepository(kind, keyOf = (record) => record.id) {
  const records = new Map();
  return {
    kind,
    get(key) {
      return clone(records.get(key));
    },
    require(key) {
      const record = records.get(key);
      if (record === undefined) throw new NotFoundError(kind, key);
      return clone(record);
    },
    has(key) {
      return records.has(key);
    },
    save(record) {
      records.set(keyOf(record), clone(record));
      return clone(record);
    },
    delete(key) {
      return records.delete(key);
    },
    list(filter = () => true) {
      return [...records.values()].filter(filter).map(clone);
    },
    count() {
      return records.size;
    },
  };
}

/** Stock items exist for every SKU that was ever stocked; a missing one is empty. */
export function createStockRepository() {
  const items = new Map();
  return {
    kind: 'Stock',
    get(sku) {
      return clone(items.get(sku) ?? createStockItem(sku));
    },
    has(sku) {
      return items.has(sku);
    },
    save(item) {
      items.set(item.sku, clone(item));
      return clone(item);
    },
    list() {
      return [...items.values()].map(clone);
    },
  };
}

/** An append-only log of what happened, for the audit view. */
export function createEventLog() {
  const events = [];
  return {
    append(type, data, at) {
      const event = { seq: events.length + 1, type, at, ...data };
      events.push(event);
      return clone(event);
    },
    list({ type, orderId } = {}) {
      return events
        .filter((event) => (type === undefined || event.type === type) && (orderId === undefined || event.orderId === orderId))
        .map(clone);
    },
  };
}

export function createRepositories() {
  return {
    products: createMemoryRepository('Product', (product) => product.sku),
    priceLists: createMemoryRepository('Price list'),
    carts: createMemoryRepository('Cart'),
    orders: createMemoryRepository('Order'),
    coupons: createMemoryRepository('Coupon', (coupon) => coupon.code),
    offers: createMemoryRepository('Offer'),
    stock: createStockRepository(),
    events: createEventLog(),
  };
}
