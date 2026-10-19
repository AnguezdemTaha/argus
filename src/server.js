import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, privateDirectory } from './config.js';
import { acquireLock, safeCode } from './foundation.js';
import { Store } from './store.js';
import { Delivery } from './delivery.js';
import { createOperatorServer } from './operator-api.js';
import { createTeamsApp, sdkTransport, startTeamsApp } from './sdk.js';
import { ArgusAssistant } from './ai.js';
import { ConversationMemory } from './memory.js';
import { gitlabSettings } from './gitlab.js';

export async function startServer(directory = privateDirectory) {
  const config = loadConfig(directory);
  const release = acquireLock(directory);
  let app; let operator;
  try {
    const store = new Store(join(directory, 'conversations.json'));
    const memory = new ConversationMemory(join(directory, 'conversation-memory.json'));
    const assistant = new ArgusAssistant({
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL || undefined,
      gitlab: gitlabSettings(),
      atlassianAuthorization: process.env.ATLASSIAN_MCP_AUTHORIZATION ||
        (process.env.ATLASSIAN_MCP_EMAIL && process.env.ATLASSIAN_API_TOKEN
          ? `Basic ${Buffer.from(`${process.env.ATLASSIAN_MCP_EMAIL}:${process.env.ATLASSIAN_API_TOKEN}`).toString('base64')}`
          : undefined)
    });
    app = createTeamsApp(config, store, assistant, memory);
    operator = createOperatorServer(config, store, new Delivery(store, sdkTransport(app)));
    await startTeamsApp(app, 3978);
    await new Promise((resolve, reject) => { operator.once('error', reject); operator.listen(3979, '127.0.0.1', resolve); });
    console.log('ARGUS: Teams POST /api/messages on port 3978; JWT validation ON.');
    console.log('ARGUS: operator API http://127.0.0.1:3979 (never tunnel this port).');
    const jiraConfigured = process.env.ATLASSIAN_MCP_AUTHORIZATION ||
      (process.env.ATLASSIAN_MCP_EMAIL && process.env.ATLASSIAN_API_TOKEN);
    console.log(`ARGUS: Gemini ${process.env.GEMINI_API_KEY ? 'configured' : 'not configured'}; Atlassian MCP ${jiraConfigured ? 'configured' : 'not configured'} (read-only tools only).`);
    console.log(`ARGUS: Gemini model ${assistant.model}; GitLab MCP ${assistant.gitlab ? 'configured' : 'not configured'} (read-only tools only).`);
    return async () => {
      await new Promise(resolve => operator.close(resolve));
      await app.stop(); release();
    };
  } catch (error) {
    if (operator?.listening) await new Promise(resolve => operator.close(resolve));
    try { await app?.stop(); } catch {}
    release(); throw error;
  }
}
export async function runServer(start = startServer) {
  let stop;
  let stopping = false;
  let requested = false;
  const shutdown = async () => {
    requested = true;
    if (!stop || stopping) return;
    stopping = true;
    console.log('ARGUS: shutting down; wait for SERVER_STOPPED before restarting.');
    try {
      await stop();
      console.log('ARGUS: SERVER_STOPPED');
      process.exit(0);
    } catch {
      console.error('ARGUS: SERVER_SHUTDOWN_FAILED');
      process.exit(1);
    }
  };
  const onMessage = message => {
    if (message?.type === 'argus:shutdown') void shutdown();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('message', onMessage);
  try {
    stop = await start();
    if (requested) await shutdown();
  } catch (error) {
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
    process.removeListener('message', onMessage);
    console.error(`ARGUS: ${safeCode(error)}`);
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runServer();
}