import test from 'node:test';
import assert from 'node:assert/strict';
import { GitLabMcpClient, gitlabSettings } from '../src/gitlab.js';
import { ArgusAssistant } from '../src/ai.js';
import { checkGitLabMcp } from '../scripts/check-gitlab-mcp.js';

const settings = { endpoint: 'https://gitlab.example.com/api/v4/mcp', accessToken: 'synthetic-secret' };

function mcpReply(message, tools, result = 'Synthetic read result') {
  if (message.method === 'initialize') {
    return Response.json({ id: message.id, result: { protocolVersion: '2025-03-26' } });
  }
  if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
  if (message.method === 'tools/list') return Response.json({ id: message.id, result: { tools } });
  return Response.json({ id: message.id, result: { content: [{ type: 'text', text: result }] } });
}

test('GitLab is opt-in, validates HTTPS endpoint and token, and fails on partial configuration', () => {
  assert.equal(gitlabSettings({}), undefined);
  assert.deepEqual(gitlabSettings({
    GITLAB_MCP_URL: ` ${settings.endpoint} `, GITLAB_MCP_ACCESS_TOKEN: ' synthetic-secret '
  }), settings);
  for (const env of [
    { GITLAB_MCP_URL: settings.endpoint },
    { GITLAB_MCP_ACCESS_TOKEN: 'synthetic' },
    { GITLAB_MCP_URL: 'http://gitlab.example.com/api/v4/mcp', GITLAB_MCP_ACCESS_TOKEN: 'synthetic' },
    { GITLAB_MCP_URL: `${settings.endpoint}?token=private`, GITLAB_MCP_ACCESS_TOKEN: 'synthetic' },
    { GITLAB_MCP_URL: 'https://user:pass@gitlab.example.com/api/v4/mcp', GITLAB_MCP_ACCESS_TOKEN: 'synthetic' },
    { GITLAB_MCP_URL: settings.endpoint, GITLAB_MCP_ACCESS_TOKEN: 'bad token' }
  ]) assert.throws(() => gitlabSettings(env), /GITLAB_/);
});

test('GitLab exposes only explicit read tools and sends the token only to the configured endpoint', async () => {
  const names = ['get_project', 'get_work_item', 'get_merge_request', 'get_issue', 'search',
    'list_merge_requests', 'save_work_item', 'create_issue', 'save_merge_request',
    'create_commit', 'get_unknown_mutating_tool', 'execute', 'start_duo_session'];
  const client = new GitLabMcpClient(settings, async (url, options) => {
    assert.equal(url, settings.endpoint);
    assert.equal(options.headers.authorization, 'Bearer synthetic-secret');
    assert.equal(options.redirect, 'error');
    return mcpReply(JSON.parse(options.body), names.map(name => ({ name, inputSchema: { type: 'object' } })));
  });
  const tools = await client.tools();
  assert.deepEqual(tools.map(tool => tool.name), names.slice(0, 6));
  assert.equal(await client.callTool('get_project', { project_id: 'test/project' }, tools), 'Synthetic read result');
  await assert.rejects(client.callTool('create_issue', {}, tools), /GITLAB_TOOL_NOT_ALLOWED/);
  assert.strictEqual(await client.tools(), tools);
});

test('GitLab without permitted read tools fails on every attempt rather than caching success', async () => {
  const client = new GitLabMcpClient(settings, async (_url, options) =>
    mcpReply(JSON.parse(options.body), [{ name: 'create_issue' }]));
  for (let count = 0; count < 2; count++) await assert.rejects(client.tools(), /GITLAB_NO_READ_TOOLS/);
});

test('GitLab diagnostic lists read tools but does not claim live data was read', async () => {
  const output = [];
  await checkGitLabMcp({
    async initialize() {},
    async tools() { return [{ name: 'get_project' }]; }
  }, line => output.push(line));
  assert.ok(output.includes('GITLAB_TOOL: get_project'));
  assert.match(output.at(-1), /not yet tested/);
});

