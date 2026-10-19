import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { Store } from '../src/store.js';
import { Delivery } from '../src/delivery.js';
import { createOperatorServer } from '../src/operator-api.js';
import { createTeamsApp, sdkTransport, startTeamsApp } from '../src/sdk.js';
import teamsApi from '@microsoft/teams.api';
import { Client } from '@microsoft/teams.common';

const { Client: ApiClient } = teamsApi;

const config = { tenantId: '11111111-1111-4111-8111-111111111111', botClientId: '22222222-2222-4222-8222-222222222222',
  botClientSecret: 'synthetic-not-a-real-secret', operatorToken: 'a'.repeat(64), allowedUserIds: [] };
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => server.close(resolve));
const makeStore = () => new Store(join(mkdtempSync(join(tmpdir(), 'argus-http-')), 'store.json'));
test('startup refuses success when the SDK did not open its own listener', async () => {
  let port;
  const app = { async start(value) { port = value; }, server: { adapter: { server: { listening: false } } } };
  await assert.rejects(startTeamsApp(app, 3978), /TEAMS_WEBHOOK_START_FAILED/);
  assert.equal(port, 3978);
  app.server.adapter.server.listening = true;
  await startTeamsApp(app, 3978);
});

test('operator binds loopback, authenticates, rejects Origin, strict bodies and oversized requests', async () => {
  const store = makeStore(); const delivery = new Delivery(store, () => assert.fail());
  const server = createOperatorServer(config, store, delivery); await listen(server);
  try {
    assert.equal(server.address().address, '127.0.0.1');
    const url = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${url}/targets`)).status, 401);
    const headers = { authorization: `Bearer ${config.operatorToken}`, 'content-type': 'application/json' };
    assert.equal((await fetch(`${url}/targets`, { headers })).status, 200);
    assert.equal((await fetch(`${url}/targets`, { headers: { ...headers, origin: 'null' } })).status, 403);
    for (const body of [{ alias: 'alice', text: 'arbitrary' }, { alias: '../x' }, { alias: 'x'.repeat(2000) }]) {
      const response = await fetch(`${url}/preview`, { method: 'POST', headers, body: JSON.stringify(body) });
      assert.ok([400, 413].includes(response.status));
    }
  } finally { await close(server); }
});
test('authorized HTTP preview does not deliver and HTTP send needs exact explicit confirmation', async () => {
  const store = makeStore(); let sends = 0;
  store.register('alice', config.botClientId, { tenantId: config.tenantId, scope: 'personal', conversationId: 'synthetic-chat', serviceUrl: 'https://smba.trafficmanager.net/emea/' });
  const server = createOperatorServer(config, store, new Delivery(store, async () => { sends++; return { id: 'local-only-id' }; }));
  await listen(server);
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const headers = { authorization: `Bearer ${config.operatorToken}`, 'content-type': 'application/json' };
    const post = (route, body) => fetch(`${url}/${route}`, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal((await post('preview', { alias: 'alice' })).status, 200); assert.equal(sends, 0);
    assert.equal((await post('send', { alias: 'alice', confirm: false })).status, 400); assert.equal(sends, 0);
    assert.equal((await post('send', { alias: 'alice', confirm: true, text: 'arbitrary' })).status, 400); assert.equal(sends, 0);
    assert.equal((await post('send', { alias: 'alice', confirm: true })).status, 200); assert.equal(sends, 1);
  } finally { await close(server); }
});
test('actual SDK HTTP server rejects unsigned activities even with unsafe env enabled', async () => {
  const previous = process.env.DANGEROUSLY_ALLOW_UNAUTHENTICATED_REQUESTS;
  process.env.DANGEROUSLY_ALLOW_UNAUTHENTICATED_REQUESTS = 'true';
  const app = createTeamsApp(config, makeStore());
  try {
    await app.initialize();
    await app.server.start(0);
    const port = app.server.adapter.server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'message', text: 'REGISTER alice' })
    });
    assert.equal(response.status, 401);
    const forged = await fetch(`http://127.0.0.1:${port}/api/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer not-a-jwt' },
      body: JSON.stringify({ type: 'message', text: 'REGISTER alice' })
    });
    assert.equal(forged.status, 401);
  } finally {
    await app.stop();
    if (previous === undefined) delete process.env.DANGEROUSLY_ALLOW_UNAUTHENTICATED_REQUESTS;
    else process.env.DANGEROUSLY_ALLOW_UNAUTHENTICATED_REQUESTS = previous;
  }
});
test('outbound transport clones the SDK API with the saved regional URL', async () => {
  let options; let received;
  const app = { api: { clone(value) { options = value; return { conversations: { async createActivity(id, message) { received = { id, message }; return { id: 'sent-id' }; } } }; } } };
  await sdkTransport(app)({ serviceUrl: 'https://smba.trafficmanager.net/emea/', conversationId: 'registered-only' }, 'fixed');
  assert.deepEqual(options, { serviceUrl: 'https://smba.trafficmanager.net/emea/' });
  assert.equal(received.id, 'registered-only');
  assert.equal(received.message.text, 'fixed');
});
test('real SDK API clone routes a single outbound request to a local receiver', async () => {
  let requests = 0; let path;
  const receiver = createServer((request, response) => { requests++; path = request.url; request.resume(); response.setHeader('content-type', 'application/json'); response.end('{"id":"local-message"}'); });
  await listen(receiver);
  try {
    const app = { api: new ApiClient('https://default.invalid', new Client(), {}) };
    const result = await sdkTransport(app)({ serviceUrl: `http://127.0.0.1:${receiver.address().port}/regional`, conversationId: 'saved-chat' }, 'synthetic');
    assert.equal(result.id, 'local-message'); assert.equal(requests, 1); assert.ok(path.startsWith('/regional/v3/conversations/saved-chat/activities'));
  } finally { await close(receiver); }
});