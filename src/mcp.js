import { SafeError, requireThat } from './foundation.js';

const MAX_RESPONSE_BYTES = 1024 * 1024;

export function safeSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return { type: 'OBJECT' };
  const result = {};
  for (const key of ['type', 'description', 'properties', 'required', 'items', 'enum']) {
    if (!Object.hasOwn(schema, key)) continue;
    if (key === 'properties' && schema.properties && typeof schema.properties === 'object') {
      result.properties = Object.fromEntries(Object.entries(schema.properties)
        .map(([name, value]) => [name, safeSchema(value)]));
    } else if (key === 'items') {
      result.items = safeSchema(schema.items);
    } else if (key === 'type' && typeof schema.type === 'string') {
      result.type = schema.type.toUpperCase();
    } else if (key === 'required' && Array.isArray(schema.required)) {
      result.required = schema.required.filter(value => typeof value === 'string');
    } else if (key === 'enum' && Array.isArray(schema.enum)) {
      result.enum = schema.enum.filter(value => ['string', 'number', 'boolean'].includes(typeof value));
    } else if (key === 'description' && typeof schema.description === 'string') {
      result.description = schema.description.slice(0, 500);
    }
  }
  return result;
}

export class HttpMcpClient {
  constructor({ endpoint, authorization, prefix, fetchImpl = fetch }) {
    this.endpoint = endpoint;
    this.authorization = authorization;
    this.prefix = prefix;
    this.fetch = fetchImpl;
    this.sessionId = null;
    this.protocolVersion = null;
    this.requestId = 0;
    this.initialized = false;
    this.initializing = null;
    this.toolsCache = null;
    this.toolsCacheAt = 0;
  }

  failure(suffix) { return new SafeError(`${this.prefix}_${suffix}`, 503); }

  async readResponse(response, id) {
    if (!response.ok) {
      await response.body?.cancel();
      throw this.failure(`MCP_HTTP_${response.status}`);
    }
    if (id === undefined) {
      await response.body?.cancel();
      return null;
    }
    const sse = response.headers.get('content-type')?.includes('text/event-stream');
    const reader = response.body?.getReader();
    requireThat(reader, `${this.prefix}_MCP_INVALID_RESPONSE`, 503);
    const decoder = new TextDecoder();
    let text = ''; let bytes = 0;
    const parse = value => {
      let message;
      try { message = JSON.parse(value); } catch { throw this.failure('MCP_INVALID_RESPONSE'); }
      return message;
    };
    const result = message => {
      if (message?.error) {
        const code = Number.isSafeInteger(message.error.code) ? message.error.code : 'UNKNOWN';
        throw this.failure(`MCP_RPC_${code}`);
      }
      requireThat(message && Object.hasOwn(message, 'result'), `${this.prefix}_MCP_INVALID_RESPONSE`, 503);
      return message.result;
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        bytes += value?.byteLength ?? 0;
        requireThat(bytes <= MAX_RESPONSE_BYTES, `${this.prefix}_MCP_RESPONSE_TOO_LARGE`, 503);
        text += decoder.decode(value, { stream: !done });
        if (sse) {
          text = text.replace(/\r\n/g, '\n');
          let end;
          while ((end = text.indexOf('\n\n')) !== -1) {
            const event = text.slice(0, end);
            text = text.slice(end + 2);
            const data = event.split('\n').filter(line => line.startsWith('data:'))
              .map(line => line.slice(5).replace(/^ /, '')).join('\n');
            if (data) {
              const message = parse(data);
              if (message?.id === id) return result(message);
            }
          }
        }
        if (done) break;
      }
      requireThat(!sse && text.length > 0, `${this.prefix}_MCP_INVALID_RESPONSE`, 503);
      const message = parse(text);
      requireThat(message?.id === id, `${this.prefix}_MCP_INVALID_RESPONSE`, 503);
      return result(message);
    } catch (error) {
      if (error instanceof SafeError) throw error;
      throw this.failure('MCP_INVALID_RESPONSE');
    } finally {
      try { await reader.cancel(); }
      catch { console.error(`ARGUS: ${this.prefix}_MCP_STREAM_CLOSE_FAILED`); }
      reader.releaseLock();
    }
  }

  async post(message) {
    const headers = {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      authorization: this.authorization
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    if (this.protocolVersion) headers['mcp-protocol-version'] = this.protocolVersion;
    let response;
    try {
      response = await this.fetch(this.endpoint, {
        method: 'POST', headers, body: JSON.stringify(message), redirect: 'error',
        signal: AbortSignal.timeout(15000)
      });
    } catch {
      throw this.failure('MCP_UNAVAILABLE');
    }
    const session = response.headers.get('mcp-session-id');
    if (session) this.sessionId = session;
    return this.readResponse(response, message.id);
  }

  async initialize() {
    if (this.initialized) return;
    if (!this.initializing) {
      this.initializing = (async () => {
        const initialized = await this.post({
          jsonrpc: '2.0', id: ++this.requestId, method: 'initialize',
          params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'argus', version: '1.0.0' } }
        });
        requireThat(typeof initialized?.protocolVersion === 'string', `${this.prefix}_MCP_INVALID_RESPONSE`, 503);
        this.protocolVersion = initialized.protocolVersion;
        await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' });
        this.initialized = true;
      })();
    }
    try { await this.initializing; } finally { this.initializing = null; }
  }

  async request(method, params) {
    await this.initialize();
    return this.post({ jsonrpc: '2.0', id: ++this.requestId, method, params });
  }

  async listTools() {
    const tools = []; const cursors = new Set();
    let cursor;
    for (let page = 0; page < 20; page++) {
      const result = await this.request('tools/list', cursor ? { cursor } : {});
      requireThat(Array.isArray(result?.tools), `${this.prefix}_MCP_INVALID_RESPONSE`, 503);
      requireThat(result.tools.every(tool => tool && typeof tool.name === 'string'),
        `${this.prefix}_MCP_INVALID_RESPONSE`, 503);
      tools.push(...result.tools);
      if (result.nextCursor === undefined) return tools;
      requireThat(typeof result.nextCursor === 'string' && result.nextCursor.length > 0 &&
        !cursors.has(result.nextCursor) && page < 19, `${this.prefix}_MCP_INVALID_PAGINATION`, 503);
      cursor = result.nextCursor;
      cursors.add(cursor);
    }
  }

  async callTool(name, args, tools) {
    requireThat(tools.some(tool => tool.name === name), `${this.prefix}_TOOL_NOT_ALLOWED`, 403);
    const result = await this.request('tools/call', { name, arguments: args });
    if (result?.isError) throw this.failure('TOOL_FAILED');
    const texts = Array.isArray(result?.content)
      ? result.content.filter(item => item.type === 'text' && typeof item.text === 'string').map(item => item.text)
      : [];
    return (texts.join('\n') || JSON.stringify(result?.structuredContent ?? result ?? {})).slice(0, 10000);
  }
}
