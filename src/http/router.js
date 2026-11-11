// A tiny router: exact segments and `:name` parameters, no wildcards.

function compile(pattern) {
  const segments = pattern.split('/').filter(Boolean);
  return segments.map((segment) =>
    segment.startsWith(':') ? { param: segment.slice(1) } : { literal: segment },
  );
}

function matchSegments(compiled, parts) {
  if (compiled.length !== parts.length) return null;
  const params = {};
  for (let i = 0; i < compiled.length; i += 1) {
    const segment = compiled[i];
    if (segment.literal !== undefined) {
      if (segment.literal !== parts[i]) return null;
    } else {
      params[segment.param] = decodeURIComponent(parts[i]);
    }
  }
  return params;
}

export function createRouter() {
  const routes = [];
  return {
    add(method, pattern, handler) {
      routes.push({ method, pattern, compiled: compile(pattern), handler });
      return this;
    },
    /**
     * Finds the handler for a request. Returns `{ handler, params }`, or
     * `{ allowed: [...] }` when the path exists for other methods, or null.
     */
    match(method, path) {
      const parts = path.split('/').filter(Boolean);
      const allowed = [];
      for (const route of routes) {
        const params = matchSegments(route.compiled, parts);
        if (!params) continue;
        if (route.method === method) return { handler: route.handler, params, pattern: route.pattern };
        allowed.push(route.method);
      }
      return allowed.length > 0 ? { allowed } : null;
    },
    list() {
      return routes.map(({ method, pattern }) => ({ method, pattern }));
    },
  };
}
