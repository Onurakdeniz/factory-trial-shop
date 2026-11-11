// Promotions: coupon codes and buy-X-get-Y offers.

import { ConflictError } from '../domain/errors.js';
import { createCoupon, createOffer, normalizeCode } from '../domain/promotions.js';

export function createPromotionService({ repos, clock }) {
  return {
    addCoupon(input) {
      const coupon = createCoupon(input);
      if (repos.coupons.has(coupon.code)) {
        throw new ConflictError(`Coupon ${coupon.code} already exists`, { code: 'coupon_exists' });
      }
      repos.events.append('promotion.coupon_created', { code: coupon.code }, clock.now());
      return repos.coupons.save(coupon);
    },
    addOffer(input) {
      const offer = createOffer(input);
      if (repos.offers.has(offer.id) || repos.offers.list((existing) => existing.sku === offer.sku).length > 0) {
        throw new ConflictError(`An offer for ${offer.sku} already exists`, { code: 'offer_exists' });
      }
      repos.events.append('promotion.offer_created', { offerId: offer.id, sku: offer.sku }, clock.now());
      return repos.offers.save(offer);
    },
    findCoupon: (code) => repos.coupons.get(normalizeCode(code)),
    listOffers: () => repos.offers.list(),
    list: () => ({ coupons: repos.coupons.list(), offers: repos.offers.list() }),
  };
}
