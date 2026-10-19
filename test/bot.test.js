import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { handleMessage, REPLY, SIMULATION } from '../src/bot.js';
import { Delivery } from '../src/delivery.js';
import { ConversationMemory } from '../src/memory.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const otherId = '33333333-3333-4333-8333-333333333333';
const config = { tenantId, allowedUserIds: [userId, otherId] };
const makeStore = () => new Store(join(mkdtempSync(join(tmpdir(), 'argus-')), 'state.json'));
function activity(text, scope = 'personal', overrides = {}) {
  return { type: 'message', channelId: 'msteams', text, from: { aadObjectId: userId }, recipient: { id: 'bot' },
    channelData: { tenant: { id: tenantId } }, serviceUrl: 'https://smba.trafficmanager.net/emea/',
    conversation: { id: scope, conversationType: scope, tenantId }, ...overrides };
}
const mentioned = (text, overrides = {}) => activity(`<at>ARGUS</at> ${text}`, 'groupChat', {
  entities: [{ type: 'mention', mentioned: { id: 'bot' }, text: '<at>ARGUS</at>' }], ...overrides });

test('personal and mentioned group registration; no pasted mentions', async () => {
  const store = makeStore(); const replies = [];
  await handleMessage(activity('REGISTER alice'), config, store, text => replies.push(text));
  await handleMessage(activity('REGISTER ignored', 'groupChat'), config, store, () => {});
  await handleMessage(mentioned('REGISTER project'), config, store, text => replies.push(text));
  assert.deepEqual(store.list().map(item => item.alias), ['alice', 'project']);
  assert.equal(replies.length, 2);
});
test('tenant, identity, channel and scope isolation', async () => {
  for (const overrides of [
    { channelId: 'webchat' }, { from: {} }, { from: { aadObjectId: tenantId } },
    { channelData: { tenant: { id: otherId } } }, { conversation: { id: 'x', conversationType: 'channel' } },
    { serviceUrl: 'https://attacker.example/' }, { channelData: { tenant: { id: tenantId }, team: { id: 'team' } } }
  ]) {
    const store = makeStore();
    await handleMessage(activity('REGISTER alice', 'personal', overrides), config, store, () => assert.fail('must not reply'));
    assert.equal(store.list().length, 0);
  }
});
test('alias ownership, STOP only this chat, unallowlisted group member STOP', async () => {
  const store = makeStore();
  await handleMessage(activity('REGISTER alice'), config, store, () => {});
  await handleMessage(mentioned('REGISTER project'), config, store, () => {});
  await handleMessage(mentioned('REGISTER alice'), config, store, () => assert.fail());
  await handleMessage(activity('REGISTER alice', 'personal', { from: { aadObjectId: otherId } }), config, store, () => assert.fail());
  await handleMessage(mentioned('STOP', { from: { aadObjectId: tenantId } }), config, store, () => {});
  assert.equal(store.list()[0].active, true); assert.equal(store.list()[1].active, false);
});
test('missing AI handler reports configuration error instead of simulated success and stores no text', async () => {
  const store = makeStore(); const replies = [];
  await handleMessage(activity('a private synthetic reply'), config, store, text => replies.push(text));
  await handleMessage(mentioned('different text'), config, store, text => replies.push(text));
  assert.deepEqual(replies, [REPLY, REPLY]);
  assert.match(REPLY, /AI_HANDLER_NOT_CONFIGURED/);
  assert.ok(!REPLY.includes('simul'));
  assert.ok(!readFileSync(store.file, 'utf8').includes('synthetic reply'));
});
test('preview, confirmation, reservation, concurrency, cooldown and restart', async () => {
  const store = makeStore(); await handleMessage(activity('REGISTER alice'), config, store, () => {});
  let complete; let calls = 0; let now = 1000;
  const delivery = new Delivery(store, async (_address, message) => {
    calls++; assert.equal(message, SIMULATION);
    assert.equal(new Store(store.file).list()[0].last.status, 'sending');
    return new Promise(resolve => { complete = resolve; });
  }, { now: () => now });
  assert.equal(delivery.preview('alice').message, SIMULATION); assert.equal(calls, 0);
  await assert.rejects(delivery.send('alice', false), /CONFIRM/);
  const sending = delivery.send('alice', true);
  await Promise.resolve();
  await assert.rejects(delivery.send('alice', true), /PROGRESS/);
  complete({ id: 'message-1' }); await sending;
  await handleMessage(activity('REGISTER alice'), config, store, () => {});
  assert.throws(() => delivery.preview('alice'), /COOLDOWN/);
  assert.equal(new Store(store.file).list()[0].last.messageId, 'message-1');
  now += 30000; assert.equal(delivery.preview('alice').alias, 'alice');
});
test('failure, missing id and timeout persist unknown; REGISTER and restart cannot reset it', async () => {
  for (const transport of [async () => { throw new Error('secret HTTP response'); }, async () => ({}), () => new Promise(() => {})]) {
    const store = makeStore(); await handleMessage(activity('REGISTER alice'), config, store, () => {});
    const delivery = new Delivery(store, transport, { timeoutMs: 10 });
    await assert.rejects(delivery.send('alice', true), /UNKNOWN/);
    await handleMessage(activity('REGISTER alice'), config, store, () => {});
    assert.equal(new Store(store.file).list()[0].last.status, 'unknown');
    assert.throws(() => delivery.preview('alice'), /UNRESOLVED/);
  }
});
test('corrupt state fails closed', () => {
  const store = makeStore(); writeFileSync(store.file, '{broken');
  assert.throws(() => new Store(store.file), /CORRUPT_STATE/);
});

