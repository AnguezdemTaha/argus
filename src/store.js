import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { atomicJson, readJson, requireThat, isAlias, isId, validateServiceUrl, SafeError } from './foundation.js';

export const chatKey = address => createHash('sha256').update(JSON.stringify([address.tenantId, address.scope, address.conversationId])).digest('hex');
const empty = () => ({ version: 1, targets: {}, chats: {} });
function validate(state) {
  requireThat(state?.version === 1 && state.targets && state.chats && !Array.isArray(state.targets) && !Array.isArray(state.chats), 'CORRUPT_STATE');
  for (const [key, chat] of Object.entries(state.chats)) {
    requireThat(chat && chatKey(chat.address) === key && isId(chat.address.tenantId) &&
      ['personal', 'groupChat'].includes(chat.address.scope) && typeof chat.address.conversationId === 'string' &&
      chat.address.conversationId.length > 0 && typeof chat.active === 'boolean', 'CORRUPT_STATE');
    validateServiceUrl(chat.address.serviceUrl);
    requireThat(chat.last === null || (['sending', 'unknown', 'sent', 'not-delivered'].includes(chat.last?.status) &&
      typeof chat.last.attemptId === 'string' && Number.isFinite(chat.last.at) &&
      (chat.last.status !== 'sent' || (typeof chat.last.messageId === 'string' && chat.last.messageId.trim().length > 0))), 'CORRUPT_STATE');
  }
  for (const [alias, target] of Object.entries(state.targets)) {
    requireThat(isAlias(alias) && isId(target.owner) && Object.hasOwn(state.chats, target.key), 'CORRUPT_STATE');
  }
  return state;
}
export class Store {
  constructor(file) {
    this.file = file;
    this.failed = false;
    try { this.state = existsSync(file) ? validate(readJson(file)) : empty(); }
    catch { throw new SafeError('CORRUPT_STATE_STOP_DO_NOT_DELETE_OR_REINITIALIZE'); }
    if (!existsSync(file)) atomicJson(file, this.state);
  }
  snapshot() { requireThat(!this.failed, 'STORE_FAILED_RESTART_REQUIRED', 503); return structuredClone(this.state); }
  change(update) {
    const next = this.snapshot();
    const result = update(next);
    validate(next);
    try { atomicJson(this.file, next); } catch { this.failed = true; throw new SafeError('STORE_FAILED_RESTART_REQUIRED', 503); }
    this.state = next;
    return result;
  }
  list() {
    const state = this.snapshot();
    return Object.entries(state.targets).map(([alias, target]) => ({ alias, scope: state.chats[target.key].address.scope,
      active: state.chats[target.key].active, last: state.chats[target.key].last }));
  }
  register(alias, owner, address) {
    requireThat(isAlias(alias), 'INVALID_ALIAS');
    const key = chatKey(address);
    return this.change(state => {
      const prior = Object.hasOwn(state.targets, alias) ? state.targets[alias] : null;
      requireThat(!prior || (prior.owner === owner && prior.key === key), 'ALIAS_ALREADY_OWNED');
      const chat = state.chats[key];
      requireThat(!chat || chat.address.serviceUrl === address.serviceUrl, 'CHAT_ROUTE_CHANGED_REVIEW_REQUIRED');
      state.chats[key] = chat ? { ...chat, active: true } : { address, active: true, last: null };
      state.targets[alias] = { owner, key };
    });
  }
  stop(address) {
    return this.change(state => { const chat = state.chats[chatKey(address)]; if (chat) chat.active = false; });
  }
}