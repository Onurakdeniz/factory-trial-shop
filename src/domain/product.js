// Products are identified by their SKU. Prices are net (tax exclusive) in minor units.

import { ValidationError } from './errors.js';
import { assertNonNegativeMinor } from './money.js';

export const TAX_CATEGORIES = ['standard', 'reduced', 'zero'];
export const SKU_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,31}$/;
const MAX_NAME_LENGTH = 120;

export function normalizeSku(value) {
  return String(value ?? '').trim().toUpperCase();
}

export function assertSku(sku) {
  if (typeof sku !== 'string' || !SKU_PATTERN.test(sku)) {
    throw new ValidationError(`Invalid SKU: ${sku}`, { details: { field: 'sku' } });
  }
  return sku;
}

function assertName(name) {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new ValidationError('name is required', { details: { field: 'name' } });
  }
  if (name.trim().length > MAX_NAME_LENGTH) {
    throw new ValidationError(`name must be at most ${MAX_NAME_LENGTH} characters`, { details: { field: 'name' } });
  }
  return name.trim();
}

function assertTaxCategory(category) {
  if (!TAX_CATEGORIES.includes(category)) {
    throw new ValidationError(`taxCategory must be one of ${TAX_CATEGORIES.join(', ')}`, {
      details: { field: 'taxCategory' },
    });
  }
  return category;
}

function assertTags(tags) {
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string' || tag.trim() === '')) {
    throw new ValidationError('tags must be a list of non-empty strings', { details: { field: 'tags' } });
  }
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()))];
}

/** Builds a valid product record from user input; throws ValidationError otherwise. */
export function createProduct(input) {
  if (input === null || typeof input !== 'object') throw new ValidationError('product must be an object');
  const sku = String(input.sku ?? '').trim();
  assertSku(normalizeSku(sku));
  return {
    sku,
    name: assertName(input.name),
    description: typeof input.description === 'string' ? input.description.trim() : '',
    basePriceMinor: assertNonNegativeMinor(input.basePriceMinor, 'basePriceMinor'),
    taxCategory: assertTaxCategory(input.taxCategory ?? 'standard'),
    active: input.active === undefined ? true : Boolean(input.active),
    tags: assertTags(input.tags ?? []),
  };
}

const UPDATABLE_FIELDS = ['name', 'description', 'basePriceMinor', 'taxCategory', 'active', 'tags'];

/** Applies a partial update. The SKU never changes. */
export function updateProduct(product, patch) {
  if (patch === null || typeof patch !== 'object') throw new ValidationError('patch must be an object');
  const unknown = Object.keys(patch).filter((key) => !UPDATABLE_FIELDS.includes(key));
  if (unknown.length > 0) {
    throw new ValidationError(`Cannot update ${unknown.join(', ')}`, { details: { fields: unknown } });
  }
  return createProduct({ ...product, ...patch, sku: product.sku });
}
