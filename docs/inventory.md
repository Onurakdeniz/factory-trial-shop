# Inventory

Each SKU has units **on hand** and a list of **holds** (reservations) on them. `available = onHand - reserved`,
where only live holds count as reserved.

## Holds

- **Checkout** places one hold per order line. A checkout hold expires after `holdMinutes` (15 by default,
  `createShop({ holdMinutes })`). If one line cannot be held, the holds already taken for that checkout are
  released and the checkout fails with `insufficient_stock`.
- **Payment** confirms the order's holds: a confirmed hold no longer expires.
- **Shipping** commits the holds: the units leave `onHand` and the holds are removed.
- **Cancelling** releases the holds.
- An expired hold stops counting as reserved at its expiry time. The sweeper (`inventory.expireHolds()`,
  `POST /stock/expire-holds`, and every minute in the server) removes expired holds and logs
  `stock.hold_expired` events.

## Late payments

A payment can arrive after the order's checkout hold expired. The expired hold no longer protects its units:
another checkout may have taken them in the meantime. Payment therefore makes every hold of the order firm again,
all or nothing:

- a hold that is still live is confirmed;
- an expired hold that is still listed is confirmed only if its units are still available;
- a hold the sweeper already removed is placed again as a firm hold, if the units are available.

If any line cannot be held, the payment is refused with `insufficient_stock` (409), no hold changes, and the order
stays `placed` without a payment, so support can cancel it. Shipping never takes `onHand` below zero.

## Corrections

`receive` adds delivered units. `adjust` corrects after a count with a signed `delta` and a reason; it cannot
take `onHand` below the units that are reserved.

## What moves units on hand

`onHand` changes only when goods are received, after a count (`adjust`), when an order ships, and when returned units
are restocked with a refund (`restock: true`). A change of an order's status never puts units back on hand: units
that left the warehouse are counted again only once someone has them in hand, so `onHand` always matches the shelves.

## Waitlist

A customer can wait for a product that has nothing available (`available <= 0`): `POST /stock/:sku/waitlist`.
Joining is refused with `in_stock` when units are available right now and with `already_waiting` when the customer
is on that product's list. Customers are listed first to join first; `since` is the shop clock's time of joining.
`GET /stock/:sku` reports the number waiting as `waiting`.

- **Notification.** When `receive` or a positive `adjust` makes units available for a product that had none
  available just before, every customer on its list is notified in the order they joined, and the list is emptied.
  A notification is one `waitlist.notified` event `{ sku, customerId }` per customer in the event log.
- **Nothing else notifies.** Releasing or expiring holds, restocking returned units with a refund, receiving more of
  a product that already had units available, and negative adjustments do not.
- A customer leaves the list with `DELETE /stock/:sku/waitlist/:customerId`; `not_waiting` if not on it.
