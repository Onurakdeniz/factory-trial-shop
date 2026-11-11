// Money is always an integer number of minor units (cents). The shop sells in one
// currency, so amounts are plain integers; never store or add floats.

import { ValidationError } from './errors.js';

export const CURRENCY = 'EUR';
export const MINOR_PER_MAJOR = 100;

export function assertMinor(value, field = 'amount') {
  if (!Number.isSafeInteger(value)) {
    throw new ValidationError(`${field} must be an integer number of minor units`, { details: { field } });
  }
  return value;
}

export function assertNonNegativeMinor(value, field = 'amount') {
  assertMinor(value, field);
  if (value < 0) throw new ValidationError(`${field} must not be negative`, { details: { field } });
  return value;
}

export function sumMinor(values) {
  let total = 0;
  for (const value of values) total += assertMinor(value);
  return total;
}

export function multiplyMinor(unitMinor, quantity) {
  assertMinor(unitMinor, 'unitMinor');
  if (!Number.isSafeInteger(quantity)) throw new ValidationError('quantity must be an integer');
  return unitMinor * quantity;
}

/**
 * Divides two integers and rounds half away from zero, without going through a
 * float product. `ratio(1000, 1, 3)` is 333, `ratio(1001, 1, 2)` is 501.
 */
export function ratio(amountMinor, numerator, denominator) {
  assertMinor(amountMinor);
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new ValidationError('ratio needs integer terms and a positive denominator');
  }
  const product = amountMinor * numerator;
  const sign = product < 0 ? -1 : 1;
  const absolute = Math.abs(product);
  const quotient = Math.floor(absolute / denominator);
  const remainder = absolute - quotient * denominator;
  return sign * (remainder * 2 >= denominator ? quotient + 1 : quotient);
}

/** A rate in basis points (2000 = 20 %) applied to an amount, rounded half up. */
export function applyRate(amountMinor, basisPoints) {
  return ratio(amountMinor, basisPoints, 10_000);
}

/**
 * Splits `totalMinor` over `weights` in proportion, so the parts always add up to
 * the total. Leftover minor units go to the largest fractional remainders; on a tie
 * the earlier weight wins.
 */
export function allocate(totalMinor, weights) {
  assertMinor(totalMinor, 'totalMinor');
  if (weights.length === 0) return [];
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightSum <= 0) {
    const parts = weights.map(() => 0);
    parts[0] = totalMinor;
    return parts;
  }
  const parts = weights.map((weight) => Math.floor((totalMinor * weight) / weightSum));
  let leftover = totalMinor - parts.reduce((sum, part) => sum + part, 0);
  const order = weights
    .map((weight, index) => ({ index, remainder: (totalMinor * weight) % weightSum }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; leftover > 0; i = (i + 1) % order.length) {
    parts[order[i].index] += 1;
    leftover -= 1;
  }
  return parts;
}

export function formatMinor(amountMinor, currency = CURRENCY) {
  assertMinor(amountMinor);
  const sign = amountMinor < 0 ? '-' : '';
  const absolute = Math.abs(amountMinor);
  const major = Math.floor(absolute / MINOR_PER_MAJOR);
  const minor = String(absolute % MINOR_PER_MAJOR).padStart(2, '0');
  return `${sign}${major}.${minor} ${currency}`;
}

/** Writes minor units as plain decimal major units, e.g. 1250 as "12.50", with integer arithmetic only. */
export function formatMajor(amountMinor) {
  assertMinor(amountMinor);
  const sign = amountMinor < 0 ? '-' : '';
  const absolute = Math.abs(amountMinor);
  const major = Math.floor(absolute / MINOR_PER_MAJOR);
  return `${sign}${major}.${String(absolute % MINOR_PER_MAJOR).padStart(2, '0')}`;
}

/** Parses "12", "12.5" or "12.50" (major units) into minor units. */
export function parseMajor(text) {
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(String(text).trim());
  if (!match) throw new ValidationError(`Not an amount: ${text}`);
  const [, minus, whole, fraction = ''] = match;
  const value = Number(whole) * MINOR_PER_MAJOR + Number(fraction.padEnd(2, '0'));
  return minus ? -value : value;
}
