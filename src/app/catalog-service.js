// The catalog: products and price lists.

import { ConflictError } from '../domain/errors.js';
import { createProduct, normalizeSku, updateProduct } from '../domain/product.js';
import { createPriceList } from '../domain/price-lists.js';

export function createCatalogService({ repos, clock }) {
  function addProduct(input) {
    const product = createProduct(input);
    if (repos.products.has(product.sku)) {
      throw new ConflictError(`Product ${product.sku} already exists`, { code: 'product_exists' });
    }
    repos.events.append('product.created', { sku: product.sku }, clock.now());
    return repos.products.save(product);
  }

  function getProduct(sku) {
    return repos.products.require(normalizeSku(sku));
  }

  function findProduct(sku) {
    return repos.products.get(normalizeSku(sku));
  }

  function changeProduct(sku, patch) {
    const product = updateProduct(getProduct(sku), patch);
    repos.events.append('product.updated', { sku: product.sku, fields: Object.keys(patch) }, clock.now());
    return repos.products.save(product);
  }

  function listProducts({ activeOnly = false, tag } = {}) {
    return repos.products
      .list((product) => (!activeOnly || product.active) && (tag === undefined || product.tags.includes(tag)))
      .sort((a, b) => a.sku.localeCompare(b.sku));
  }

  function addPriceList(input) {
    const priceList = createPriceList(input);
    if (repos.priceLists.has(priceList.id)) {
      throw new ConflictError(`Price list ${priceList.id} already exists`, { code: 'price_list_exists' });
    }
    return repos.priceLists.save(priceList);
  }

  function removePriceList(id) {
    repos.priceLists.require(id);
    repos.priceLists.delete(id);
  }

  return {
    addProduct,
    getProduct,
    findProduct,
    updateProduct: changeProduct,
    deactivateProduct: (sku) => changeProduct(sku, { active: false }),
    listProducts,
    addPriceList,
    removePriceList,
    listPriceLists: () => repos.priceLists.list(),
    /** Products as a Map, the form the pricing functions take. */
    productIndex: () => new Map(repos.products.list().map((product) => [product.sku, product])),
  };
}