test('Gemini GitLab tools are namespaced and routed back with original names and call IDs', async () => {
  let generation = 0; let toolCalls = 0;
  const assistant = new ArgusAssistant({
    apiKey: 'synthetic', gitlab: settings,
    fetchImpl: async (url, options) => {
      const message = JSON.parse(options.body);
      if (String(url).includes('generativelanguage.googleapis.com')) {
        generation++;
        if (generation === 1) {
          assert.deepEqual(message.tools[0].functionDeclarations.map(tool => tool.name), ['gitlab_get_project']);
          return Response.json({ candidates: [{ content: { role: 'model', parts: [
            { functionCall: { name: 'gitlab_get_project', id: 'call-1', args: { project_id: 'test/project' } } }
          ] } }] });
        }
        assert.deepEqual(message.contents.at(-1).parts[0].functionResponse, {
          name: 'gitlab_get_project', id: 'call-1', response: { result: 'Verified project data' }
        });
        return Response.json({ candidates: [{ content: { parts: [{ text: 'Project found.' }] } }] });
      }
      if (message.method === 'tools/call') {
        toolCalls++;
        assert.equal(message.params.name, 'get_project');
        assert.deepEqual(message.params.arguments, { project_id: 'test/project' });
      }
      return mcpReply(message, [{ name: 'get_project', inputSchema: { type: 'object' } }], 'Verified project data');
    }
  });
  assert.equal(await assistant.reply([], 'Read test/project'), 'Project found.');
  assert.equal(toolCalls, 1);
});

test('a failed provider is disabled independently, preserving the other provider and parallel response shape', async () => {
  for (const failed of ['Jira', 'GitLab']) {
    let generations = 0;
    const assistant = new ArgusAssistant({
      apiKey: 'synthetic', gitlab: settings, atlassianAuthorization: 'Basic synthetic',
      fetchImpl: async (url, options) => {
        const message = JSON.parse(options.body);
        if (String(url).includes('generativelanguage.googleapis.com')) {
          generations++;
          if (generations === 1) {
            assert.equal(message.tools[0].functionDeclarations.length, 2);
            return Response.json({ candidates: [{ content: { role: 'model', parts: [
              { functionCall: { name: 'getJiraIssue', args: {} } },
              { functionCall: { name: 'gitlab_get_project', args: {} } }
            ] } }] });
          }
          const responses = message.contents.at(-1).parts;
          assert.equal(responses.length, 2);
          const failedIndex = failed === 'Jira' ? 0 : 1;
          assert.equal(responses[failedIndex].functionResponse.response.error,
            failed === 'Jira' ? 'ATLASSIAN_TOOL_FAILED' : 'GITLAB_TOOL_FAILED');
          assert.equal(responses[1 - failedIndex].functionResponse.response.result, 'Synthetic read result');
          assert.deepEqual(message.tools[0].functionDeclarations.map(tool => tool.name),
            failed === 'Jira' ? ['gitlab_get_project'] : ['getJiraIssue']);
          return Response.json({ candidates: [{ content: { parts: [{ text: 'Available provider answered.' }] } }] });
        }
        const jira = String(url).includes('mcp.atlassian.com');
        if (message.method === 'tools/call' && (jira === (failed === 'Jira'))) {
          return Response.json({ id: message.id, result: {
            isError: true, content: [{ type: 'text', text: 'private error data' }]
          } });
        }
        return mcpReply(message, [{ name: jira ? 'getJiraIssue' : 'get_project', inputSchema: { type: 'object' } }]);
      }
    });
    const answer = await assistant.reply([], 'Read Jira and GitLab');
    assert.match(answer, new RegExp(`${failed} indisponible`));
    assert.ok(answer.endsWith('Available provider answered.'));
    assert.ok(!answer.includes('private error data'));
  }
});

test('GitLab discovery failure allows Gemini chat and never forwards remote response bodies', async () => {
  const assistant = new ArgusAssistant({
    apiKey: 'synthetic', gitlab: settings,
    fetchImpl: async (url, options) => {
      if (!String(url).includes('generativelanguage.googleapis.com')) return new Response('secret', { status: 403 });
      const message = JSON.parse(options.body);
      assert.equal(message.tools, undefined);
      assert.match(message.systemInstruction.parts[0].text, /GitLab tools are not connected/);
      return Response.json({ candidates: [{ content: { parts: [{ text: 'Hello.' }] } }] });
    }
  });
  const answer = await assistant.reply([], 'Hello');
  assert.match(answer, /GitLab indisponible.*GITLAB_MCP_HTTP_403/);
  assert.ok(!answer.includes('secret'));
});

test('Gemini cannot call a GitLab write tool even when the server advertises it', async () => {
  const assistant = new ArgusAssistant({
    apiKey: 'synthetic', gitlab: settings,
    fetchImpl: async (url, options) => {
      if (String(url).includes('generativelanguage.googleapis.com')) {
        return Response.json({ candidates: [{ content: { role: 'model', parts: [
          { functionCall: { name: 'gitlab_create_issue', args: {} } }
        ] } }] });
      }
      const message = JSON.parse(options.body);
      assert.notEqual(message.method, 'tools/call');
      return mcpReply(message, ['get_project', 'create_issue'].map(name => ({ name, inputSchema: { type: 'object' } })));
    }
  });
  await assert.rejects(assistant.reply([], 'Create issue'), /GITLAB_TOOL_NOT_ALLOWED/);
});
