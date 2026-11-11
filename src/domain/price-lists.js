// Price lists: which unit price applies to a product for a customer group, a
// quantity and a moment. Base prices, price lists with validity windows and
// priorities, and volume tiers. Totals (tax, shipping) live in totals.js.

import { ValidationError } from './errors.js';
import { assertNonNegativeMinor } from './money.js';
import { assertSku, normalizeSku } from './product.js';

export const CUSTOMER_GROUPS = ['retail', 'wholesale'];

export function assertCustomerGroup(group) {
  if (!CUSTOMER_GROUPS.includes(group)) {
    throw new ValidationError(`customerGroup must be one of ${CUSTOMER_GROUPS.join(', ')}`, {
      details: { field: 'customerGroup' },
    });
  }
  return group;
}

const PRICE_LIST_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

function assertQuantity(quantity) {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new ValidationError('quantity must be a positive integer', { details: { field: 'quantity' } });
  }
  return quantity;
}

function assertTimestamp(value, field) {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value)) {
    throw new ValidationError(`${field} must be a timestamp in milliseconds`, { details: { field } });
  }
  return value;
}

function normalizeTiers(tiers, sku) {
  if (tiers === undefined) return [];
  if (!Array.isArray(tiers)) throw new ValidationError(`tiers for ${sku} must be a list`);
  const normalized = tiers.map((tier) => {
    if (!Number.isSafeInteger(tier?.minQty) || tier.minQty < 2) {
      throw new ValidationError(`tier minQty for ${sku} must be an integer of at least 2`);
    }
    return { minQty: tier.minQty, unitMinor: assertNonNegativeMinor(tier.unitMinor, 'tier.unitMinor') };
  });
  normalized.sort((a, b) => a.minQty - b.minQty);
  for (let i = 1; i < normalized.length; i += 1) {
    if (normalized[i].minQty === normalized[i - 1].minQty) {
      throw new ValidationError(`duplicate tier minQty ${normalized[i].minQty} for ${sku}`);
    }
  }
  return normalized;
}

/**
 * Validates a price list. A price list overrides the base price of some SKUs for a
 * customer group (or for everybody when `customerGroup` is null) during a time
 * window, optionally with volume tiers.
 */
export function createPriceList(input) {
  if (input === null || typeof input !== 'object') throw new ValidationError('price list must be an object');
  if (typeof input.id !== 'string' || !PRICE_LIST_ID.test(input.id)) {
    throw new ValidationError('price list id must be lower-case letters, digits and dashes', { details: { field: 'id' } });
  }
  if (typeof input.name !== 'string' || input.name.trim() === '') {
    throw new ValidationError('price list name is required', { details: { field: 'name' } });
  }
  const customerGroup = input.customerGroup ?? null;
  if (customerGroup !== null) assertCustomerGroup(customerGroup);
  const priority = input.priority ?? 0;
  if (!Number.isSafeInteger(priority)) throw new ValidationError('priority must be an integer');
  const validFrom = assertTimestamp(input.validFrom, 'validFrom');
  const validTo = assertTimestamp(input.validTo, 'validTo');
  if (validFrom !== null && validTo !== null && validTo <= validFrom) {
    throw new ValidationError('validTo must be after validFrom', { details: { field: 'validTo' } });
  }
  if (input.entries === null || typeof input.entries !== 'object' || Array.isArray(input.entries)) {
    throw new ValidationError('entries must be an object keyed by SKU', { details: { field: 'entries' } });
  }
  const entries = {};
  for (const [rawSku, entry] of Object.entries(input.entries)) {
    const sku = assertSku(normalizeSku(rawSku));
    entries[sku] = {
      unitMinor: assertNonNegativeMinor(entry?.unitMinor, `entries.${sku}.unitMinor`),
      tiers: normalizeTiers(entry?.tiers, sku),
    };
  }
  return { id: input.id, name: input.name.trim(), customerGroup, priority, validFrom, validTo, entries };
}

/** A list applies when `at` is inside [validFrom, validTo) and the group matches. */
export function isPriceListActive(priceList, at, customerGroup) {
  if (priceList.validFrom !== null && at < priceList.validFrom) return false;
  if (priceList.validTo !== null && at >= priceList.validTo) return false;
  return priceList.customerGroup === null || priceList.customerGroup === customerGroup;
}

/**
 * The lists that can price `sku`, best first: higher priority wins; on equal
 * priority the list that was added first wins.
 */
export function applicablePriceLists(priceLists, sku, at, customerGroup) {
  return priceLists
    .map((priceList, index) => ({ priceList, index }))
    .filter(({ priceList }) => priceList.entries[sku] && isPriceListActive(priceList, at, customerGroup))
    .sort((a, b) => b.priceList.priority - a.priceList.priority || a.index - b.index)
    .map(({ priceList }) => priceList);
}

/** The unit price of an entry for a quantity: the tier with the largest minQty that fits. */
export function selectTier(entry, quantity) {
  assertQuantity(quantity);
  let chosen = { minQty: 1, unitMinor: entry.unitMinor };
  for (const tier of entry.tiers) {
    if (tier.minQty <= quantity) chosen = tier;
  }
  return chosen;
}

/**
 * Resolves the unit price of a product for a quantity. Returns the price and where
 * it came from: `{ type: 'base' }` or `{ type: 'price_list', priceListId, minQty }`.
 */
export function resolveUnitPrice({ product, quantity, priceLists = [], at, customerGroup = 'retail' }) {
  assertQuantity(quantity);
  if (!Number.isSafeInteger(at)) throw new ValidationError('at must be a timestamp');
  const [best] = applicablePriceLists(priceLists, product.sku, at, customerGroup);
  if (!best) return { unitMinor: product.basePriceMinor, source: { type: 'base' } };
  const tier = selectTier(best.entries[product.sku], quantity);
  return { unitMinor: tier.unitMinor, source: { type: 'price_list', priceListId: best.id, minQty: tier.minQty } };
}

/**
 * When buying a few more units would reach a cheaper tier, says how many and at
 * what unit price. Returns null otherwise.
 */
export function nextTierHint({ product, quantity, priceLists = [], at, customerGroup = 'retail' }) {
  const [best] = applicablePriceLists(priceLists, product.sku, at, customerGroup);
  if (!best) return null;
  const next = best.entries[product.sku].tiers.find((tier) => tier.minQty > quantity);
  if (!next) return null;
  const current = selectTier(best.entries[product.sku], quantity);
  if (next.unitMinor >= current.unitMinor) return null;
  return { addQuantity: next.minQty - quantity, unitMinor: next.unitMinor };
}

export function describePriceSource(source) {
  if (source.type === 'base') return 'base price';
  if (source.minQty > 1) return `price list ${source.priceListId} (from ${source.minQty} units)`;
  return `price list ${source.priceListId}`;
}
