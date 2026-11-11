// The HTTP routes of the shop. A handler takes `{ params, query, body, shop }` and
// returns `{ status, body }`; errors are mapped by the caller (see app.js).

import { importProducts } from '../app/product-import.js';
import { HttpError } from './errors.js';

function requireObject(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_body', 'Request body must be a JSON object');
  }
  return body;
}

function requireInteger(body, field) {
  const value = body[field];
  if (!Number.isSafeInteger(value)) {
    throw new HttpError(400, 'invalid_body', `${field} must be an integer`);
  }
  return value;
}

function optionalString(body, field) {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_body', `${field} must be a string`);
  return value;
}

const DEFAULT_LOW_STOCK_THRESHOLD = 5;

function parseThreshold(raw) {
  if (raw === undefined) return DEFAULT_LOW_STOCK_THRESHOLD;
  const threshold = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(threshold)) {
    throw new HttpError(400, 'validation_failed', 'threshold must be a whole number of zero or more');
  }
  return threshold;
}

const ok = (body) => ({ status: 200, body });
const created = (body) => ({ status: 201, body });

function productRoutes(router, shop) {
  router.add('GET', '/products', ({ query }) =>
    ok({ products: shop.catalog.listProducts({ activeOnly: query.active === 'true', tag: query.tag }) }),
  );
  router.add('POST', '/products', ({ body }) => created(shop.catalog.addProduct(requireObject(body))));
  router.add('POST', '/products/import', ({ body }) => {
    const csv = optionalString(requireObject(body), 'csv');
    if (csv === undefined) throw new HttpError(400, 'invalid_body', 'csv is required');
    return ok(importProducts(shop, csv));
  });
  router.add('GET', '/products/:sku', ({ params }) => ok(shop.catalog.getProduct(params.sku)));
  router.add('PATCH', '/products/:sku', ({ params, body }) =>
    ok(shop.catalog.updateProduct(params.sku, requireObject(body))),
  );
  router.add('GET', '/price-lists', () => ok({ priceLists: shop.catalog.listPriceLists() }));
  router.add('POST', '/price-lists', ({ body }) => created(shop.catalog.addPriceList(requireObject(body))));
  router.add('DELETE', '/price-lists/:id', ({ params }) => {
    shop.catalog.removePriceList(params.id);
    return { status: 204, body: null };
  });
}

function promotionRoutes(router, shop) {
  router.add('GET', '/promotions', () => ok(shop.promotions.list()));
  router.add('POST', '/promotions/coupons', ({ body }) => created(shop.promotions.addCoupon(requireObject(body))));
  router.add('POST', '/promotions/offers', ({ body }) => created(shop.promotions.addOffer(requireObject(body))));
}

function stockRoutes(router, shop) {
  router.add('GET', '/stock', () => ok({ stock: shop.inventory.listStock() }));
  router.add('GET', '/stock/:sku', ({ params }) => ok(shop.inventory.getStock(params.sku)));
  router.add('POST', '/stock/:sku/receive', ({ params, body }) =>
    ok(shop.inventory.receive(params.sku, requireInteger(requireObject(body), 'quantity'))),
  );
  router.add('POST', '/stock/:sku/adjust', ({ params, body }) => {
    const input = requireObject(body);
    return ok(shop.inventory.adjust(params.sku, requireInteger(input, 'delta'), optionalString(input, 'reason')));
  });
  router.add('POST', '/stock/:sku/waitlist', ({ params, body }) =>
    created(shop.inventory.joinWaitlist(params.sku, (body ?? {}).customerId)),
  );
  router.add('GET', '/stock/:sku/waitlist', ({ params }) => ok(shop.inventory.listWaiting(params.sku)));
  router.add('DELETE', '/stock/:sku/waitlist/:customerId', ({ params }) => {
    shop.inventory.leaveWaitlist(params.sku, params.customerId);
    return { status: 204, body: null };
  });
  router.add('GET', '/reports/low-stock', ({ query }) => {
    const threshold = parseThreshold(query.threshold);
    return ok({ threshold, items: shop.inventory.lowStock(threshold) });
  });
  router.add('POST', '/stock/expire-holds', () => ok({ expired: shop.inventory.expireHolds() }));
}

