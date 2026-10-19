import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { atomicJson, readJson, requireThat, SafeError } from './foundation.js';

const MAX_TURNS = 24;
const MAX_TEXT_LENGTH = 3000;
const chatKey = address => createHash('sha256')
  .update(JSON.stringify([address.tenantId, address.scope, address.conversationId]))
  .digest('hex');

function validate(state) {
  requireThat(state?.version === 1 && state.chats && !Array.isArray(state.chats), 'CORRUPT_MEMORY');
  for (const [key, chat] of Object.entries(state.chats)) {
    requireThat(/^[a-f0-9]{64}$/.test(key) && chat && Number.isFinite(chat.updatedAt) &&
      Array.isArray(chat.turns) && chat.turns.length <= MAX_TURNS &&
      chat.turns.every(turn => ['user', 'model'].includes(turn.role) &&
        typeof turn.text === 'string' && turn.text.length <= MAX_TEXT_LENGTH), 'CORRUPT_MEMORY');
  }
  return state;
}

export class ConversationMemory {
  constructor(file) {
    this.file = file;
    if (!existsSync(file)) {
      this.state = { version: 1, chats: {} };
      atomicJson(file, this.state);
    } else try {
      this.state = validate(readJson(file));
    } catch {
      throw new SafeError('CORRUPT_MEMORY_STOP_DO_NOT_DELETE_OR_REINITIALIZE');
    }
  }

  history(address) {
    const turns = this.state.chats[chatKey(address)]?.turns ?? [];
    return turns.map(turn => ({ role: turn.role, text: turn.text }));
  }

  append(address, userText, assistantText) {
    requireThat(typeof userText === 'string' && typeof assistantText === 'string', 'INVALID_MEMORY_TURN');
    const key = chatKey(address);
    const turns = [...(this.state.chats[key]?.turns ?? []),
      { role: 'user', text: userText.slice(0, MAX_TEXT_LENGTH) },
      { role: 'model', text: assistantText.slice(0, MAX_TEXT_LENGTH) }]
      .slice(-MAX_TURNS);
    const next = { ...this.state, chats: { ...this.state.chats, [key]: { updatedAt: Date.now(), turns } } };
    try {
      atomicJson(this.file, next);
    } catch {
      throw new SafeError('MEMORY_SAVE_FAILED');
    }
    this.state = next;
  }

  clear(address) {
    const chats = { ...this.state.chats };
    delete chats[chatKey(address)];
    try {
      atomicJson(this.file, { ...this.state, chats });
    } catch {
      throw new SafeError('MEMORY_CLEAR_FAILED');
    }
    this.state = { ...this.state, chats };
  }
}
