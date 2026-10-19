import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { acquireLock } from '../src/foundation.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = resolve('tools/node_modules/@microsoft/teams.cli/dist/index.js');
test('installed CLI help contract matches flags without login, native loading or cloud calls', { skip: !existsSync(cli) }, () => {
  const help = JSON.parse(execFileSync(process.execPath, [cli, '--disable-auto-update', 'app', 'create', '--help', '--json'], { encoding: 'utf8' }));
  for (const flag of ['--teams-managed', '--sign-in-audience <audience>', '--env <path>', '--json']) {
    assert.ok(help.options.some(option => option.flags === flag), flag);
  }
  assert.ok(!help.options.some(option => option.flags.startsWith('--scopes')));
  const config = readFileSync(resolve('tools/node_modules/@microsoft/teams.cli/dist/auth/config.js'), 'utf8');
  assert.ok(config.includes('loginScopes = []')); assert.ok(config.includes('Application.ReadWrite.All')); assert.ok(config.includes('AppDefinitions.ReadWrite'));
});

test('exclusive process lock blocks a second writer and releases without touching state', () => {
  const directory = mkdtempSync(join(tmpdir(), 'argus-lock-'));
  const release = acquireLock(directory);
  assert.throws(() => acquireLock(directory), /PROCESS_LOCK_EXISTS/);
  release(); const again = acquireLock(directory); again();
});