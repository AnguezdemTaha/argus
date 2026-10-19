import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { SafeError, requireThat } from './foundation.js';

export class CliClient {
  constructor(root = process.cwd()) { this.root = root; }
  async execute(file, args, { interactive = false, json = true } = {}) {
    requireThat(existsSync(file), 'CLI_NOT_INSTALLED_RUN_npm_run_tools:install');
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [file, ...args], { cwd: this.root, windowsHide: !interactive,
        env: { ...process.env, ...(interactive ? {} : { TEAMS_NO_INTERACTIVE: '1' }) },
        stdio: interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; let bytes = 0;
      const timer = setTimeout(() => { child.kill(); reject(new SafeError('CLI_TIMEOUT_IF_CREATE_USE_FINISH_NOT_CREATE')); }, interactive ? 600000 : 180000);
      if (!interactive) {
        child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 1024 * 1024) child.kill(); else stdout += chunk; });
        child.stderr.on('data', () => {});
      }
      child.on('error', () => { clearTimeout(timer); reject(new SafeError('CLI_START_FAILED')); });
      child.on('close', code => {
        clearTimeout(timer);
        if (code !== 0 || bytes > 1024 * 1024) { reject(new SafeError('CLI_FAILED_CHECK_CONSENT_POLICY_OR_PRIVATE_RECOVERY')); return; }
        if (interactive) { resolve(); return; }
        try { resolve(json ? JSON.parse(stdout) : stdout.trim()); }
        catch { reject(new SafeError('CLI_RESPONSE_CONTRACT_MISMATCH_DO_NOT_REPEAT_CREATE')); }
      });
    });
  }
  async bridge(command, ...args) { return this.execute(join(this.root, 'tools', 'bridge.js'), [command, ...args]); }
  async run(args) {
    await this.bridge('storage');
    return this.execute(join(this.root, 'tools/node_modules/@microsoft/teams.cli/dist/index.js'), ['--disable-auto-update', ...args]);
  }
  async interactive(args) {
    await this.bridge('storage');
    return this.execute(join(this.root, 'tools/node_modules/@microsoft/teams.cli/dist/index.js'), ['--disable-auto-update', ...args], { interactive: true });
  }
  async consent() {
    await this.bridge('storage');
    return this.execute(join(this.root, 'tools', 'bridge.js'), ['consent'], { interactive: true });
  }
}