test('group ordinary replies and STOP require a real bot mention; wrong-tenant STOP is rejected', async () => {
  const store = makeStore();
  await handleMessage(mentioned('REGISTER project'), config, store, () => {});
  for (const message of [activity('reply', 'groupChat'), activity('STOP', 'groupChat'),
    mentioned('STOP', { entities: [{ type: 'mention', mentioned: { id: 'another-bot' }, text: '<at>ARGUS</at>' }] }),
    mentioned('STOP', { channelData: { tenant: { id: otherId } } }),
    mentioned('reply', { from: { aadObjectId: tenantId } })]) {
    await handleMessage(message, config, store, () => assert.fail('must not reply'));
  }
  assert.equal(store.list()[0].active, true);
});

test('aliases in one chat share cooldown; stopped aliases cannot be taken over', async () => {
  const store = makeStore();
  await handleMessage(activity('REGISTER alice'), config, store, () => {});
  await handleMessage(activity('REGISTER alternate'), config, store, () => {});
  const delivery = new Delivery(store, async () => ({ id: 'accepted' }));
  await delivery.send('alice', true);
  assert.throws(() => delivery.preview('alternate'), /COOLDOWN/);
  await handleMessage(activity('STOP'), config, store, () => {});
  await handleMessage(mentioned('REGISTER alice'), config, store, () => assert.fail());
  assert.equal(store.list()[0].active, false); assert.equal(store.list()[1].active, false);
});

test('STOP during an in-flight send remains stopped even when delivery completes', async () => {
  const store = makeStore(); await handleMessage(activity('REGISTER alice'), config, store, () => {});
  let complete;
  const delivery = new Delivery(store, () => new Promise(resolve => { complete = resolve; }));
  const pending = delivery.send('alice', true); await Promise.resolve();
  await handleMessage(activity('STOP'), config, store, () => {});
  complete({ id: 'already-in-flight' }); await pending;
  assert.equal(store.list()[0].active, false); assert.equal(store.list()[0].last.status, 'sent');
  assert.throws(() => delivery.preview('alice'), /STOPPED/);
});

test('interrupted sending reservation blocks after restart; reconciliation is explicit and exact', async () => {
  const store = makeStore(); await handleMessage(activity('REGISTER alice'), config, store, () => {});
  store.change(state => { Object.values(state.chats)[0].last = { status: 'sending', attemptId: 'interrupted-id', at: 1000 }; });
  const restarted = new Store(store.file); const delivery = new Delivery(restarted, () => assert.fail());
  assert.throws(() => delivery.preview('alice'), /UNRESOLVED/);
  assert.throws(() => delivery.reconcile('alice', 'delivered', 'wrong-id'), /MISMATCH/);
  delivery.reconcile('alice', 'delivered', 'interrupted-id');
  assert.throws(() => delivery.preview('alice'), /COOLDOWN/);
  assert.equal(new Store(store.file).list()[0].last.messageId, 'operator-verified-delivery');
});

test('valid JSON with corrupt state schema also fails closed', () => {
  const store = makeStore(); writeFileSync(store.file, JSON.stringify({ version: 1, chats: { malformed: {} }, targets: {} }));
  assert.throws(() => new Store(store.file), /CORRUPT_STATE/);
});

test('AI conversation remembers context until DECISION DONE; STOP clears it', async () => {
  const store = makeStore();
  const memory = new ConversationMemory(join(mkdtempSync(join(tmpdir(), 'argus-')), 'memory.json'));
  const responses = [];
  const requests = [];
  const assistant = { async reply(history, text) {
    requests.push({ history, text });
    return text === 'We chose A' ? 'I will keep that decision in mind.' : 'We chose A earlier.';
  } };

  await handleMessage(activity('We chose A'), config, store, text => responses.push(text), assistant, memory);
  await handleMessage(activity('What did we decide?'), config, store, text => responses.push(text), assistant, memory);
  assert.equal(requests[1].history[0].text, 'We chose A');
  await handleMessage(activity('DECISION DONE'), config, store, text => responses.push(text), assistant, memory);
  assert.deepEqual(memory.history({ tenantId, scope: 'personal', conversationId: 'personal' }), []);
  await handleMessage(activity('STOP'), config, store, text => responses.push(text), assistant, memory);
  assert.match(responses[2], /effac/);
});