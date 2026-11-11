// The CLI works on a catalog file: `{ products: [...], priceLists: [...], stock: { SKU: units } }`.
// It loads the file into an in-memory shop and can write a shop back to that form.

import { createShop } from '../app/shop.js';
import { ConflictError } from '../domain/errors.js';
import { normalizeSku } from '../domain/product.js';
import { UsageError } from './args.js';

export function readDataFile(io, path) {
  let text;
  try {
    text = io.readFile(path);
  } catch (error) {
    throw new UsageError(`Cannot read ${path}: ${error.code ?? error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new UsageError(`${path} is not valid JSON`);
  }
}

export function loadShop(data, options = {}) {
  const shop = createShop(options);
  const seen = new Map();
  for (const [index, product] of (data.products ?? []).entries()) {
    const sku = normalizeSku(product?.sku);
    if (seen.has(sku)) {
      const first = seen.get(sku);
      throw new ConflictError(
        `SKU ${sku} is in the catalog twice: products[${first.index}] (${first.written}) and products[${index}] (${product.sku}); remove one`,
        { code: 'product_exists' },
      );
    }
    seen.set(sku, { index, written: product?.sku });
    shop.catalog.addProduct(product);
  }
  for (const priceList of data.priceLists ?? []) shop.catalog.addPriceList(priceList);
  for (const [sku, units] of Object.entries(data.stock ?? {})) {
    if (units > 0) shop.inventory.receive(sku, units);
  }
  return shop;
}

/** The catalog file form of a shop: products, price lists and units on hand. */
export function dumpShop(shop) {
  const stock = {};
  for (const item of shop.inventory.listStock()) stock[item.sku] = item.onHand;
  return {
    products: shop.catalog.listProducts(),
    priceLists: shop.catalog.listPriceLists(),
    stock,
  };
}
