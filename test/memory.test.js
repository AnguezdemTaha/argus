import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationMemory } from '../src/memory.js';

const address = { tenantId: '11111111-1111-4111-8111-111111111111', scope: 'personal', conversationId: 'one' };

test('memory survives restart, is conversation-scoped, and clears on request', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'argus-memory-')), 'memory.json');
  const memory = new ConversationMemory(file);
  memory.append(address, 'We chose option A.', 'I will remember that choice.');
  const restarted = new ConversationMemory(file);

  assert.deepEqual(restarted.history(address), [
    { role: 'user', text: 'We chose option A.' },
    { role: 'model', text: 'I will remember that choice.' }
  ]);
  assert.deepEqual(restarted.history({ ...address, conversationId: 'two' }), []);
  restarted.clear(address);
  assert.deepEqual(new ConversationMemory(file).history(address), []);
});

test('corrupt persisted memory fails closed instead of silently erasing it', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'argus-memory-')), 'memory.json');
  writeFileSync(file, '{broken');
  assert.throws(() => new ConversationMemory(file), /CORRUPT_MEMORY/);
});
