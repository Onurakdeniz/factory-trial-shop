// The HTTP application without a socket: `handle(request)` takes
// `{ method, path, query, body }` and resolves to `{ status, body }`, so the whole
// API can be tested without opening a port. server.js binds it to node:http.

import { createShop } from '../app/shop.js';
import { errorResponse } from './errors.js';
import { createRouter } from './router.js';
import { registerRoutes } from './routes.js';

function splitPath(rawPath) {
  const [path, search = ''] = String(rawPath || '/').split('?');
  const query = Object.fromEntries(new URLSearchParams(search));
  const trimmed = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return { path: trimmed, query };
}

export function createApp(shop = createShop()) {
  const router = registerRoutes(createRouter(), shop);

  async function handle(request = {}) {
    const method = String(request.method ?? 'GET').toUpperCase();
    const { path, query: pathQuery } = splitPath(request.path);
    const query = { ...pathQuery, ...(request.query ?? {}) };
    const match = router.match(method, path);
    if (match === null) {
      return { status: 404, body: { error: { code: 'route_not_found', message: `No route for ${method} ${path}` } } };
    }
    if (match.allowed) {
      return {
        status: 405,
        body: { error: { code: 'method_not_allowed', message: `Use ${match.allowed.join(', ')} for ${path}` } },
      };
    }
    try {
      const result = await match.handler({ params: match.params, query, body: request.body ?? null, shop });
      return { status: result.status ?? 200, body: result.body ?? null };
    } catch (error) {
      return errorResponse(error);
    }
  }

  return { shop, handle, routes: () => router.list() };
}
