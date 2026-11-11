// Carts: create, change lines, and quote with current prices.

import { ConflictError, NotFoundError, ValidationError } from '../domain/errors.js';
import { addLine, createCart, removeLine, setCoupon, setLineQuantity } from '../domain/cart.js';
import { couponProblem, normalizeCode } from '../domain/promotions.js';
import { normalizeSku } from '../domain/product.js';
import { nextTierHint } from '../domain/price-lists.js';
import { priceCart } from '../domain/totals.js';

export function createCartService({ repos, clock, ids, catalog, promotions }) {
  function requireSellable(rawSku) {
    const sku = normalizeSku(rawSku);
    const product = catalog.findProduct(sku);
    if (!product) throw new ValidationError(`Unknown product ${sku}`, { details: { sku } });
    if (!product.active) throw new ValidationError(`Product ${sku} is not for sale`, { details: { sku } });
    return product;
  }

  function change(cartId, apply) {
    const cart = repos.carts.require(cartId);
    return repos.carts.save(apply(cart, clock.now()));
  }

  /** Prices the cart's lines with the catalog as it is now. */
  function quote(cartId) {
    const cart = repos.carts.require(cartId);
    return priceCart({
      lines: cart.lines,
      products: catalog.productIndex(),
      priceLists: catalog.listPriceLists(),
      at: clock.now(),
      customerGroup: cart.customerGroup,
      region: cart.region,
      offers: promotions.listOffers(),
      coupon: cart.couponCode ? (promotions.findCoupon(cart.couponCode) ?? null) : null,
    });
  }

  /** Checks a code right away and puts it on the cart, replacing any other coupon. */
  function applyCoupon(cartId, rawCode) {
    const code = normalizeCode(rawCode);
    const coupon = promotions.findCoupon(code);
    if (!coupon) throw new NotFoundError('Coupon', code, { code: 'coupon_not_found' });
    const cart = repos.carts.require(cartId);
    const problem = couponProblem(coupon, { subtotalMinor: quote(cartId).subtotalMinor, at: clock.now() });
    if (problem === 'expired') throw new ConflictError(`Coupon ${code} has expired`, { code: 'coupon_expired' });
    if (problem === 'min_subtotal') {
      throw new ConflictError(`Coupon ${code} needs a subtotal of at least ${coupon.minSubtotalMinor}`, {
        code: 'coupon_min_subtotal',
        details: { minSubtotalMinor: coupon.minSubtotalMinor },
      });
    }
    repos.carts.save(setCoupon(cart, code, clock.now()));
    return view(cartId);
  }

  /** The cart with priced lines and totals, as clients see it. */
  function view(cartId) {
    const cart = repos.carts.require(cartId);
    const priced = quote(cartId);
    const products = catalog.productIndex();
    const priceLists = catalog.listPriceLists();
    const at = clock.now();
    return {
      id: cart.id,
      customerId: cart.customerId,
      customerGroup: cart.customerGroup,
      region: cart.region,
      status: cart.status,
      orderId: cart.orderId ?? null,
      lines: priced.lines.map((line) => ({
        ...line,
        hint: nextTierHint({
          product: products.get(line.sku),
          quantity: line.quantity,
          priceLists,
          at,
          customerGroup: cart.customerGroup,
        }),
      })),
      itemCount: priced.itemCount,
      subtotalMinor: priced.subtotalMinor,
      discountMinor: priced.discountMinor,
      coupon: priced.coupon,
      taxMinor: priced.taxMinor,
      shippingMinor: priced.shippingMinor,
      totalMinor: priced.totalMinor,
    };
  }

  return {
    createCart(input = {}) {
      const cart = createCart({ ...input, id: ids.next('cart'), at: clock.now() });
      return repos.carts.save(cart);
    },
    getCart: (cartId) => repos.carts.require(cartId),
    addItem(cartId, { sku, quantity = 1 }) {
      const product = requireSellable(sku);
      return change(cartId, (cart, at) => addLine(cart, product.sku, quantity, at));
    },
    setQuantity(cartId, sku, quantity) {
      if (quantity > 0) requireSellable(sku);
      return change(cartId, (cart, at) => setLineQuantity(cart, sku, quantity, at));
    },
    removeItem(cartId, sku) {
      return change(cartId, (cart, at) => removeLine(cart, sku, at));
    },
    applyCoupon,
    removeCoupon(cartId) {
      change(cartId, (cart, at) => setCoupon(cart, null, at));
      return view(cartId);
    },
    quote,
    view,
  };
}
