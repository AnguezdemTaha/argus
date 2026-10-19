import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpMcpClient } from '../src/mcp.js';

const clientWith = fetchImpl => new HttpMcpClient({
  endpoint: 'https://mcp.example.com/api/v4/mcp', authorization: 'Bearer synthetic',
  prefix: 'GITLAB', fetchImpl
});

test('MCP SSE handles multiline chunked events and returns without waiting for stream closure', async () => {
  let cancelled = false;
  const encoder = new TextEncoder();
  const client = clientWith(async () => new Response(new ReadableStream({
    start(controller) {
      for (const chunk of [
        ': heartbeat\r\n\r\n',
        'data: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\n',
        'data: {"id":7,\r',
        '\ndata: "result":{"ok":true}}\r\n\r\n'
      ]) controller.enqueue(encoder.encode(chunk));
    },
    cancel() { cancelled = true; }
  }), { headers: { 'content-type': 'text/event-stream' } }));
  assert.deepEqual(await client.post({ id: 7, method: 'synthetic' }), { ok: true });
  assert.equal(cancelled, true);
});

test('MCP notification accepts empty success and initialization forwards protocol and session headers', async () => {
  const requests = [];
  const client = clientWith(async (_url, options) => {
    const message = JSON.parse(options.body);
    requests.push({ message, headers: options.headers });
    assert.equal(options.redirect, 'error');
    if (message.method === 'initialize') {
      return Response.json({ id: message.id, result: { protocolVersion: '2025-06-18' } },
        { headers: { 'mcp-session-id': 'synthetic-session' } });
    }
    if (message.method === 'notifications/initialized') return new Response(null, { status: 204 });
    return Response.json({ id: message.id, result: { tools: [] } });
  });
  await Promise.all([client.initialize(), client.initialize()]);
  await client.listTools();
  assert.equal(requests.filter(item => item.message.method === 'initialize').length, 1);
  for (const request of requests.slice(1)) {
    assert.equal(request.headers['mcp-protocol-version'], '2025-06-18');
    assert.equal(request.headers['mcp-session-id'], 'synthetic-session');
  }
});

test('MCP refuses oversized bodies and malformed or mismatched SSE', async () => {
  for (const [response, code] of [
    [new Response('x'.repeat(1024 * 1024 + 1)), 'GITLAB_MCP_RESPONSE_TOO_LARGE'],
    [new Response('data: not-json\n\n', { headers: { 'content-type': 'text/event-stream' } }),
      'GITLAB_MCP_INVALID_RESPONSE'],
    [new Response('data: {"id":99,"result":{}}\n\n', { headers: { 'content-type': 'text/event-stream' } }),
      'GITLAB_MCP_INVALID_RESPONSE']
  ]) {
    const client = clientWith(async () => response);
    await assert.rejects(client.post({ id: 1, method: 'synthetic' }), error => error.code === code);
  }
});

test('MCP preserves provider-specific safe error codes and denies undiscovered tool calls', async () => {
  const client = clientWith(async () => new Response('private-data', { status: 403 }));
  await assert.rejects(client.listTools(), error => error.code === 'GITLAB_MCP_HTTP_403');
  await assert.rejects(client.callTool('save_merge_request', {}, []), /GITLAB_TOOL_NOT_ALLOWED/);
});
