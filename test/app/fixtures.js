// Shared test data: a small tea shop. Imported by the app and http tests.

import { createManualClock } from '../../src/app/clock.js';
import { createShop } from '../../src/app/shop.js';

export const PRODUCTS = [
  { sku: 'TEA-GREEN', name: 'Green tea 100 g', basePriceMinor: 450, taxCategory: 'reduced', tags: ['tea'] },
  { sku: 'MUG-WHITE', name: 'White mug', basePriceMinor: 1200, taxCategory: 'standard', tags: ['kitchen'] },
  { sku: 'KETTLE-1', name: 'Electric kettle', basePriceMinor: 3999, taxCategory: 'standard', tags: ['kitchen'] },
  { sku: 'BOOK-BREW', name: 'The brewing book', basePriceMinor: 2500, taxCategory: 'zero', tags: ['books'] },
];

export const PRICE_LISTS = [
  {
    id: 'mug-volume',
    name: 'Mug volume prices',
    entries: { 'MUG-WHITE': { unitMinor: 1200, tiers: [{ minQty: 6, unitMinor: 1050 }] } },
  },
  {
    id: 'wholesale-2026',
    name: 'Wholesale 2026',
    customerGroup: 'wholesale',
    priority: 10,
    entries: { 'MUG-WHITE': { unitMinor: 900, tiers: [{ minQty: 10, unitMinor: 800 }] } },
  },
];

export const STOCK = { 'TEA-GREEN': 100, 'MUG-WHITE': 20, 'KETTLE-1': 3, 'BOOK-BREW': 10 };

/** A shop with the products, price lists and stock above, on a manual clock. */
export function seededShop({ holdMinutes } = {}) {
  const clock = createManualClock();
  const shop = createShop({ clock, holdMinutes });
  for (const product of PRODUCTS) shop.catalog.addProduct(product);
  for (const priceList of PRICE_LISTS) shop.catalog.addPriceList(priceList);
  for (const [sku, units] of Object.entries(STOCK)) shop.inventory.receive(sku, units);
  return { shop, clock };
}

/** Creates a cart with the given `{ SKU: quantity }` and checks it out. */
export function placeOrder(shop, items, cartInput = {}) {
  const cart = shop.carts.createCart({ customerId: 'cust-1', ...cartInput });
  for (const [sku, quantity] of Object.entries(items)) shop.carts.addItem(cart.id, { sku, quantity });
  return shop.orders.checkout(cart.id);
}
