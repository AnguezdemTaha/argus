import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('runtime and isolated CLI remain pinned to verified baselines', () => {
  const runtime = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  const tools = JSON.parse(readFileSync(new URL('../tools/package.json', import.meta.url)));
  assert.equal(runtime.dependencies['@microsoft/teams.apps'], '2.1.0');
  assert.equal(tools.dependencies['@microsoft/teams.cli'], '3.0.4');
  assert.equal(runtime.dependencies['@microsoft/teams.cli'], undefined);
  const [major, minor] = process.versions.node.split('.').map(Number);
  assert.ok(major > 22 || (major === 22 && minor >= 12), 'Install Node >=22.12');
});