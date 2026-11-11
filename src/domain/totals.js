// Totals: what the customer pays. Tax per line, shipping per region, line and cart
// totals, and the quote text.
//
// All prices are net (tax exclusive) minor units. Tax is computed per line on the
// line's net amount and rounded half up, so the order's tax is the sum of the
// rounded line taxes. Shipping is not taxed.

import { ValidationError } from './errors.js';
import { applyRate, multiplyMinor, sumMinor, formatMinor } from './money.js';
import { normalizeSku } from './product.js';
import { assertCustomerGroup, describePriceSource, resolveUnitPrice } from './price-lists.js';
import { applyPromotions } from './promotions.js';

// ---------------------------------------------------------------------------
// Tax
// ---------------------------------------------------------------------------

/** Tax rates in basis points by tax category. */
export const TAX_RATES_BP = Object.freeze({ standard: 2000, reduced: 1000, zero: 0 });

export function taxRateFor(taxCategory) {
  const rate = TAX_RATES_BP[taxCategory];
  if (rate === undefined) throw new ValidationError(`Unknown tax category: ${taxCategory}`);
  return rate;
}

// ---------------------------------------------------------------------------
// Regions and shipping
// ---------------------------------------------------------------------------

/** Flat shipping fee per region, free from a net subtotal (null: never free). */
export const SHIPPING_RATES = Object.freeze({
  domestic: Object.freeze({ feeMinor: 495, freeFromMinor: 5000 }),
  eu: Object.freeze({ feeMinor: 995, freeFromMinor: 10000 }),
  world: Object.freeze({ feeMinor: 1995, freeFromMinor: null }),
});

export const REGIONS = Object.keys(SHIPPING_RATES);

export function assertRegion(region) {
  if (!REGIONS.includes(region)) {
    throw new ValidationError(`region must be one of ${REGIONS.join(', ')}`, { details: { field: 'region' } });
  }
  return region;
}

// ---------------------------------------------------------------------------
// Lines and totals
// ---------------------------------------------------------------------------

function assertQuantity(quantity) {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new ValidationError('quantity must be a positive integer', { details: { field: 'quantity' } });
  }
  return quantity;
}

function indexProducts(products) {
  if (products instanceof Map) return products;
  if (Array.isArray(products)) return new Map(products.map((product) => [product.sku, product]));
  throw new ValidationError('products must be a Map or an array');
}

/** Prices one line: unit price, net, tax and gross, all in minor units. */
export function priceLine({ product, quantity, priceLists = [], at, customerGroup = 'retail' }) {
  const { unitMinor, source } = resolveUnitPrice({ product, quantity, priceLists, at, customerGroup });
  const netMinor = multiplyMinor(unitMinor, quantity);
  const taxRateBp = taxRateFor(product.taxCategory);
  const taxMinor = applyRate(netMinor, taxRateBp);
  return {
    sku: product.sku,
    name: product.name,
    quantity,
    unitMinor,
    netMinor,
    taxCategory: product.taxCategory,
    taxRateBp,
    taxMinor,
    grossMinor: netMinor + taxMinor,
    priceSource: source,
  };
}

/** Shipping fee for a region and the net subtotal. An empty cart ships for free. */
export function shippingFor(region, subtotalMinor, itemCount) {
  const rate = SHIPPING_RATES[assertRegion(region)];
  if (itemCount === 0) return 0;
  if (rate.freeFromMinor !== null && subtotalMinor >= rate.freeFromMinor) return 0;
  return rate.feeMinor;
}

/** A priced line after a discount: tax is computed on the discounted net. */
function discountLine(line, discountMinor) {
  const taxMinor = applyRate(line.netMinor - discountMinor, line.taxRateBp);
  return { ...line, discountMinor, taxMinor, grossMinor: line.netMinor - discountMinor + taxMinor };
}

/**
 * Prices a whole cart. `lines` are `{ sku, quantity }`; `products` is a Map or an
 * array of product records. Unknown or inactive products are rejected. `offers` and
 * `coupon` are the promotions (see promotions.js); shipping looks at the subtotal
 * after discounts.
 */
export function priceCart({
  lines,
  products,
  priceLists = [],
  at,
  customerGroup = 'retail',
  region = 'domestic',
  offers = [],
  coupon = null,
}) {
  if (!Array.isArray(lines)) throw new ValidationError('lines must be a list');
  assertCustomerGroup(customerGroup);
  assertRegion(region);
  const index = indexProducts(products);
  const seen = new Set();
  const priced = lines.map((line) => {
    const sku = normalizeSku(line.sku);
    if (seen.has(sku)) throw new ValidationError(`duplicate line for ${sku}`);
    seen.add(sku);
    const product = index.get(sku);
    if (!product) throw new ValidationError(`Unknown product ${sku}`, { details: { sku } });
    if (!product.active) throw new ValidationError(`Product ${sku} is not for sale`, { details: { sku } });
    return priceLine({ product, quantity: assertQuantity(line.quantity), priceLists, at, customerGroup });
  });
  const promotions = applyPromotions({ lines: priced, offers, coupon, at });
  const discounted = priced.map((line, index) => discountLine(line, promotions.lineDiscounts[index]));
  const subtotalMinor = sumMinor(discounted.map((line) => line.netMinor));
  const discountMinor = promotions.discountMinor;
  const taxMinor = sumMinor(discounted.map((line) => line.taxMinor));
  const itemCount = discounted.reduce((count, line) => count + line.quantity, 0);
  const shippingMinor = shippingFor(region, subtotalMinor - discountMinor, itemCount);
  return {
    lines: discounted,
    itemCount,
    subtotalMinor,
    discountMinor,
    taxMinor,
    shippingMinor,
    totalMinor: subtotalMinor - discountMinor + taxMinor + shippingMinor,
    coupon: promotions.coupon,
    couponMinor: promotions.couponMinor,
    customerGroup,
    region,
  };
}

/** Tax per rate, for receipts: `[{ taxRateBp, netMinor, taxMinor }]`, highest rate first. */
export function taxBreakdown(pricedLines) {
  const byRate = new Map();
  for (const line of pricedLines) {
    const entry = byRate.get(line.taxRateBp) ?? { taxRateBp: line.taxRateBp, netMinor: 0, taxMinor: 0 };
    entry.netMinor += line.netMinor;
    entry.taxMinor += line.taxMinor;
    byRate.set(line.taxRateBp, entry);
  }
  return [...byRate.values()].sort((a, b) => b.taxRateBp - a.taxRateBp);
}

/** A plain-text quote, used by the CLI. */
export function formatQuote(quote) {
  const rows = quote.lines.map(
    (line) =>
      `${line.sku.padEnd(14)} ${String(line.quantity).padStart(3)} x ${formatMinor(line.unitMinor).padStart(13)}` +
      `  ${formatMinor(line.netMinor).padStart(13)}  (${describePriceSource(line.priceSource)})`,
  );
  rows.push(`${'Subtotal'.padEnd(36)}${formatMinor(quote.subtotalMinor).padStart(13)}`);
  for (const rate of taxBreakdown(quote.lines)) {
    rows.push(`${`Tax ${rate.taxRateBp / 100}%`.padEnd(36)}${formatMinor(rate.taxMinor).padStart(13)}`);
  }
  rows.push(`${`Shipping (${quote.region})`.padEnd(36)}${formatMinor(quote.shippingMinor).padStart(13)}`);
  rows.push(`${'Total'.padEnd(36)}${formatMinor(quote.totalMinor).padStart(13)}`);
  return rows.join('\n');
}
