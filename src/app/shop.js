// The composition root: one shop with its repositories and services.

import { systemClock } from './clock.js';
import { createIdGenerator } from './ids.js';
import { createRepositories } from './repositories.js';
import { createCatalogService } from './catalog-service.js';
import { createInventoryService } from './inventory-service.js';
import { createCartService } from './cart-service.js';
import { createPromotionService } from './promotion-service.js';
import { createOrderService, DEFAULT_HOLD_MINUTES } from './order-service.js';

/**
 * Creates an empty shop. `clock` is `{ now() }` in milliseconds; `holdMinutes` is
 * how long a checkout holds stock before an unpaid order gives it back.
 */
export function createShop({ clock = systemClock, holdMinutes = DEFAULT_HOLD_MINUTES } = {}) {
  const repos = createRepositories();
  const ids = createIdGenerator();
  const catalog = createCatalogService({ repos, clock });
  const inventory = createInventoryService({ repos, clock, ids });
  const promotions = createPromotionService({ repos, clock });
  const carts = createCartService({ repos, clock, ids, catalog, promotions });
  const orders = createOrderService({ repos, clock, ids, carts, inventory, holdMinutes });
  return {
    clock,
    catalog,
    inventory,
    promotions,
    carts,
    orders,
    events: { list: (filter) => repos.events.list(filter) },
  };
}
