// Promotions: coupon codes and automatic buy-X-get-Y offers.
//
// Offers apply first. One coupon then applies to the net amount left after the
// offers: a percent coupon takes its percent of that amount once (rounded half up),
// a fixed coupon its amount but never more than what is left. The coupon discount is
// spread over the lines in proportion to their remaining net (largest remainder), so
// tax can be computed per line on the discounted amounts.

import { ValidationError } from './errors.js';
import { allocate, ratio, sumMinor } from './money.js';
import { assertSku, normalizeSku } from './product.js';

const CODE_PATTERN = /^[A-Z0-9-]{3,20}$/;
const OFFER_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function normalizeCode(code) {
  return String(code ?? '').trim().toUpperCase();
}

function positiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ValidationError(`${field} must be a positive integer`, { details: { field } });
  }
  return value;
}

export function createCoupon(input) {
  if (input === null || typeof input !== 'object') throw new ValidationError('coupon must be an object');
  const code = normalizeCode(input.code);
  if (!CODE_PATTERN.test(code)) {
    throw new ValidationError('code must be 3 to 20 letters, digits or dashes', { details: { field: 'code' } });
  }
  const coupon = { code, kind: input.kind, percent: null, amountMinor: null, minSubtotalMinor: 0, expiresAt: null };
  if (input.kind === 'percent') {
    coupon.percent = positiveInteger(input.percent, 'percent');
    if (coupon.percent > 100) throw new ValidationError('percent must be at most 100', { details: { field: 'percent' } });
  } else if (input.kind === 'fixed') {
    coupon.amountMinor = positiveInteger(input.amountMinor, 'amountMinor');
  } else {
    throw new ValidationError('kind must be percent or fixed', { details: { field: 'kind' } });
  }
  if (input.minSubtotalMinor !== undefined && input.minSubtotalMinor !== null) {
    if (!Number.isSafeInteger(input.minSubtotalMinor) || input.minSubtotalMinor < 0) {
      throw new ValidationError('minSubtotalMinor must be a non-negative integer', { details: { field: 'minSubtotalMinor' } });
    }
    coupon.minSubtotalMinor = input.minSubtotalMinor;
  }
  if (input.expiresAt !== undefined && input.expiresAt !== null) {
    if (!Number.isSafeInteger(input.expiresAt)) {
      throw new ValidationError('expiresAt must be a timestamp in milliseconds', { details: { field: 'expiresAt' } });
    }
    coupon.expiresAt = input.expiresAt;
  }
  return coupon;
}

export function createOffer(input) {
  if (input === null || typeof input !== 'object') throw new ValidationError('offer must be an object');
  if (typeof input.id !== 'string' || !OFFER_ID.test(input.id)) {
    throw new ValidationError('offer id must be lower-case letters, digits and dashes', { details: { field: 'id' } });
  }
  return {
    id: input.id,
    sku: assertSku(normalizeSku(input.sku)),
    buy: positiveInteger(input.buy, 'buy'),
    get: positiveInteger(input.get, 'get'),
  };
}

/** Why a coupon gives no discount right now: 'expired', 'min_subtotal' or null. */
export function couponProblem(coupon, { subtotalMinor, at }) {
  if (coupon.expiresAt !== null && at >= coupon.expiresAt) return 'expired';
  if (subtotalMinor < coupon.minSubtotalMinor) return 'min_subtotal';
  return null;
}

/** The value of the free units an offer gives on a priced line. */
export function offerDiscount(offer, line) {
  const groups = Math.floor(line.quantity / (offer.buy + offer.get));
  return groups * offer.get * line.unitMinor;
}

/**
 * Discounts for priced lines (`{ sku, quantity, unitMinor, netMinor }`). Returns
 * `{ lineDiscounts, discountMinor, couponMinor, coupon }`, where `lineDiscounts`
 * follows the order of `lines` and `coupon` is the cart's view of the coupon
 * (`{ code, applied, reason }`, or null without a coupon).
 */
export function applyPromotions({ lines, offers = [], coupon = null, at }) {
  const subtotalMinor = sumMinor(lines.map((line) => line.netMinor));
  const offerDiscounts = lines.map((line) => {
    const offer = offers.find((candidate) => candidate.sku === line.sku);
    return offer ? offerDiscount(offer, line) : 0;
  });
  const remaining = lines.map((line, index) => line.netMinor - offerDiscounts[index]);
  const remainingMinor = sumMinor(remaining);
  let couponMinor = 0;
  let couponView = null;
  if (coupon) {
    const reason = couponProblem(coupon, { subtotalMinor, at });
    if (reason === null) {
      couponMinor = coupon.kind === 'percent' ? ratio(remainingMinor, coupon.percent, 100) : Math.min(coupon.amountMinor, remainingMinor);
    }
    couponView = { code: coupon.code, applied: reason === null, reason };
  }
  const shares = allocate(couponMinor, remaining);
  const lineDiscounts = lines.map((_, index) => offerDiscounts[index] + (shares[index] ?? 0));
  return { lineDiscounts, discountMinor: sumMinor(lineDiscounts), couponMinor, coupon: couponView };
}
