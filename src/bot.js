import { isId, requireThat, validateServiceUrl, SafeError } from './foundation.js';

export const SIMULATION = '[ARGUS \u2014 SIMULATION / donn\u00e9es fictives]\nConcernant DEMO-123 (ticket fictif), pouvez-vous confirmer la d\u00e9pendance r\u00e9seau fictive entre le service Alpha et le service B\u00eata ? Aucun Jira, MCP ou LLM n\u2019a \u00e9t\u00e9 contact\u00e9.';
export const REPLY = 'ARGUS : AI_HANDLER_NOT_CONFIGURED. Red\u00e9marrez le serveur IA avec npm.cmd start.';

export function authenticatedAddress(activity, config) {
  requireThat(activity.channelId === 'msteams', 'UNSUPPORTED_CHANNEL');
  const tenantId = activity.channelData?.tenant?.id;
  requireThat(isId(tenantId) && tenantId.toLowerCase() === config.tenantId.toLowerCase() &&
    (!activity.conversation?.tenantId || activity.conversation.tenantId.toLowerCase() === tenantId.toLowerCase()), 'WRONG_TENANT');
  requireThat(isId(activity.from?.aadObjectId), 'MISSING_USER_IDENTITY');
  const scope = activity.conversation?.conversationType;
  requireThat(['personal', 'groupChat'].includes(scope) && !activity.channelData?.team && !activity.channelData?.channel, 'UNSUPPORTED_SCOPE');
  requireThat(typeof activity.conversation.id === 'string' && activity.conversation.id.length > 0 && activity.conversation.id.length <= 2048, 'INVALID_CONVERSATION');
  return { tenantId: tenantId.toLowerCase(), scope, conversationId: activity.conversation.id, serviceUrl: validateServiceUrl(activity.serviceUrl) };
}
export function commandText(activity, scope) {
  let text = typeof activity.text === 'string' ? activity.text : '';
  requireThat(text.length <= 8192, 'MESSAGE_TOO_LARGE');
  if (scope === 'groupChat') {
    const mention = activity.entities?.find(entity => entity.type === 'mention' &&
      entity.mentioned?.id === activity.recipient?.id && typeof entity.text === 'string' &&
      /^<at>[^<]+<\/at>$/.test(entity.text) && text.includes(entity.text));
    if (!mention || !activity.recipient?.id) return null;
    text = text.replace(mention.text, '');
  }
  return text.trim();
}
export async function handleMessage(activity, config, store, send, assistant, memory) {
  try {
    const address = authenticatedAddress(activity, config);
    const text = commandText(activity, address.scope);
    if (text === null) return;
    if (/^STOP$/i.test(text)) {
      store.stop(address);
      memory?.clear(address);
      await send('ARGUS : ce chat est d\u00e9sinscrit. Un envoi d\u00e9j\u00e0 en cours peut encore aboutir.');
      return;
    }
    requireThat(config.allowedUserIds.includes(activity.from.aadObjectId.toLowerCase()), 'USER_NOT_ALLOWLISTED');
    const register = /^REGISTER ([a-z][a-z0-9_-]{0,31})$/.exec(text);
    if (register) {
      store.register(register[1], activity.from.aadObjectId.toLowerCase(), address);
      await send(`ARGUS : inscription confirm\u00e9e (${register[1]}).`);
    } else if (/^REGISTER\b/i.test(text)) {
      await send('ARGUS : commande attendue : REGISTER alias (minuscules, 1 \u00e0 32 caract\u00e8res).');
    } else if (/^(DECISION DONE|FORGET)$/i.test(text)) {
      memory?.clear(address);
      await send('ARGUS : contexte de cette conversation effac\u00e9.');
    } else {
      if (!assistant) {
        console.error('ARGUS: AI_HANDLER_NOT_CONFIGURED');
        await send(REPLY);
        return;
      }
      try {
        const history = memory?.history(address) ?? [];
        const response = await assistant.reply(history, text);
        memory?.append(address, text, response);
        await send(response);
      } catch (error) {
        if (!(error instanceof SafeError)) throw error;
        console.error(`ARGUS: ${error.code}`);
        await send(`ARGUS : ${error.code}. Je ne peux pas r\u00e9pondre maintenant. V\u00e9rifiez la configuration Gemini/Jira/GitLab.`);
      }
    }
  } catch (error) {
    if (!(error instanceof SafeError)) throw error;
  }
}