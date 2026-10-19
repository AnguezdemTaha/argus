import { HttpMcpClient, safeSchema } from './mcp.js';
import { requireThat, SafeError } from './foundation.js';

const READ_TOOLS = new Set([
  'get_project', 'get_issue', 'get_work_item', 'get_merge_request', 'list_merge_requests', 'search'
]);

export function gitlabSettings(env = process.env) {
  const url = env.GITLAB_MCP_URL?.trim();
  const accessToken = env.GITLAB_MCP_ACCESS_TOKEN?.trim();
  if (!url && !accessToken) return undefined;
  requireThat(url && accessToken, 'GITLAB_MCP_URL_AND_ACCESS_TOKEN_REQUIRED');
  let endpoint;
  try { endpoint = new URL(url); } catch { throw new SafeError('GITLAB_MCP_INVALID_URL'); }
  requireThat(endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password &&
    !endpoint.search && !endpoint.hash && endpoint.pathname.endsWith('/api/v4/mcp'),
  'GITLAB_MCP_INVALID_URL');
  requireThat(/^[\x21-\x7e]+$/.test(accessToken), 'GITLAB_MCP_INVALID_TOKEN_FORMAT');
  return { endpoint: endpoint.href, accessToken };
}

export class GitLabMcpClient extends HttpMcpClient {
  constructor(settings, fetchImpl = fetch) {
    const validated = gitlabSettings({
      GITLAB_MCP_URL: settings.endpoint, GITLAB_MCP_ACCESS_TOKEN: settings.accessToken
    });
    requireThat(validated, 'GITLAB_MCP_URL_AND_ACCESS_TOKEN_REQUIRED');
    super({ endpoint: validated.endpoint, authorization: `Bearer ${validated.accessToken}`,
      prefix: 'GITLAB', fetchImpl });
  }

  async tools() {
    if (this.toolsCache && Date.now() - this.toolsCacheAt < 60000) return this.toolsCache;
    const tools = await this.listTools();
    const allowed = tools.filter(tool => READ_TOOLS.has(tool?.name)).map(tool => ({
      name: tool.name,
      description: typeof tool.description === 'string' ? tool.description.slice(0, 800) : '',
      inputSchema: safeSchema(tool.inputSchema)
    }));
    requireThat(allowed.length > 0, 'GITLAB_NO_READ_TOOLS', 503);
    this.toolsCache = allowed;
    this.toolsCacheAt = Date.now();
    return this.toolsCache;
  }
}
