import { createServer } from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import { requireThat, isAlias, safeCode, SafeError } from './foundation.js';

const digest = value => createHash('sha256').update(value).digest();
async function bodyJson(request) {
  requireThat(request.headers['content-type'] === 'application/json', 'JSON_CONTENT_TYPE_REQUIRED', 415);
  requireThat(!request.headers['content-encoding'], 'ENCODING_NOT_ALLOWED', 415);
  let size = 0; const chunks = [];
  for await (const chunk of request) { size += chunk.length; requireThat(size <= 1024, 'BODY_TOO_LARGE', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new SafeError('INVALID_JSON'); }
}
function exactKeys(body, keys) {
  requireThat(body && typeof body === 'object' && !Array.isArray(body) &&
    Object.keys(body).length === keys.length && keys.every(key => Object.hasOwn(body, key)), 'INVALID_INPUT');
}
export function createOperatorServer(config, store, delivery) {
  const expected = digest(`Bearer ${config.operatorToken}`);
  const server = createServer(async (request, response) => {
    const reply = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      response.end(JSON.stringify(body));
    };
    try {
      requireThat(!Object.hasOwn(request.headers, 'origin') && !request.headers['sec-fetch-site'], 'BROWSER_REQUEST_REJECTED', 403);
      requireThat(timingSafeEqual(expected, digest(request.headers.authorization ?? '')), 'UNAUTHORIZED', 401);
      requireThat(/^127\.0\.0\.1:\d+$/.test(request.headers.host ?? ''), 'INVALID_HOST', 403);
      if (request.method === 'GET' && request.url === '/targets') { reply(200, store.list()); return; }
      requireThat(request.method === 'POST' && ['/preview', '/send', '/reconcile'].includes(request.url), 'NOT_FOUND', 404);
      const body = await bodyJson(request);
      if (request.url === '/reconcile') {
        exactKeys(body, ['alias', 'outcome', 'attemptId', 'confirm']);
        requireThat(body.confirm === true && typeof body.attemptId === 'string' && body.attemptId.length <= 64, 'INVALID_INPUT');
        reply(200, delivery.reconcile(body.alias, body.outcome, body.attemptId)); return;
      }
      exactKeys(body, request.url === '/send' ? ['alias', 'confirm'] : ['alias']);
      requireThat(isAlias(body.alias), 'INVALID_ALIAS');
      reply(200, request.url === '/send' ? await delivery.send(body.alias, body.confirm) : delivery.preview(body.alias));
    } catch (error) { reply(error instanceof SafeError ? error.status : 500, { error: safeCode(error) }); }
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  return server;
}