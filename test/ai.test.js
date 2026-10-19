import test from 'node:test';
import assert from 'node:assert/strict';
import { ArgusAssistant, AtlassianMcpClient } from '../src/ai.js';

test('Gemini can use only discovered read-only Atlassian MCP tools', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('generativelanguage.googleapis.com')) {
      const request = JSON.parse(options.body);
      if (!request.contents.some(item => item.parts?.some(part => part.functionResponse))) {
        assert.deepEqual(request.tools[0].functionDeclarations.map(tool => tool.name), ['searchIssues']);
        return Response.json({ candidates: [{ content: { role: 'model', parts: [
          { functionCall: { name: 'searchIssues', args: { query: 'ARG-7' } } }
        ] } }] });
      }
      return Response.json({ candidates: [{ content: { role: 'model', parts: [{ text: 'ARG-7 is In Progress.' }] } }] });
    }

    const message = JSON.parse(options.body);
    if (message.method === 'initialize') {
      return Response.json({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-03-26' } },
        { headers: { 'mcp-session-id': 'synthetic-session' } });
    }
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (message.method === 'tools/list') {
      return Response.json({ jsonrpc: '2.0', id: message.id, result: { tools: [
        { name: 'searchIssues', description: 'Read Jira issues', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
        { name: 'createIssue', description: 'Create Jira issue', inputSchema: { type: 'object' } }
      ] } });
    }
    assert.equal(message.method, 'tools/call');
    assert.equal(message.params.name, 'searchIssues');
    assert.equal(options.headers.authorization, 'Basic synthetic');
    return Response.json({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'Issue ARG-7 is In Progress.' }] } });
  };
  const assistant = new ArgusAssistant({
    apiKey: 'synthetic-gemini-key',
    atlassianAuthorization: 'Basic synthetic',
    fetchImpl
  });

  assert.equal(await assistant.reply([], 'What is ARG-7 status?'), 'ARG-7 is In Progress.');
  assert.equal(calls.filter(call => String(call.url).includes('generativelanguage.googleapis.com')).length, 2);
  assert.equal(calls.some(call => JSON.parse(call.options.body).params?.name === 'createIssue'), false);
});

test('Gemini-only assistant answers without contacting Atlassian', async () => {
  let called = false;
  const assistant = new ArgusAssistant({
    apiKey: 'synthetic-gemini-key',
    fetchImpl: async (_url, options) => {
      called = true;
      assert.equal(options.headers['x-goog-api-key'], 'synthetic-gemini-key');
      return Response.json({ candidates: [{ content: { parts: [{ text: 'Hello.' }] } }] });
    }
  });

  assert.equal(await assistant.reply([], 'Hello'), 'Hello.');
  assert.equal(called, true);
});

test('Gemini uses the inexpensive default model and preserves explicit overrides', async () => {
  for (const model of [undefined, 'synthetic-model-override']) {
    const assistant = new ArgusAssistant({
      apiKey: 'synthetic',
      model,
      fetchImpl: async url => {
        assert.equal(String(url),
          `https://generativelanguage.googleapis.com/v1beta/models/${model ?? 'gemini-2.5-flash-lite'}:generateContent`);
        return Response.json({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] });
      }
    });
    assert.equal(await assistant.reply([], 'Hello'), 'OK');
  }
});

test('Gemini discovers the Jira site before reading an issue with its cloudId', async () => {
  const invoked = [];
  let generations = 0;
  const assistant = new ArgusAssistant({
    apiKey: 'synthetic',
    atlassianAuthorization: 'Basic synthetic',
    fetchImpl: async (url, options) => {
      const request = JSON.parse(options.body);
      if (String(url).includes('generativelanguage.googleapis.com')) {
        assert.match(request.systemInstruction.parts[0].text, /Never invent a cloudId/);
        assert.deepEqual(request.tools[0].functionDeclarations.map(tool => tool.name),
          ['getAccessibleAtlassianResources', 'getJiraIssue']);
        generations++;
        if (generations === 1) {
          return Response.json({ candidates: [{ content: { role: 'model', parts: [
            { functionCall: { name: 'getAccessibleAtlassianResources', args: {} } }
          ] } }] });
        }
        const response = request.contents.at(-1).parts[0].functionResponse;
        if (generations === 2) {
          assert.equal(response.name, 'getAccessibleAtlassianResources');
          assert.match(response.response.result, /synthetic-cloud/);
          return Response.json({ candidates: [{ content: { role: 'model', parts: [
            { functionCall: { name: 'getJiraIssue', args: {
              cloudId: 'synthetic-cloud', issueIdOrKey: 'ARG-7'
            } } }
          ] } }] });
        }
        assert.equal(response.name, 'getJiraIssue');
        assert.match(response.response.result, /In Progress/);
        return Response.json({ candidates: [{ content: { parts: [{ text: 'ARG-7 is In Progress.' }] } }] });
      }
      if (request.method === 'initialize') {
        return Response.json({ id: request.id, result: { protocolVersion: '2025-03-26' } });
      }
      if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
      if (request.method === 'tools/list') {
        return Response.json({ id: request.id, result: { tools: [
          { name: 'getJiraIssue', inputSchema: { type: 'object', properties: {
            cloudId: { type: 'string' }, issueIdOrKey: { type: 'string' }
          }, required: ['cloudId', 'issueIdOrKey'] } },
          { name: 'getAccessibleAtlassianResources', description: 'List accessible sites',
            inputSchema: { type: 'object' } },
          { name: 'updateJiraIssue', inputSchema: { type: 'object' } }
        ] } });
      }
      assert.equal(request.method, 'tools/call');
      invoked.push(request.params.name);
      if (request.params.name === 'getAccessibleAtlassianResources') {
        return Response.json({ id: request.id, result: { content: [{ type: 'text',
          text: '[{"id":"synthetic-cloud","url":"https://example.atlassian.net"}]' }] } });
      }
      assert.deepEqual(request.params.arguments, { cloudId: 'synthetic-cloud', issueIdOrKey: 'ARG-7' });
      return Response.json({ id: request.id, result: { content: [{ type: 'text', text: 'In Progress' }] } });
    }
  });
  assert.equal(await assistant.reply([], 'Read ARG-7 at https://example.atlassian.net'), 'ARG-7 is In Progress.');
  assert.deepEqual(invoked, ['getAccessibleAtlassianResources', 'getJiraIssue']);
  assert.equal(generations, 3);
});

