import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const [major, minor] = process.versions.node.split('.').map(Number);
const supported = major > 22 || (major === 22 && minor >= 12);
const portable = fileURLToPath(new URL('../.local/node-v22.23.3-win-x64/node.exe', import.meta.url));
const executable = supported ? process.execPath : portable;

if (!supported && !existsSync(portable)) {
  console.error('ARGUS: Node >=22.12 is required. Install a supported Node version and reopen the terminal.');
  process.exitCode = 1;
} else {
  console.log(`ARGUS: launching AI server with ${executable}`);
  process.chdir(root);
  if (supported) {
    const { runServer } = await import('../src/server.js');
    await runServer();
  } else {
    const child = spawn(executable, [fileURLToPath(new URL('../src/server.js', import.meta.url))], {
      cwd: root, stdio: ['inherit', 'inherit', 'inherit', 'ipc'], env: process.env
    });
    let requested = false;
    const shutdown = () => {
      if (requested || !child.connected) return;
      requested = true;
      child.send({ type: 'argus:shutdown' }, error => {
        if (error) console.error('ARGUS: SERVER_SHUTDOWN_REQUEST_FAILED');
      });
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    const detach = () => {
      process.removeListener('SIGINT', shutdown);
      process.removeListener('SIGTERM', shutdown);
    };
    child.once('error', () => {
      detach();
      console.error('ARGUS: SERVER_LAUNCH_FAILED');
      process.exitCode = 1;
    });
    child.once('exit', (code, signal) => {
      detach();
      if (signal) console.error('ARGUS: SERVER_EXITED_BY_SIGNAL');
      process.exitCode = code ?? 1;
    });
  }
}
