// The back-in-stock waitlist of one SKU: customers waiting for units, first to join first.
// A list is an array of `{ customerId, since }`; functions return new lists.

import { ConflictError, NotFoundError, ValidationError } from './errors.js';

/**
 * Puts a customer at the end of the list. Refused when units are available right now
 * (`in_stock`) or the customer already waits (`already_waiting`).
 * Returns the new list and the customer's position (1 for the first).
 */
export function join(list, { customerId, available, sku }, at) {
  if (typeof customerId !== 'string' || customerId.trim() === '') {
    throw new ValidationError('customerId is required', { details: { field: 'customerId' } });
  }
  if (available > 0) {
    throw new ConflictError(`${sku} is in stock`, { code: 'in_stock', details: { sku, available } });
  }
  if (list.some((entry) => entry.customerId === customerId)) {
    throw new ConflictError(`${customerId} is already waiting for ${sku}`, {
      code: 'already_waiting',
      details: { sku, customerId },
    });
  }
  return { list: [...list, { customerId, since: at }], position: list.length + 1 };
}

/** Takes a customer off the list. */
export function leave(list, customerId, sku) {
  if (!list.some((entry) => entry.customerId === customerId)) {
    throw new NotFoundError('Waitlist entry', customerId, { code: 'not_waiting', details: { sku, customerId } });
  }
  return list.filter((entry) => entry.customerId !== customerId);
}

/** Whether a change of availability from `before` to `after` is a product coming back in stock. */
export function isBackInStock(before, after) {
  return before <= 0 && after > 0;
}

/** The public view of a list. */
export function waitlistView(sku, list) {
  return { sku, waiting: list.map(({ customerId, since }) => ({ customerId, since })) };
}
