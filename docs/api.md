# HTTP API

All bodies are JSON. Money fields end in `Minor` and are integer cents. Errors look like
`{ "error": { "code": "insufficient_stock", "message": "...", "details": { ... } } }`.

| Status | When |
| --- | --- |
| 400 | The request is invalid (`validation_failed`, `invalid_body`, `invalid_json`, `payment_amount_mismatch`). |
| 404 | The record or route does not exist (`not_found`, `route_not_found`). |
| 405 | The route exists for other methods. |
| 409 | The request conflicts with the current state (`invalid_transition`, `insufficient_stock`, `not_refundable`, `refund_exceeds_quantity`, `product_exists`, `cart_closed`, `cart_empty`, ...). |

## Products and price lists

| Method and path | Body | Answer |
| --- | --- | --- |
| `GET /products?active=true&tag=tea` | | `{ products }` |
| `POST /products` | `{ sku, name, basePriceMinor, taxCategory?, description?, tags?, active? }` | 201, the product |
| `POST /products/import` | `{ csv }` | the import report; see [csv-import.md](csv-import.md) |
| `GET /products/:sku` | | the product |
| `PATCH /products/:sku` | any of `name, description, basePriceMinor, taxCategory, active, tags` | the product |
| `GET /price-lists` | | `{ priceLists }` |
| `POST /price-lists` | see [pricing.md](pricing.md) | 201, the price list |
| `DELETE /price-lists/:id` | | 204 |

## Promotions

| Method and path | Body | Answer |
| --- | --- | --- |
| `GET /promotions` | | `{ coupons, offers }` |
| `POST /promotions/coupons` | `{ code, kind, percent \| amountMinor, minSubtotalMinor?, expiresAt? }` | 201, the coupon |
| `POST /promotions/offers` | `{ id, sku, buy, get }` | 201, the offer |
| `POST /carts/:id/coupon` | `{ code }` | the cart view |
| `DELETE /carts/:id/coupon` | | the cart view |

## Stock

| Method and path | Body | Answer |
| --- | --- | --- |
| `GET /stock` | | `{ stock: [{ sku, onHand, reserved, available, holds }] }` |
| `GET /stock/:sku` | | `{ sku, onHand, reserved, available, holds, waiting }`, `waiting` being the number of customers on the waitlist |
| `POST /stock/:sku/receive` | `{ quantity }` | the stock view |
| `POST /stock/:sku/adjust` | `{ delta, reason? }` | the stock view |
| `GET /reports/low-stock?threshold=5` | | `{ threshold, items: [{ sku, name, left }] }` |
| `POST /stock/expire-holds` | | `{ expired }`, the number of holds removed |
| `POST /stock/:sku/waitlist` | `{ customerId }` | 201, `{ sku, customerId, position }`; `position` is 1 for the first customer waiting |
| `GET /stock/:sku/waitlist` | | `{ sku, waiting: [{ customerId, since }] }`, first to join first; `since` is the join time in milliseconds |
| `DELETE /stock/:sku/waitlist/:customerId` | | 204, no body |

The low-stock report lists the active products with `left <= threshold`, fewest first (ties by SKU). `left` is the
units available to sell (`available`: on hand minus live holds); a product that was never stocked has 0 left.
`threshold` is 5 unless `?threshold=` gives another; it must be a whole number of zero or more, otherwise the answer
is 400 `validation_failed`.

The SKU is matched case-insensitively and answered upper-case. Waitlist errors: an unknown SKU is 404 `not_found`;
a missing or empty `customerId` is 400 `validation_failed`; a product with units available is 409 `in_stock`; a
customer already waiting is 409 `already_waiting`; leaving when not waiting is 404 `not_waiting`. See
[inventory.md](inventory.md) for when waiting customers are notified.

## Carts

| Method and path | Body | Answer |
| --- | --- | --- |
| `POST /carts` | `{ customerId, customerGroup?, region? }` | 201, the cart view |
| `GET /carts/:id` | | the cart view |
| `POST /carts/:id/items` | `{ sku, quantity? }` | the cart view |
| `PATCH /carts/:id/items/:sku` | `{ quantity }` (0 removes) | the cart view |
| `DELETE /carts/:id/items/:sku` | | the cart view |
| `POST /carts/:id/checkout` | | 201, the order |

The cart view is `{ id, customerId, customerGroup, region, status, orderId, lines, itemCount, subtotalMinor,
discountMinor, coupon, taxMinor, shippingMinor, totalMinor }`; each line has `sku, name, quantity, unitMinor, netMinor,
discountMinor, taxCategory, taxRateBp, taxMinor, grossMinor, priceSource, hint`.

## Orders

| Method and path | Body | Answer |
| --- | --- | --- |
| `GET /orders?status=paid&customerId=c1` | | `{ orders }` (summaries) |
| `GET /orders/:id` | | the order |
| `GET /orders/:id/events` | | `{ events }` |
| `POST /orders/:id/pay` | `{ amountMinor, reference }` | the order |
| `POST /orders/:id/ship` | `{ carrier, trackingCode? }` | the order |
| `POST /orders/:id/deliver` | | the order |
| `POST /orders/:id/cancel` | `{ reason? }` | the order |
| `POST /orders/:id/refunds` | `{ lines: [{ sku, quantity }], restock?, reason }` | 201, the order |
| `GET /orders/:id/refunds` | | `{ refunds, refundedMinor }` |
| `GET /reports/orders` | | count and total per status |

An order is `{ id, cartId, customerId, customerGroup, region, status, lines, subtotalMinor, taxMinor,
shippingMinor, totalMinor, holds, payment, shipment, cancellation, createdAt, updatedAt, history,
allowedActions }`. See [orders.md](orders.md).
