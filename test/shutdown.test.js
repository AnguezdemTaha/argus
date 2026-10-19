import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireLock } from '../src/foundation.js';

const serverUrl = new URL('../src/server.js', import.meta.url).href;
const foundationUrl = new URL('../src/foundation.js', import.meta.url).href;

function directory(t) {
  const path = mkdtempSync(join(tmpdir(), 'argus-shutdown-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

async function startChild(t, path, mode = 'normal') {
  const source = `
    import { runServer } from ${JSON.stringify(serverUrl)};
    import { acquireLock } from ${JSON.stringify(foundationUrl)};
    import { createServer } from 'node:http';
    const mode = ${JSON.stringify(mode)};
    process.on('message', message => {
      if (message === 'console-interrupt') process.emit('SIGINT');
      if (message === 'exit-now') process.exit(1);
    });
    await runServer(async () => {
      const release = acquireLock(${JSON.stringify(path)});
      const server = createServer((_request, response) => response.end('OK'));
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      process.send({ port: server.address().port });
      return async () => {
        await new Promise(resolve => server.close(resolve));
        if (mode === 'stop-fails') throw new Error('private shutdown details');
        release();
      };
    });
  `;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', source], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
  const exited = once(child, 'exit');
  const [ready] = await once(child, 'message');
  return { child, exited, port: ready.port, output: () => output };
}

test('a live lock is protected and release is idempotent', t => {
  const path = directory(t);
  const release = acquireLock(path);
  t.after(release);
  assert.throws(() => acquireLock(path), /PROCESS_LOCK_EXISTS/);
  release();
  release();
  assert.equal(existsSync(join(path, 'process.lock')), false);
});

test('release never deletes a replaced lock', t => {
  const path = directory(t);
  const release = acquireLock(path);
  writeFileSync(join(path, 'process.lock'), '{"pid":123,"token":"another-owner"}');
  release();
  assert.equal(JSON.parse(readFileSync(join(path, 'process.lock'))).token, 'another-owner');
});

test('console interrupt and launcher IPC shutdown allow repeated restart without deleting state',
  { timeout: 20000 }, async t => {
    const path = directory(t);
    const state = join(path, 'preserved.json');
    writeFileSync(state, '{"keep":true}');
    for (const message of ['console-interrupt', { type: 'argus:shutdown' }]) {
      const running = await startChild(t, path);
      assert.equal(await (await fetch(`http://127.0.0.1:${running.port}`)).text(), 'OK');
      assert.throws(() => acquireLock(path), /PROCESS_LOCK_EXISTS/);
      running.child.send(message);
      assert.deepEqual(await running.exited, [0, null]);
      assert.match(running.output(), /SERVER_STOPPED/);
      assert.equal(existsSync(join(path, 'process.lock')), false);
      assert.equal(readFileSync(state, 'utf8'), '{"keep":true}');
    }
  });

test('normal process exit removes its own lock even without asynchronous shutdown',
  { timeout: 10000 }, async t => {
    const path = directory(t);
    const running = await startChild(t, path);
    running.child.send('exit-now');
    assert.deepEqual(await running.exited, [1, null]);
    assert.equal(existsSync(join(path, 'process.lock')), false);
  });

test('shutdown failure exits explicitly and removes the exiting process lock',
  { timeout: 10000 }, async t => {
    const path = directory(t);
    const running = await startChild(t, path, 'stop-fails');
    running.child.send({ type: 'argus:shutdown' });
    assert.deepEqual(await running.exited, [1, null]);
    assert.match(running.output(), /SERVER_SHUTDOWN_FAILED/);
    assert.ok(!running.output().includes('private shutdown details'));
    assert.equal(existsSync(join(path, 'process.lock')), false);
  });
