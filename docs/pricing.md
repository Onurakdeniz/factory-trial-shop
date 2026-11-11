# Pricing

## Base price and price lists

Every product has a net `basePriceMinor`. A price list can override it for some SKUs:

```json
{
  "id": "wholesale-2026",
  "name": "Wholesale 2026",
  "customerGroup": "wholesale",
  "priority": 10,
  "validFrom": null,
  "validTo": null,
  "entries": { "MUG-WHITE": { "unitMinor": 900, "tiers": [{ "minQty": 10, "unitMinor": 800 }] } }
}
```

- A list applies when the cart's customer group matches (`customerGroup: null` applies to everybody) and the
  moment of pricing is inside `[validFrom, validTo)`.
- Of the lists that apply and price the SKU, the highest `priority` wins; on equal priority the list added
  first wins. Lists are not combined.
- Within the winning entry, the tier with the largest `minQty` not above the line quantity sets the unit price;
  below the first tier the entry's `unitMinor` applies.
- The cart view's `hint` tells the customer when a few more units would reach a cheaper tier.

## Tax

Prices are net. Tax categories: `standard` 20 %, `reduced` 10 %, `zero` 0 %. Tax is computed per line on the
line's net amount and rounded half up to the cent; the cart's tax is the sum of the line taxes.

## Shipping

| Region | Fee | Free from (net subtotal) |
| --- | --- | --- |
| `domestic` | 4.95 | 50.00 |
| `eu` | 9.95 | 100.00 |
| `world` | 19.95 | never |

An empty cart ships for free. Shipping is not taxed.

## Promotions

**Coupons** are typed in at the cart: `{ code, kind: "percent", percent }` or `{ code, kind: "fixed", amountMinor }`,
with optional `minSubtotalMinor` (net subtotal before discounts) and `expiresAt`. Codes are 3 to 20 letters, digits
or dashes and are case-insensitive. A cart holds one coupon; applying another replaces it. Applying checks the code
at once (`coupon_not_found` 404, `coupon_expired` and `coupon_min_subtotal` 409). If the cart changes later so the
coupon no longer qualifies, it stays on the cart with `coupon.applied: false` and a `reason`, and gives nothing.

**Offers** (`{ id, sku, buy, get }`) apply automatically: every complete group of `buy + get` units has `get` units
free, valued at the line's unit price after price lists and tiers. One offer per SKU.

An offer names a SKU that need not be in the catalog yet: it applies as soon as a product with that SKU is sold, for
example after a CSV import, and an import that updates a product keeps its offer (the free units are valued at the
new price).

**Stacking and rounding.** Offers first; then the coupon on the net amount left. A percent coupon takes its percent of
that amount once, rounded half up; a fixed coupon never takes more than what is left. The coupon discount is spread
over the lines in proportion to their remaining net with `allocate()`, and each line's tax is computed on
`netMinor - discountMinor`. The free-shipping threshold looks at the subtotal after discounts.

## Totals

`totalMinor = subtotalMinor - discountMinor + taxMinor + shippingMinor`, where `subtotalMinor` is the sum of the line
nets before discounts. Orders copy `discountMinor`, each line's `discountMinor`, and `couponCode`.
