import { join } from 'node:path';
import { readJson, requireThat, isId } from './foundation.js';

export const privateDirectory = join(process.cwd(), '.private');
export function loadConfig(directory = privateDirectory, runtime = true) {
  const config = readJson(join(directory, 'config.json'));
  requireThat(config.version === 1 && typeof config.operatorToken === 'string' && /^[a-f0-9]{64}$/.test(config.operatorToken), 'INVALID_OPERATOR_TOKEN_RUN_SETUP_INIT');
  requireThat(Array.isArray(config.allowedUserIds) && config.allowedUserIds.every(isId), 'INVALID_ALLOWLIST');
  config.allowedUserIds = config.allowedUserIds.map(value => value.toLowerCase());
  if (runtime) {
    requireThat(isId(config.tenantId) && isId(config.botClientId) && typeof config.botClientSecret === 'string' && config.botClientSecret.length > 0 && config.allowedUserIds.length > 0, 'REGISTRATION_INCOMPLETE_RUN_SETUP_FINISH');
    requireThat(config.botClientId !== config.humanUserObjectId, 'BOT_AND_HUMAN_IDS_MUST_DIFFER');
  }
  return config;
}