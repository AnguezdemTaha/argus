import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export class SafeError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export function requireThat(condition, code, status = 400) {
  if (!condition) throw new SafeError(code, status);
}
export const isId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const isAlias = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(value);
export function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new SafeError('PRIVATE_FILE_MISSING_OR_CORRUPT'); }
}
export function atomicJson(file, value) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  const descriptor = openSync(temp, 'wx', 0o600);
  try { writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
  try { renameSync(temp, file); }
  catch { try { unlinkSync(temp); } catch {} throw new SafeError('ATOMIC_SAVE_FAILED'); }
}
export function acquireLock(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, 'process.lock');
  const owner = JSON.stringify({ pid: process.pid, token: randomUUID() });
  try {
    const descriptor = openSync(file, 'wx', 0o600);
    try { writeFileSync(descriptor, owner); }
    finally { closeSync(descriptor); }
  } catch { throw new SafeError('PROCESS_LOCK_EXISTS_STOP_OTHER_PROCESS_OR_VERIFY_STALE_LOCK'); }
  const release = () => {
    if (existsSync(file) && readFileSync(file, 'utf8') === owner) unlinkSync(file);
    process.removeListener('exit', onExit);
  };
  const onExit = () => {
    try { release(); }
    catch { console.error('ARGUS: PROCESS_LOCK_RELEASE_FAILED'); }
  };
  process.once('exit', onExit);
  return release;
}
export function validateServiceUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new SafeError('INVALID_TEAMS_SERVICE_URL'); }
  requireThat(url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash &&
    (url.hostname === 'smba.trafficmanager.net' || url.hostname.endsWith('.smba.trafficmanager.net') ||
     url.hostname === 'smba.infra.teams.microsoft.com' || url.hostname.endsWith('.smba.infra.teams.microsoft.com')),
  'INVALID_TEAMS_SERVICE_URL');
  return value;
}
export function validateEndpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw new SafeError('PUBLIC_HTTPS_MESSAGES_ENDPOINT_REQUIRED'); }
  requireThat(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
    url.pathname === '/api/messages' && !url.port && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
    url.hostname.includes('.') && !/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname), 'PUBLIC_HTTPS_MESSAGES_ENDPOINT_REQUIRED');
  return url.href;
}
export const safeCode = error => error instanceof SafeError ? error.code : 'OPERATION_FAILED_SEE_LOCAL_GUIDE';