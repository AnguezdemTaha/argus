import { randomUUID } from 'node:crypto';
import { isAlias, requireThat, SafeError } from './foundation.js';
import { SIMULATION } from './bot.js';

export class Delivery {
  constructor(store, transport, { now = Date.now, timeoutMs = 15000 } = {}) {
    this.store = store; this.transport = transport; this.now = now; this.timeoutMs = timeoutMs; this.busy = false;
  }
  preview(alias) {
    requireThat(isAlias(alias), 'INVALID_ALIAS');
    const state = this.store.snapshot();
    requireThat(Object.hasOwn(state.targets, alias), 'TARGET_NOT_FOUND', 404);
    const chat = state.chats[state.targets[alias].key];
    requireThat(chat.active, 'TARGET_STOPPED', 409);
    requireThat(!Object.values(state.chats).some(item => ['sending', 'unknown'].includes(item.last?.status)), 'UNRESOLVED_ATTEMPT_MANUAL_REVIEW_REQUIRED', 409);
    requireThat(chat.last?.status !== 'sent' || this.now() - chat.last.at >= 30000, 'COOLDOWN_30_SECONDS', 409);
    return { alias, scope: chat.address.scope, message: SIMULATION };
  }
  async send(alias, confirm) {
    requireThat(confirm === true, 'EXPLICIT_CONFIRM_REQUIRED');
    requireThat(!this.busy, 'SEND_IN_PROGRESS', 409);
    this.preview(alias);
    const attemptId = randomUUID();
    let key;
    const address = this.store.change(state => {
      key = state.targets[alias].key;
      state.chats[key].last = { status: 'sending', attemptId, at: this.now() };
      return structuredClone(state.chats[key].address);
    });
    this.busy = true;
    let timer;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => this.transport(address, SIMULATION)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new SafeError('DELIVERY_TIMEOUT')), this.timeoutMs); })
      ]);
      requireThat(typeof result?.id === 'string' && result.id.trim().length > 0, 'MISSING_MESSAGE_ID');
      this.store.change(state => { state.chats[key].last = { status: 'sent', attemptId, at: this.now(), messageId: result.id }; });
      return { status: 'sent', attemptId, messageId: result.id };
    } catch {
      this.store.change(state => { state.chats[key].last = { status: 'unknown', attemptId, at: this.now() }; });
      throw new SafeError('DELIVERY_UNKNOWN_DO_NOT_RETRY_REVIEW_TEAMS', 409);
    } finally { clearTimeout(timer); this.busy = false; }
  }
  reconcile(alias, outcome, attemptId) {
    requireThat(!this.busy && isAlias(alias) && ['delivered', 'not-delivered'].includes(outcome), 'INVALID_RECONCILIATION');
    this.store.change(state => {
      requireThat(Object.hasOwn(state.targets, alias), 'TARGET_NOT_FOUND');
      const chat = state.chats[state.targets[alias].key];
      requireThat(['unknown', 'sending'].includes(chat.last?.status) && chat.last.attemptId === attemptId, 'ATTEMPT_MISMATCH');
      chat.last = { ...chat.last, status: outcome === 'delivered' ? 'sent' : 'not-delivered', at: this.now(),
        ...(outcome === 'delivered' ? { messageId: 'operator-verified-delivery' } : {}) };
    });
    return { status: 'reconciled' };
  }
}