function cartRoutes(router, shop) {
  router.add('POST', '/carts', ({ body }) => {
    const input = requireObject(body);
    const cart = shop.carts.createCart({
      customerId: optionalString(input, 'customerId'),
      customerGroup: optionalString(input, 'customerGroup'),
      region: optionalString(input, 'region'),
    });
    return created(shop.carts.view(cart.id));
  });
  router.add('GET', '/carts/:id', ({ params }) => ok(shop.carts.view(params.id)));
  router.add('POST', '/carts/:id/items', ({ params, body }) => {
    const input = requireObject(body);
    const sku = optionalString(input, 'sku');
    if (sku === undefined) throw new HttpError(400, 'invalid_body', 'sku is required');
    const quantity = input.quantity === undefined ? 1 : requireInteger(input, 'quantity');
    shop.carts.addItem(params.id, { sku, quantity });
    return ok(shop.carts.view(params.id));
  });
  router.add('PATCH', '/carts/:id/items/:sku', ({ params, body }) => {
    shop.carts.setQuantity(params.id, params.sku, requireInteger(requireObject(body), 'quantity'));
    return ok(shop.carts.view(params.id));
  });
  router.add('DELETE', '/carts/:id/items/:sku', ({ params }) => {
    shop.carts.removeItem(params.id, params.sku);
    return ok(shop.carts.view(params.id));
  });
  router.add('POST', '/carts/:id/coupon', ({ params, body }) => {
    const code = optionalString(requireObject(body), 'code');
    if (code === undefined) throw new HttpError(400, 'invalid_body', 'code is required');
    return ok(shop.carts.applyCoupon(params.id, code));
  });
  router.add('DELETE', '/carts/:id/coupon', ({ params }) => ok(shop.carts.removeCoupon(params.id)));
  router.add('POST', '/carts/:id/checkout', ({ params }) => created(shop.orders.checkout(params.id)));
}

function orderRoutes(router, shop) {
  router.add('GET', '/orders', ({ query }) =>
    ok({ orders: shop.orders.listOrders({ status: query.status, customerId: query.customerId }) }),
  );
  router.add('GET', '/orders/:id', ({ params }) => ok(shop.orders.getOrder(params.id)));
  router.add('GET', '/orders/:id/events', ({ params }) => ok({ events: shop.orders.orderEvents(params.id) }));
  router.add('POST', '/orders/:id/pay', ({ params, body }) => {
    const input = requireObject(body);
    return ok(
      shop.orders.pay(params.id, {
        amountMinor: requireInteger(input, 'amountMinor'),
        reference: optionalString(input, 'reference'),
      }),
    );
  });
  router.add('POST', '/orders/:id/ship', ({ params, body }) => {
    const input = requireObject(body ?? {});
    return ok(
      shop.orders.ship(params.id, {
        carrier: optionalString(input, 'carrier'),
        trackingCode: optionalString(input, 'trackingCode'),
      }),
    );
  });
  router.add('POST', '/orders/:id/deliver', ({ params }) => ok(shop.orders.deliver(params.id)));
  router.add('POST', '/orders/:id/cancel', ({ params, body }) => {
    const input = requireObject(body ?? {});
    return ok(shop.orders.cancel(params.id, { reason: optionalString(input, 'reason') }));
  });
  router.add('POST', '/orders/:id/refunds', ({ params, body }) => {
    const input = requireObject(body);
    if (!Array.isArray(input.lines)) throw new HttpError(400, 'invalid_body', 'lines must be a list');
    if (input.restock !== undefined && typeof input.restock !== 'boolean') {
      throw new HttpError(400, 'invalid_body', 'restock must be true or false');
    }
    return created(
      shop.orders.refund(params.id, { lines: input.lines, restock: input.restock ?? true, reason: optionalString(input, 'reason') }),
    );
  });
  router.add('GET', '/orders/:id/refunds', ({ params }) => ok(shop.orders.listRefunds(params.id)));
  router.add('GET', '/reports/orders', () => ok(shop.orders.statusReport()));
}

export function registerRoutes(router, shop) {
  router.add('GET', '/health', () => ok({ status: 'ok' }));
  productRoutes(router, shop);
  promotionRoutes(router, shop);
  stockRoutes(router, shop);
  cartRoutes(router, shop);
  orderRoutes(router, shop);
  return router;
}
