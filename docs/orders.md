# Orders

## States

```
placed ──pay──▶ paid ──ship──▶ shipped ──deliver──▶ delivered
  │               │               │                     │
  └────cancel─────┴──▶ cancelled  └──── last refund ────┴──▶ refunded
                  └────────────── last refund ──────────────▶ refunded
```

| Action | From | Effect |
| --- | --- | --- |
| checkout | an open, non-empty cart | the order is `placed` with the cart's prices; stock is held |
| pay | `placed` | `payment = { amountMinor, reference, paidAt }`; the amount must equal `totalMinor`; holds are confirmed |
| ship | `paid` | `shipment = { carrier, trackingCode, shippedAt }`; holds are committed |
| deliver | `shipped` | `shipment.deliveredAt` is set |
| cancel | `placed`, `paid` | holds are released; a paid order gets back what was not refunded yet, as a ledger entry with reason `cancelled` (`cancellation.refundMinor`) |
| refund | `paid`, `shipped`, `delivered` | some units are refunded (see below); after the last unit the order is `refunded`, a final status |

Any other action is refused with `invalid_transition` (409). Every change appends `{ from, to, action, at }` to
the order's `history` and an `order.*` event to the event log. `allowedActions` lists what can be done next.

## Prices

An order copies each line's `unitMinor`, `netMinor`, `taxRateBp`, `taxMinor` and `grossMinor` at checkout,
plus `subtotalMinor`, `taxMinor`, `shippingMinor` and `totalMinor`. Later catalog changes never touch it.

## Refunds

Support refunds some units of some lines with `{ lines: [{ sku, quantity }], restock, reason }` (`restock` defaults to
`true`). Other statuses are refused with `not_refundable`; more units than remain unrefunded with
`refund_exceeds_quantity` (409).

- **Amount.** Refunds are gross (net plus the tax charged): the line's `grossMinor` times the quantity over the
  line's quantity, rounded half up. The refund that returns the last units of a line gets what is left of its gross,
  so a fully refunded line returns exactly its `grossMinor`. Shipping goes back only with the refund that returns the
  last unrefunded unit of the order.
- **Discounts.** A line's `grossMinor` is what was charged for it after its share of the order's discounts (offers
  and coupon), with the tax on that discounted net. Refunds work from it, so a partial refund of a discounted line pays
  back that share of what the customer paid, and refunding every unit pays back exactly `totalMinor`.
- **Ledger.** `refunds` lists `{ id, at, reason, lines: [{ sku, quantity, amountMinor }], shippingMinor, amountMinor,
  restocked }`; `refundedMinor` is their sum and each line has `refundedQuantity`.
- **Stock.** Before shipping, refunded units come off the order's hold (they are available again; on hand does not
  change). After shipping, they go back on hand only when `restock` is true.
- A partly refunded paid order still ships; only its remaining units leave the warehouse.
