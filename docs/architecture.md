# Architecture

The service has four layers. Dependencies point inward only: `cli` and `http` use `app`, `app` uses `domain`,
and `domain` uses nothing but itself.

```
cli ──▶ http ──▶ app ──▶ domain
  └──────────────▶ app
```

## Domain (`src/domain/`)

Pure functions over plain records. They never read the clock: every function that depends on time takes `at`
(milliseconds since the epoch). Records are never mutated; functions return new ones.

| Module | Holds |
| --- | --- |
| `errors.js` | `DomainError` and its kinds (`ValidationError`, `NotFoundError`, `ConflictError`, `InsufficientStockError`, `InvalidTransitionError`), each with a stable `code`. |
| `money.js` | Integer minor-unit arithmetic: `ratio`, `applyRate`, `allocate`, `formatMinor`, `parseMajor`. |
| `product.js` | Product records, SKU rules, tax categories. |
| `price-lists.js` | Which unit price applies: customer groups, price lists with validity windows and priorities, volume tiers, tier hints. |
| `totals.js` | What the customer pays: tax rates, regions and shipping, line and cart totals, tax breakdown, quote formatting. Uses `price-lists.js`, never the other way round. |
| `pricing.js` | Deprecated shim that re-exports `price-lists.js` and `totals.js` for old imports; new code imports the two modules directly. |
| `cart.js` | Cart records and line changes. |
| `stock.js` | Stock items, holds (reservations), expiry. |
| `order.js` | Order records and the order state machine. |

## Application (`src/app/`)

Services hold no state of their own; they read and write records through the repositories.

| Module | Holds |
| --- | --- |
| `repositories.js` | In-memory repositories (records are cloned in and out) and the event log. |
| `clock.js`, `ids.js` | The injected clock and sequential ids. |
| `catalog-service.js` | Products and price lists. |
| `inventory-service.js` | Stock levels and holds. |
| `cart-service.js` | Carts and their priced view. |
| `order-service.js` | Checkout and the order lifecycle, kept in step with the stock holds. |
| `shop.js` | `createShop({ clock, holdMinutes })`, the composition root. |

## HTTP and CLI (`src/http/`, `src/cli/`)

`createApp(shop)` returns `{ handle }`. `handle({ method, path, query, body })` resolves to `{ status, body }`
and never throws: errors become `{ error: { code, message, details? } }` with a status from their kind
(validation 400, not found 404, conflict 409). `server.js` binds `handle` to `node:http`. The CLI loads a
catalog file into an in-memory shop; see [cli.md](cli.md).

## Testing

Tests mirror the layers: `test/domain`, `test/app`, `test/http` (which also holds the CLI tests).
`test/app/fixtures.js` builds a seeded shop on a manual clock.
