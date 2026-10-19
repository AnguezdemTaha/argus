import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialize, Setup, createArguments } from '../src/setup.js';
import { atomicJson, readJson } from '../src/foundation.js';

const ids = { tenantId: '11111111-1111-4111-8111-111111111111', humanUserObjectId: '22222222-2222-4222-8222-222222222222',
  botClientId: '33333333-3333-4333-8333-333333333333', managementAppId: '44444444-4444-4444-8444-444444444444', manifestId: '55555555-5555-4555-8555-555555555555' };
const endpoint = 'https://synthetic.devtunnels.ms/api/messages';
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'argus-setup-')); initialize(directory);
  const calls = []; const remote = { ...ids, aadAppClientId: ids.botClientId, botResourceId: ids.botClientId,
    signInAudience: 'AzureADMyOrg', botSingleTenant: true, endpoint, scopes: ['personal', 'team', 'groupChat'], version: '1.0.1' };
  const status = { loggedIn: true, tenantId: ids.tenantId, userObjectId: ids.humanUserObjectId, tdp: { connected: true, sideloading: { tenant: true, user: true } } };
  const access = { graphConsent: true, portalConsent: true, graphReadable: true };
  const cli = {
    async run(args) {
      calls.push(args);
      if (args[0] === 'status') return status;
      if (args.includes('create')) {
        assert.ok(existsSync(join(directory, 'create-attempt.json')));
        atomicJson(join(directory, 'bot.credentials.json'), { Teams: { ClientId: ids.botClientId, TenantId: ids.tenantId, ClientSecret: 'synthetic-secret-value' } });
        return { teamsAppId: ids.managementAppId, botId: ids.botClientId, botLocation: 'teams-managed', endpoint, credentialsFile: join(directory, 'bot.credentials.json') };
      }
      if (args.includes('--scopes')) remote.scopes = ['personal', 'groupChat'];
      if (args.includes('--endpoint')) remote.endpoint = args[args.indexOf('--endpoint') + 1];
      return {};
    },
    async bridge(command) { calls.push(['bridge', command]); return command === 'access' ? access : structuredClone(remote); }
  };
  return { directory, setup: new Setup(directory, cli), cli, calls, remote, status, access };
}
test('init is idempotent, generates private token and valid icon dimensions without overwriting', () => {
  const { directory } = fixture(); const before = readFileSync(join(directory, 'config.json'), 'utf8');
  initialize(directory); assert.equal(readFileSync(join(directory, 'config.json'), 'utf8'), before);
  assert.match(readJson(join(directory, 'config.json')).operatorToken, /^[a-f0-9]{64}$/);
  for (const [name, size] of [['color', 192], ['outline', 32]]) {
    const icon = readFileSync(join(directory, `${name}.png`)); assert.equal(icon.readUInt32BE(16), size); assert.equal(icon.readUInt32BE(20), size);
  }
});
test('preview is offline; create flags explicitly select managed, myOrg, private credentials and JSON', () => {
  const { directory, setup, calls } = fixture(); assert.equal(setup.preview(endpoint).cloudCalls, false); assert.equal(calls.length, 0);
  const args = createArguments(directory, endpoint);
  for (const flag of ['--teams-managed', '--sign-in-audience', 'myOrg', '--env', '--json', '--endpoint']) assert.ok(args.includes(flag));
  assert.ok(!args.includes('--azure'));
});
test('missing login, consent, portal access or upload policy stops before creation and marker', async () => {
  for (const mutate of [fixture => { fixture.status.loggedIn = false; }, fixture => { fixture.status.tdp.connected = false; },
    fixture => { fixture.status.tdp.sideloading.user = false; }, fixture => { fixture.status.tdp.sideloading.tenant = false; }, fixture => { fixture.access.graphConsent = false; }]) {
    const value = fixture(); mutate(value);
    await assert.rejects(value.setup.create(endpoint, true));
    assert.ok(!value.calls.some(args => args.includes('create'))); assert.ok(!existsSync(value.setup.markerFile));
  }
});
test('create imports credentials privately, separates IDs, allowlists human and restricts scopes', async () => {
  const { setup, directory } = fixture();
  await assert.rejects(setup.create(endpoint, false), /confirm/);
  const result = await setup.create(endpoint, true);
  assert.ok(!JSON.stringify(result).includes('synthetic-secret-value'));
  const config = readJson(join(directory, 'config.json'));
  for (const field of Object.keys(ids)) assert.equal(config[field], ids[field]);
  assert.deepEqual(config.allowedUserIds, [ids.humanUserObjectId]);
  assert.equal(config.botClientSecret, 'synthetic-secret-value');
  await assert.rejects(setup.create(endpoint, true), /EXISTING_IDENTITY/);
});
test('lost create response blocks duplicates across restart; recover requires original matching secret file', async () => {
  const { setup, cli, calls, directory } = fixture(); const run = cli.run;
  cli.run = async args => { const result = await run(args); if (args.includes('create')) throw new Error('lost'); return result; };
  await assert.rejects(setup.create(endpoint, true));
  const restarted = new Setup(directory, cli);
  await assert.rejects(restarted.create(endpoint, true), /ALREADY_ATTEMPTED/);
  await assert.rejects(restarted.finish(true), /RESPONSE_LOST/);
  await restarted.recover(ids.managementAppId, setup.credentialsFile, true);
  assert.equal(calls.filter(args => args.includes('create')).length, 1);
});
test('finish resumes a verified partial registration without creating; existing identity preserved', async () => {
  const { setup, cli, directory, calls } = fixture(); const original = cli.bridge;
  cli.bridge = async (...args) => { if (args[0] === 'inspect') throw new Error('temporary'); return original(...args); };
  await assert.rejects(setup.create(endpoint, true));
  cli.bridge = original; await setup.finish(true);
  const configFile = join(directory, 'config.json'); const config = readJson(configFile);
  atomicJson(configFile, { ...config, botClientId: ids.manifestId });
  await assert.rejects(setup.finish(true), /PRESERVED/);
  assert.equal(readJson(configFile).botClientId, ids.manifestId);
  assert.equal(calls.filter(args => args.includes('create')).length, 1);
});
test('endpoint update changes existing bot, not identity; no additional create', async () => {
  const { setup, directory, calls } = fixture(); await setup.create(endpoint, true);
  await setup.endpoint('https://new.devtunnels.ms/api/messages', true);
  assert.equal(readJson(join(directory, 'config.json')).endpoint, 'https://new.devtunnels.ms/api/messages');
  assert.equal(calls.filter(args => args.includes('create')).length, 1);
});

