import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAtlassianMcp } from '../scripts/check-atlassian-mcp.js';
import { SafeError } from '../src/foundation.js';

test('MCP diagnostic runs site discovery without printing its data or reading issues', async () => {
  const output = [];
  const tools = [{ name: 'getAccessibleAtlassianResources' }, { name: 'getJiraIssue' }];
  const calls = [];
  await checkAtlassianMcp({
    async initialize() { calls.push('initialize'); },
    async tools() { calls.push('tools'); return tools; },
    async callTool(name, args, allowed) {
      calls.push(name);
      assert.deepEqual(args, {});
      assert.strictEqual(allowed, tools);
      return 'private-site-data';
    }
  }, line => output.push(line));
  assert.deepEqual(calls, ['initialize', 'tools', 'getAccessibleAtlassianResources']);
  assert.ok(output.includes('MCP_TOOL_getJiraIssue: PRESENT'));
  assert.match(output.at(-1), /issue access not yet verified/);
  assert.ok(!output.join('\n').includes('private-site-data'));
});

test('MCP diagnostic reports missing site discovery and never calls an unavailable tool', async () => {
  const output = [];
  await assert.rejects(checkAtlassianMcp({
    async initialize() {},
    async tools() { return []; },
    async callTool() { assert.fail('must not call an unavailable tool'); }
  }, line => output.push(line)), /ATLASSIAN_RESOURCE_DISCOVERY_MISSING/);
  assert.ok(output.includes('MCP_TOOL_getAccessibleAtlassianResources: MISSING'));
});

test('MCP diagnostic preserves the failing stage without claiming success', async () => {
  const output = [];
  await assert.rejects(checkAtlassianMcp({
    async initialize() {},
    async tools() { return [{ name: 'getAccessibleAtlassianResources' }]; },
    async callTool() { throw new SafeError('ATLASSIAN_TOOL_FAILED'); }
  }, line => output.push(line)), /ATLASSIAN_TOOL_FAILED/);
  assert.equal(output.at(-1), 'MCP_STAGE: SITE_DISCOVERY');
});
