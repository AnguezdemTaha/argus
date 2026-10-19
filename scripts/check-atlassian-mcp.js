import { pathToFileURL } from 'node:url';
import { AtlassianMcpClient } from '../src/ai.js';
import { requireThat, safeCode } from '../src/foundation.js';

export async function checkAtlassianMcp(client, log = console.log) {
  log('MCP_STAGE: INITIALIZE');
  await client.initialize();
  log('MCP_INITIALIZE: OK');

  log('MCP_STAGE: TOOLS_LIST');
  const tools = await client.tools();
  log(`MCP_ARGUS_TOOL_COUNT: ${tools.length}`);
  for (const name of ['getAccessibleAtlassianResources', 'getJiraIssue']) {
    log(`MCP_TOOL_${name}: ${tools.some(tool => tool.name === name) ? 'PRESENT' : 'MISSING'}`);
  }
  requireThat(tools.some(tool => tool.name === 'getAccessibleAtlassianResources'),
    'ATLASSIAN_RESOURCE_DISCOVERY_MISSING', 503);

  log('MCP_STAGE: SITE_DISCOVERY');
  await client.callTool('getAccessibleAtlassianResources', {}, tools);
  log('MCP_SITE_DISCOVERY: OK (result omitted for privacy; issue access not yet verified)');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const email = process.env.ATLASSIAN_MCP_EMAIL?.trim();
    const token = process.env.ATLASSIAN_API_TOKEN?.trim();
    const override = process.env.ATLASSIAN_MCP_AUTHORIZATION;
    requireThat(override || (email && token), 'ATLASSIAN_CREDENTIALS_NOT_CONFIGURED');
    const authorization = override || `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
    console.log(`MCP_AUTH_MODE: ${override ? 'AUTHORIZATION_OVERRIDE' : 'PERSONAL_TOKEN_BASIC'}`);
    await checkAtlassianMcp(new AtlassianMcpClient(authorization));
  } catch (error) {
    console.error(`MCP_FAIL: ${safeCode(error)}`);
    process.exitCode = 1;
  }
}