test('recovery rejects mismatched original credentials and preserves all existing identity fields', async () => {
  const { setup, directory, cli } = fixture();
  const run = cli.run;
  cli.run = async args => { const result = await run(args); if (args.includes('create')) throw new Error('lost'); return result; };
  await assert.rejects(setup.create(endpoint, true));
  const before = readFileSync(join(directory, 'config.json'), 'utf8');
  const wrongFile = join(directory, 'wrong.credentials.json');
  atomicJson(wrongFile, { Teams: { ClientId: ids.manifestId, TenantId: ids.tenantId, ClientSecret: 'wrong-synthetic-secret' } });
  await assert.rejects(setup.recover(ids.managementAppId, wrongFile, true), /MISMATCH/);
  assert.equal(readFileSync(join(directory, 'config.json'), 'utf8'), before);
  assert.equal(setup.readCredentials().botClientId, ids.botClientId);
});

test('scope, tenant and manifest identity mismatches stop import; endpoint validation is local', async () => {
  const value = fixture();
  await assert.rejects(value.setup.create('http://localhost:3978/api/messages', true), /HTTPS/);
  assert.equal(value.calls.length, 0);
  value.remote.signInAudience = 'AzureADMultipleOrgs';
  await assert.rejects(value.setup.create(endpoint, true), /MISMATCH/);
  assert.equal(readJson(join(value.directory, 'config.json')).botClientId, null);
});

test('bot metadata exception requires explicit finish opt-in, preserves runtime identity and restricts scopes', async () => {
  const { setup, remote, directory, calls } = fixture();
  remote.botSingleTenant = false;
  await assert.rejects(setup.create(endpoint, true), /MISMATCH/);
  await assert.rejects(setup.finish(true), /MISMATCH/);
  const result = await setup.finish(true, true);
  assert.equal(result.testOnlyBotMetadataException, true);
  assert.match(result.warning, /TEST ONLY/);
  const config = readJson(join(directory, 'config.json'));
  assert.equal(config.testOnlyBotMetadataException, true);
  assert.equal(config.tenantId, ids.tenantId);
  assert.deepEqual(config.allowedUserIds, [ids.humanUserObjectId]);
  assert.deepEqual(remote.scopes, ['personal', 'groupChat']);
  assert.equal(calls.filter(args => args.includes('create')).length, 1);
  await assert.rejects(setup.finish(true), /MISMATCH/);
});

test('test-only bot metadata exception cannot bypass identity, tenant, audience or endpoint checks', async () => {
  for (const [field, value] of Object.entries({ aadAppClientId: ids.manifestId, botResourceId: ids.manifestId,
    botClientId: ids.manifestId, tenantId: ids.manifestId, humanUserObjectId: ids.manifestId,
    managementAppId: ids.manifestId, signInAudience: 'AzureADMultipleOrgs', endpoint: 'https://wrong.example/api/messages',
    botSingleTenant: undefined })) {
    const { setup, remote, directory } = fixture();
    remote.botSingleTenant = false;
    await assert.rejects(setup.create(endpoint, true), /MISMATCH/);
    remote[field] = value;
    await assert.rejects(setup.finish(true, true), /MISMATCH/, field);
    assert.equal(readJson(join(directory, 'config.json')).botClientId, null);
  }
});