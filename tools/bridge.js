import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const load = path => import(pathToFileURL(join(import.meta.dirname, 'node_modules/@microsoft/teams.cli/dist', path)).href);
try {
  if (process.platform !== 'win32') throw new Error('Native Windows setup required');
  const { logger } = await load('utils/logger.js');
  for (const level of ['debug', 'info', 'warn', 'error']) logger[level] = () => {};
  const { PersistenceCreator } = await import('@azure/msal-node-extensions');
  const { paths } = await load('auth/config.js');
  mkdirSync(paths.config, { recursive: true, mode: 0o700 });
  await PersistenceCreator.createPersistence({ cachePath: join(paths.config, 'argus-storage-check'), dataProtectionScope: 'CurrentUser',
    serviceName: 'teams-cli', accountName: 'argus-check', usePlaintextFileOnLinux: false });
  const [command, appId] = process.argv.slice(2);
  if (command === 'storage') console.log('{"secureStorage":true}');
  else {
    const auth = await load('auth/index.js');
    const account = await auth.getAccount();
    if (!account) throw new Error('login');
    if (command === 'consent') {
      const { getMsalClient } = await load('auth/client.js');
      const { openInBrowser } = await load('utils/browser.js');
      const client = await getMsalClient();
      for (const scopes of [auth.graphScopes, auth.teamsDevPortalScopes]) {
        const result = await client.acquireTokenInteractive({ scopes, account,
          authority: `https://login.microsoftonline.com/${account.tenantId}`, prompt: 'consent', responseMode: 'form_post',
          openBrowser: openInBrowser, successTemplate: '<html><body>ARGUS consent completed. Return to your terminal.</body></html>',
          errorTemplate: '<html><body>Consent failed. Contact your tenant administrator.</body></html>' });
        if (result?.account?.tenantId !== account.tenantId || result.account.localAccountId !== account.localAccountId) throw new Error('identity');
      }
      console.log('ARGUS: consent flow completed; run setup preflight to verify access.');
    } else {
      const graphToken = await auth.getTokenSilent(auth.graphScopes);
      const portalToken = await auth.getTokenSilent(auth.teamsDevPortalScopes);
      if (command === 'access') {
        let graphReadable = false;
        if (graphToken) {
          const response = await fetch('https://graph.microsoft.com/v1.0/applications?$top=1&$select=id', {
            headers: { authorization: `Bearer ${graphToken}` }, signal: AbortSignal.timeout(15000), redirect: 'error'
          });
          graphReadable = response.ok;
        }
        console.log(JSON.stringify({ graphConsent: !!graphToken, portalConsent: !!portalToken, graphReadable }));
      } else if (command === 'inspect') {
        if (!graphToken || !portalToken || !/^[a-f0-9-]{36}$/i.test(appId ?? '')) throw new Error('access');
        const api = await load('apps/index.js');
        const details = await api.fetchAppDetailsV2(portalToken, appId);
        if (details.bots?.length !== 1) throw new Error('bots');
        const botId = details.bots[0].botId;
        const bot = await api.fetchBot(portalToken, botId);
        const app = await api.getAadAppByClientId(graphToken, botId);
        console.log(JSON.stringify({ managementAppId: details.teamsAppId, manifestId: details.appId,
          aadAppClientId: app.appId, botResourceId: bot.botId,
          botClientId: botId, tenantId: account.tenantId, humanUserObjectId: account.localAccountId,
          signInAudience: app.signInAudience, botSingleTenant: bot.isSingleTenant,
          endpoint: bot.messagingEndpoint, scopes: details.bots[0].scopes, version: details.version,
          secretExpiries: (app.passwordCredentials ?? []).map(item => item.endDateTime) }));
      } else throw new Error('command');
    }
  }
} catch { console.error('ARGUS: secure storage, login, consent or registration verification failed. See docs/BEGINNER.md. No credentials printed.'); process.exitCode = 1; }