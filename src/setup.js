import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { atomicJson, readJson, requireThat, isId, validateEndpoint, acquireLock, SafeError } from './foundation.js';
import { loadConfig } from './config.js';
import { makeIcon } from './icons.js';

export function initialize(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') {
    const account = `${process.env.USERDOMAIN}\\${userInfo().username}`;
    try { execFileSync(join(process.env.SystemRoot, 'System32', 'icacls.exe'), [directory, '/inheritance:r', '/grant:r', `${account}:(OI)(CI)F`], { stdio: 'ignore', windowsHide: true }); }
    catch { throw new SafeError('PRIVATE_DIRECTORY_ACL_FAILED_STOP'); }
  }
  const file = join(directory, 'config.json');
  if (!existsSync(file)) atomicJson(file, { version: 1, operatorToken: randomBytes(32).toString('hex'), allowedUserIds: [],
    tenantId: null, botClientId: null, botClientSecret: null, managementAppId: null, manifestId: null, humanUserObjectId: null, endpoint: null });
  loadConfig(directory, false);
  for (const [name, size] of [['color', 192], ['outline', 32]]) {
    const icon = join(directory, `${name}.png`);
    if (!existsSync(icon)) writeFileSync(icon, makeIcon(size, name === 'outline'), { mode: 0o600, flag: 'wx' });
  }
  return { initialized: true, secretsPrinted: false };
}
export function createArguments(directory, endpoint) {
  return ['--yes', 'app', 'create', '--name', 'ARGUS', '--teams-managed', '--sign-in-audience', 'myOrg',
    '--endpoint', validateEndpoint(endpoint), '--env', join(directory, 'bot.credentials.json'),
    '--color-icon', join(directory, 'color.png'), '--outline-icon', join(directory, 'outline.png'), '--json'];
}
export class Setup {
  constructor(directory, cli) { this.directory = resolve(directory); this.cli = cli; }
  get configFile() { return join(this.directory, 'config.json'); }
  get markerFile() { return join(this.directory, 'create-attempt.json'); }
  get credentialsFile() { return join(this.directory, 'bot.credentials.json'); }
  async preflight() {
    const status = await this.cli.run(['status', '--json']);
    requireThat(status.loggedIn === true && isId(status.tenantId) && isId(status.userObjectId), 'LOGIN_REQUIRED_USE_npm_run_teams_--_login');
    const config = loadConfig(this.directory, false);
    requireThat(!config.tenantId || config.tenantId === status.tenantId.toLowerCase(), 'SIGNED_IN_TENANT_MISMATCH');
    requireThat(!config.humanUserObjectId || config.humanUserObjectId === status.userObjectId.toLowerCase(), 'SIGNED_IN_USER_MISMATCH');
    requireThat(status.tdp?.connected === true, 'PORTAL_CONSENT_REQUIRED_RUN_SETUP_CONSENT_OR_CONTACT_ADMIN');
    requireThat(status.tdp?.sideloading?.tenant === true && status.tdp?.sideloading?.user === true, 'UPLOAD_PERMISSION_REQUIRED_CONTACT_TEAMS_ADMIN');
    const access = await this.cli.bridge('access');
    requireThat(access.graphConsent === true && access.portalConsent === true && access.graphReadable === true,
      'PROVISIONING_CONSENT_REQUIRED_RUN_SETUP_CONSENT_OR_CONTACT_ADMIN');
    return { tenantId: status.tenantId.toLowerCase(), humanUserObjectId: status.userObjectId.toLowerCase() };
  }
  preview(endpoint) {
    const config = loadConfig(this.directory, false);
    return { cloudCalls: false, registration: 'teams-managed', audience: 'myOrg', endpoint: validateEndpoint(endpoint),
      scopesAfterFinish: ['personal', 'groupChat'], existingIdentity: !!config.botClientId,
      createAttemptExists: existsSync(this.markerFile), flags: createArguments(this.directory, endpoint) };
  }
  async create(endpoint, confirm) {
    requireThat(confirm === true, 'EXPLICIT_--confirm_REQUIRED');
    endpoint = validateEndpoint(endpoint);
    const release = acquireLock(this.directory);
    try {
      const config = loadConfig(this.directory, false);
      requireThat(!config.botClientId && !config.managementAppId && !config.manifestId, 'EXISTING_IDENTITY_USE_FINISH_OR_ENDPOINT');
      requireThat(!existsSync(this.markerFile) && !existsSync(this.credentialsFile), 'CREATE_ALREADY_ATTEMPTED_USE_FINISH_OR_RECOVER');
      const identity = await this.preflight();
      const attempt = { version: 1, attemptId: randomUUID(), status: 'creating', endpoint, ...identity, startedAt: new Date().toISOString() };
      atomicJson(this.markerFile, attempt);
      atomicJson(this.credentialsFile, {});
      const result = await this.cli.run(createArguments(this.directory, endpoint));
      requireThat(isId(result.teamsAppId) && isId(result.botId) && result.botLocation === 'teams-managed' &&
        result.endpoint === endpoint && !result.credentials && result.credentialsFile === this.credentialsFile, 'CREATE_RESPONSE_UNVERIFIED_USE_RECOVER');
      atomicJson(this.markerFile, { ...attempt, status: 'created', managementAppId: result.teamsAppId.toLowerCase(), botClientId: result.botId.toLowerCase() });
      return await this.finishInternal();
    } finally { release(); }
  }
  async finish(confirm, allowBotMetadataMismatch = false) {
    requireThat(confirm === true, 'EXPLICIT_--confirm_REQUIRED');
    const release = acquireLock(this.directory);
    try { return await this.finishInternal(allowBotMetadataMismatch); } finally { release(); }
  }
  readCredentials(file = this.credentialsFile) {
    const credentials = readJson(file)?.Teams;
    requireThat(credentials && isId(credentials.ClientId) && isId(credentials.TenantId) &&
      typeof credentials.ClientSecret === 'string' && credentials.ClientSecret.trim().length > 0, 'ORIGINAL_SECRET_VALUE_REQUIRED_SECRET_ID_IS_NOT_A_SECRET');
    return { botClientId: credentials.ClientId.toLowerCase(), tenantId: credentials.TenantId.toLowerCase(), botClientSecret: credentials.ClientSecret };
  }
  async inspect(appId, identity, credentials, endpoint, allowBotMetadataMismatch = false) {
    const remote = await this.cli.bridge('inspect', appId);
    requireThat(remote.managementAppId?.toLowerCase() === appId.toLowerCase() && isId(remote.manifestId) &&
      remote.botClientId?.toLowerCase() === credentials.botClientId && remote.tenantId?.toLowerCase() === credentials.tenantId &&
      remote.aadAppClientId?.toLowerCase() === credentials.botClientId && remote.botResourceId?.toLowerCase() === credentials.botClientId &&
      remote.tenantId?.toLowerCase() === identity.tenantId && remote.humanUserObjectId?.toLowerCase() === identity.humanUserObjectId &&
      remote.signInAudience === 'AzureADMyOrg' && (remote.botSingleTenant === true ||
        (allowBotMetadataMismatch === true && remote.botSingleTenant === false)) && remote.endpoint === endpoint &&
      Array.isArray(remote.scopes), 'REMOTE_IDENTITY_OR_ENDPOINT_MISMATCH_STOP');
    return remote;
  }
  async finishInternal(allowBotMetadataMismatch = false) {
    const attempt = readJson(this.markerFile);
    requireThat(attempt.version === 1 && isId(attempt.managementAppId) && isId(attempt.botClientId), 'CREATE_RESPONSE_LOST_USE_RECOVER_WITH_VERIFIED_APP_ID_AND_ORIGINAL_CREDENTIALS');
    const identity = await this.preflight();
    requireThat(identity.tenantId === attempt.tenantId && identity.humanUserObjectId === attempt.humanUserObjectId, 'CREATE_ATTEMPT_IDENTITY_MISMATCH');
    const credentials = this.readCredentials();
    requireThat(credentials.botClientId === attempt.botClientId, 'BOT_ID_MISMATCH');
    const config = loadConfig(this.directory, false);
    for (const field of ['tenantId', 'botClientId', 'botClientSecret']) requireThat(!config[field] || config[field] === credentials[field], 'EXISTING_IDENTITY_OR_SECRET_PRESERVED');
    requireThat(!config.managementAppId || config.managementAppId === attempt.managementAppId, 'EXISTING_IDENTITY_PRESERVED');
    let remote = await this.inspect(attempt.managementAppId, identity, credentials, attempt.endpoint, allowBotMetadataMismatch);
    requireThat(!config.manifestId || config.manifestId === remote.manifestId.toLowerCase(), 'EXISTING_MANIFEST_ID_PRESERVED');
    if (remote.scopes.length !== 2 || !['personal', 'groupChat'].every(scope => remote.scopes.includes(scope))) {
      await this.cli.run(['--yes', 'app', 'update', attempt.managementAppId, '--scopes', 'personal,groupChat', '--json']);
      remote = await this.inspect(attempt.managementAppId, identity, credentials, attempt.endpoint, allowBotMetadataMismatch);
    }
    requireThat(remote.scopes.length === 2 && ['personal', 'groupChat'].every(scope => remote.scopes.includes(scope)), 'SCOPES_NOT_VERIFIED');
    atomicJson(this.configFile, { ...config, ...credentials, ...identity, managementAppId: attempt.managementAppId,
      manifestId: remote.manifestId.toLowerCase(), endpoint: attempt.endpoint, manifestVersion: remote.version,
      testOnlyBotMetadataException: remote.botSingleTenant === false,
      secretExpiries: remote.secretExpiries ?? [], allowedUserIds: [...new Set([...config.allowedUserIds, identity.humanUserObjectId])] });
    atomicJson(this.markerFile, { ...attempt, status: 'finished' });
    return { registered: true, botClientId: credentials.botClientId, managementAppId: attempt.managementAppId,
      testOnlyBotMetadataException: remote.botSingleTenant === false,
      ...(remote.botSingleTenant === false ? { warning: 'TEST ONLY: bot single-tenant metadata is false; Entra identity is single-tenant. Runtime authentication and tenant checks remain required. Teams delivery is not yet verified.' } : {}),
      manifestId: remote.manifestId.toLowerCase(), humanUserObjectId: identity.humanUserObjectId,
      installLink: `https://teams.microsoft.com/l/app/${attempt.managementAppId}?installAppPackage=true&appTenantId=${credentials.tenantId}` };
  }
  async recover(appId, credentialPath, confirm) {
    requireThat(confirm === true && isId(appId), 'VERIFIED_MANAGEMENT_APP_ID_AND_--confirm_REQUIRED');
    const release = acquireLock(this.directory);
    try {
      const config = loadConfig(this.directory, false);
      const attempt = readJson(this.markerFile);
      requireThat(!attempt.managementAppId || attempt.managementAppId === appId.toLowerCase(), 'EXISTING_ATTEMPT_PRESERVED');
      const identity = await this.preflight();
      requireThat(identity.tenantId === attempt.tenantId && identity.humanUserObjectId === attempt.humanUserObjectId, 'ATTEMPT_IDENTITY_MISMATCH');
      const credentials = this.readCredentials(resolve(credentialPath));
      for (const field of ['tenantId', 'botClientId', 'botClientSecret']) requireThat(!config[field] || config[field] === credentials[field], 'EXISTING_IDENTITY_OR_SECRET_PRESERVED');
      requireThat(!config.managementAppId || config.managementAppId === appId.toLowerCase(), 'EXISTING_IDENTITY_PRESERVED');
      await this.inspect(appId, identity, credentials, attempt.endpoint);
      if (existsSync(this.credentialsFile)) {
        const original = readJson(this.credentialsFile);
        requireThat(!original.Teams || JSON.stringify(this.readCredentials()) === JSON.stringify(credentials), 'ORIGINAL_CREDENTIALS_PRESERVED');
      }
      atomicJson(this.credentialsFile, { Teams: { ClientId: credentials.botClientId, TenantId: credentials.tenantId, ClientSecret: credentials.botClientSecret } });
      atomicJson(this.markerFile, { ...attempt, status: 'recovered', managementAppId: appId.toLowerCase(), botClientId: credentials.botClientId });
      return await this.finishInternal();
    } finally { release(); }
  }
  async endpoint(endpoint, confirm) {
    requireThat(confirm === true, 'EXPLICIT_--confirm_REQUIRED'); endpoint = validateEndpoint(endpoint);
    const release = acquireLock(this.directory);
    try {
      const config = loadConfig(this.directory);
      const identity = await this.preflight();
      const before = await this.cli.bridge('inspect', config.managementAppId);
      requireThat(before.botClientId?.toLowerCase() === config.botClientId && before.manifestId?.toLowerCase() === config.manifestId &&
        before.signInAudience === 'AzureADMyOrg' && before.botSingleTenant === true && before.tenantId?.toLowerCase() === identity.tenantId, 'REMOTE_IDENTITY_MISMATCH');
      await this.cli.run(['--yes', 'app', 'update', config.managementAppId, '--endpoint', endpoint, '--json']);
      await this.inspect(config.managementAppId, identity, config, endpoint);
      atomicJson(this.configFile, { ...config, endpoint });
      const attempt = readJson(this.markerFile);
      atomicJson(this.markerFile, { ...attempt, endpoint });
      return { endpointUpdated: true, createdAnotherBot: false };
    } finally { release(); }
  }
  allow(userId, confirm) {
    requireThat(confirm === true && isId(userId), 'ENTRA_USER_OBJECT_ID_AND_--confirm_REQUIRED');
    const release = acquireLock(this.directory);
    try {
      const config = loadConfig(this.directory);
      requireThat(userId.toLowerCase() !== config.botClientId, 'HUMAN_USER_ID_REQUIRED');
      atomicJson(this.configFile, { ...config, allowedUserIds: [...new Set([...config.allowedUserIds, userId.toLowerCase()])] });
      return { allowedUserId: userId.toLowerCase(), restartRequired: true };
    } finally { release(); }
  }
}