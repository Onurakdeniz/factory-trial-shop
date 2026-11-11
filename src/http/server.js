// Binds the HTTP application to node:http: reads and parses the JSON body, calls
// `handle`, and writes the JSON response. Also runs the hold sweeper.

import { createServer as createHttpServer } from 'node:http';

export const MAX_BODY_BYTES = 1_000_000;

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('body too large'), { status: 413, code: 'body_too_large' }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function send(response, status, body) {
  if (status === 204 || body === null) {
    response.writeHead(status);
    response.end();
    return;
  }
  const text = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  response.end(text);
}

export function createServer(app) {
  return createHttpServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const raw = await readBody(request);
      let body = null;
      if (raw.trim() !== '') {
        try {
          body = JSON.parse(raw);
        } catch {
          send(response, 400, { error: { code: 'invalid_json', message: 'Request body is not valid JSON' } });
          return;
        }
      }
      const result = await app.handle({
        method: request.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        body,
      });
      send(response, result.status, result.body);
    } catch (error) {
      const status = error.status ?? 500;
      send(response, status, { error: { code: error.code ?? 'internal_error', message: error.message } });
    }
  });
}

/** Starts listening and sweeps expired holds every `sweepIntervalMs`. */
export function startServer({ app, port = 8080, host = '127.0.0.1', sweepIntervalMs = 60_000 }) {
  const server = createServer(app);
  const sweeper = setInterval(() => app.shop.inventory.expireHolds(), sweepIntervalMs);
  sweeper.unref();
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      resolve({
        server,
        port: server.address().port,
        close: () =>
          new Promise((done) => {
            clearInterval(sweeper);
            server.close(() => done());
          }),
      });
    });
  });
}