test('MCP discovery follows pagination, prioritizes site discovery and caches the result', async () => {
  const client = new AtlassianMcpClient('Basic synthetic');
  const requests = [];
  client.request = async (method, params) => {
    requests.push({ method, params });
    if (!params.cursor) {
      return { tools: Array.from({ length: 25 }, (_, index) => ({
        name: `getJiraIssue${index}`, inputSchema: { type: 'object' }
      })), nextCursor: 'next-page' };
    }
    assert.equal(params.cursor, 'next-page');
    return { tools: [
      { name: 'getAccessibleAtlassianResources', description: 'List accessible sites' },
      { name: 'deleteAccessibleAtlassianResources' },
      { name: 'executeWrite', description: 'Write Jira issues' }
    ] };
  };
  const tools = await client.tools();
  assert.equal(tools.length, 25);
  assert.equal(tools[0].name, 'getAccessibleAtlassianResources');
  assert.ok(!tools.some(tool => /delete|write/i.test(tool.name)));
  assert.strictEqual(await client.tools(), tools);
  assert.deepEqual(requests, [
    { method: 'tools/list', params: {} },
    { method: 'tools/list', params: { cursor: 'next-page' } }
  ]);
});

test('MCP discovery rejects malformed and cyclic pagination instead of caching partial tools', async () => {
  for (const nextCursor of ['', 42, 'repeated']) {
    const client = new AtlassianMcpClient('Basic synthetic');
    client.request = async () => ({ tools: [], nextCursor });
    await assert.rejects(client.tools(), /ATLASSIAN_MCP_INVALID_PAGINATION/);
    assert.equal(client.toolsCache, null);
  }
});

test('MCP HTTP failures expose only status, not credentials or remote error bodies', async () => {
  for (const status of [400, 401, 403, 404, 429, 500]) {
    const client = new AtlassianMcpClient('Basic synthetic-secret', async () =>
      new Response('sensitive remote response', { status }));
    await assert.rejects(client.tools(), error => {
      assert.equal(error.code, `ATLASSIAN_MCP_HTTP_${status}`);
      assert.ok(!error.message.includes('synthetic-secret'));
      assert.ok(!error.message.includes('sensitive'));
      return true;
    });
  }
});

test('MCP protocol errors expose only their numeric code', async () => {
  const client = new AtlassianMcpClient('Basic synthetic-secret', async (_url, options) => {
    const { id } = JSON.parse(options.body);
    return Response.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'sensitive details' } });
  });
  await assert.rejects(client.tools(), error => {
    assert.equal(error.code, 'ATLASSIAN_MCP_RPC_-32602');
    assert.ok(!error.message.includes('sensitive'));
    return true;
  });
});

test('MCP empty and mismatched responses fail explicitly', async () => {
  for (const response of [new Response(''), Response.json({ jsonrpc: '2.0', id: 999, result: {} })]) {
    const client = new AtlassianMcpClient('Basic synthetic', async () => response);
    await assert.rejects(client.tools(), /ATLASSIAN_MCP_INVALID_RESPONSE/);
  }
});

