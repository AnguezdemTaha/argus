import { App } from '@microsoft/teams.apps';
import { handleMessage } from './bot.js';
import { requireThat } from './foundation.js';

export const quietLogger = {
  debug() {}, info() {}, warn() {}, error() {}, log() {},
  child() { return this; }
};
export function createTeamsApp(config, store, assistant, memory) {
  const app = new App({
    clientId: config.botClientId, clientSecret: config.botClientSecret, tenantId: config.tenantId,
    dangerouslyAllowUnauthenticatedRequests: false,
    messagingEndpoint: '/api/messages',
    activity: { mentions: { stripText: false } },
    telemetry: { agent365: false }, state: false,
    logger: quietLogger,
    client: { timeout: 12000, logger: quietLogger }
  });
  app.on('message', async ({ activity, send }) => handleMessage(activity, config, store, send, assistant, memory));
  app.event('error', () => { console.error('ARGUS: SDK_OPERATION_FAILED (details suppressed).'); });
  return app;
}
export function sdkTransport(app) {
  return async (address, text) => {
    const api = app.api.clone({ serviceUrl: address.serviceUrl });
    return api.conversations.createActivity(address.conversationId, { type: 'message', text, textFormat: 'plain' });
  };
}

export async function startTeamsApp(app, port) {
  await app.start(port);
  requireThat(app.server.adapter.server?.listening === true, 'TEAMS_WEBHOOK_START_FAILED', 503);
}