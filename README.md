# factory-shop

The order and inventory service of a small online tea shop: products and price lists, carts with tax and
shipping, stock with checkout holds, and orders that go from placed to delivered. It has an HTTP API, a small
command line, and no dependencies.

## Quick start

Node 22 or newer; there is nothing to install.

```sh
npm test                                                     # the whole test suite
node src/cli/shop.js catalog --data docs/examples/catalog.json
node src/cli/shop.js quote --data docs/examples/catalog.json --item TEA-GREEN=3 --item MUG-WHITE=2
node src/cli/shop.js serve --data docs/examples/catalog.json --port 8080
```

## Rules that hold everywhere

- Money is an integer number of minor units (cents) in one currency (EUR). Fields that hold money end in `Minor`.
- Prices are net; tax is added per line and rounded half up (see [docs/pricing.md](docs/pricing.md)).
- A checkout holds the stock of its lines for 15 minutes; paying confirms the hold, shipping takes the units off
  hand (see [docs/inventory.md](docs/inventory.md)).
- An order keeps the prices it was placed with (see [docs/orders.md](docs/orders.md)).

## Layout

| Path | What it holds |
| --- | --- |
| `src/domain/` | Pure rules: money, products, pricing, carts, stock, orders. No I/O, no clock. |
| `src/app/` | Services that compose the domain over in-memory repositories; `createShop()` wires them. |
| `src/http/` | The HTTP API: `createApp(shop).handle(request)` and the `node:http` binding. |
| `src/cli/` | The `shop` command line. |
| `test/` | Tests per layer, run with `node --test`. |
| `docs/` | Architecture, API, pricing, inventory, orders and CLI notes. |

Start with [docs/architecture.md](docs/architecture.md).
