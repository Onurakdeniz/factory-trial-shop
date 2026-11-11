// Deprecated: pricing.js is a compatibility shim. Import from price-lists.js (which
// unit price applies) or totals.js (tax, shipping and totals) instead. This file
// only re-exports and must not define anything itself.

export {
  CUSTOMER_GROUPS,
  assertCustomerGroup,
  createPriceList,
  isPriceListActive,
  applicablePriceLists,
  selectTier,
  resolveUnitPrice,
  nextTierHint,
  describePriceSource,
} from './price-lists.js';

export {
  TAX_RATES_BP,
  taxRateFor,
  SHIPPING_RATES,
  REGIONS,
  assertRegion,
  priceLine,
  shippingFor,
  priceCart,
  taxBreakdown,
  formatQuote,
} from './totals.js';