test('MCP authentication and network failures allow Gemini chat with an explicit warning and history', async () => {
  for (const networkFailure of [false, true]) {
    let geminiCalls = 0;
    const assistant = new ArgusAssistant({
      apiKey: 'synthetic',
      atlassianAuthorization: 'Basic synthetic',
      fetchImpl: async (url, options) => {
        if (!String(url).includes('generativelanguage.googleapis.com')) {
          if (networkFailure) throw new Error('sensitive network details');
          return new Response('sensitive auth details', { status: 401 });
        }
        geminiCalls++;
        const request = JSON.parse(options.body);
        assert.equal(request.tools, undefined);
        assert.match(request.systemInstruction.parts[0].text, /Jira tools are not connected/);
        assert.equal(request.contents[0].parts[0].text, 'We chose Blue.');
        return Response.json({ candidates: [{ content: { parts: [{ text: 'We chose Blue.' }] } }] });
      }
    });
    const answer = await assistant.reply([{ role: 'user', text: 'We chose Blue.' }], 'What did we choose?');
    assert.match(answer, /Jira indisponible/);
    assert.match(answer, networkFailure ? /ATLASSIAN_MCP_UNAVAILABLE/ : /ATLASSIAN_MCP_HTTP_401/);
    assert.ok(answer.endsWith('We chose Blue.'));
    assert.ok(!answer.includes('sensitive'));
    assert.equal(geminiCalls, 1);
  }
});

test('failed Jira read reaches Gemini as an error and disables further tools', async () => {
  let generations = 0;
  const assistant = new ArgusAssistant({
    apiKey: 'synthetic',
    atlassianAuthorization: 'Basic synthetic',
    fetchImpl: async (url, options) => {
      if (String(url).includes('generativelanguage.googleapis.com')) {
        const request = JSON.parse(options.body);
        generations++;
        if (generations === 1) {
          return Response.json({ candidates: [{ content: { role: 'model', parts: [
            { functionCall: { name: 'searchIssues', args: {} } }
          ] } }] });
        }
        assert.equal(request.tools, undefined);
        const response = request.contents.at(-1).parts[0].functionResponse.response;
        assert.equal(response.error, 'ATLASSIAN_MCP_HTTP_403');
        assert.equal(response.result, undefined);
        return Response.json({ candidates: [{ content: { parts: [{ text: 'I cannot access Jira, but I can help plan.' }] } }] });
      }
      const message = JSON.parse(options.body);
      if (message.method === 'initialize') {
        return Response.json({ id: message.id, result: { protocolVersion: '2025-03-26' } });
      }
      if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
      if (message.method === 'tools/list') {
        return Response.json({ id: message.id, result: { tools: [
          { name: 'searchIssues', inputSchema: { type: 'object' } }
        ] } });
      }
      return new Response('sensitive', { status: 403 });
    }
  });
  assert.match(await assistant.reply([], 'Look up Jira'), /Jira indisponible.*ATLASSIAN_MCP_HTTP_403/);
  assert.equal(generations, 2);
});

test('Gemini failure is not hidden when MCP also fails', async () => {
  const assistant = new ArgusAssistant({
    apiKey: 'synthetic',
    atlassianAuthorization: 'Basic synthetic',
    fetchImpl: async url => new Response('', {
      status: String(url).includes('generativelanguage.googleapis.com') ? 400 : 401
    })
  });
  await assert.rejects(assistant.reply([], 'Hello'), /GEMINI_HTTP_400/);
});

test('Gemini transport errors report safe categories without raw exception details', async () => {
  for (const [error, expected] of [
    [new DOMException('private', 'TimeoutError'), 'GEMINI_TIMEOUT'],
    [new TypeError('private', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }), 'GEMINI_CONNECT_TIMEOUT'],
    [new TypeError('private', { cause: { code: 'ENOTFOUND' } }), 'GEMINI_DNS_FAILED'],
    [new TypeError('private', { cause: { code: 'SELF_SIGNED_CERT_IN_CHAIN' } }), 'GEMINI_TLS_FAILED'],
    [new TypeError('private', { cause: { code: 'ECONNRESET' } }), 'GEMINI_CONNECTION_FAILED'],
    [new TypeError('private'), 'GEMINI_UNAVAILABLE']
  ]) {
    const assistant = new ArgusAssistant({
      apiKey: 'synthetic', fetchImpl: async () => { throw error; }
    });
    await assert.rejects(assistant.reply([], 'Hello'), failure => {
      assert.equal(failure.code, expected);
      assert.ok(!failure.message.includes('private'));
      return true;
    });
  }
});

test('Gemini rejects malformed keys before fetching and trims surrounding whitespace', async () => {
  for (const apiKey of ['key with spaces', 'key\nvalue', 'key\u00e9']) {
    const assistant = new ArgusAssistant({
      apiKey, fetchImpl: async () => assert.fail('must not send malformed credentials')
    });
    await assert.rejects(assistant.reply([], 'Hello'), /GEMINI_INVALID_KEY_FORMAT/);
  }
  const assistant = new ArgusAssistant({
    apiKey: ' synthetic \r\n',
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers['x-goog-api-key'], 'synthetic');
      return Response.json({ candidates: [{ content: { parts: [{ text: 'Hello.' }] } }] });
    }
  });
  assert.equal(await assistant.reply([], 'Hello'), 'Hello.');
});
