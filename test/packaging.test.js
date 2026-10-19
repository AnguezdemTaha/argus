import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { inflateSync } from 'node:zlib';
import { initialize } from '../src/setup.js';
import { atomicJson, readJson } from '../src/foundation.js';
import { createPackage } from '../src/packaging.js';

test('package root contains only manifest and unchanged valid PNG icons, never private files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'argus-zip-')); initialize(directory);
  const config = readJson(join(directory, 'config.json'));
  atomicJson(join(directory, 'config.json'), { ...config, tenantId: '11111111-1111-4111-8111-111111111111',
    botClientId: '22222222-2222-4222-8222-222222222222', botClientSecret: 'must-never-be-packaged',
    managementAppId: '33333333-3333-4333-8333-333333333333', manifestId: '44444444-4444-4444-8444-444444444444',
    allowedUserIds: ['55555555-5555-4555-8555-555555555555'] });
  const { file } = createPackage(directory, join(directory, 'out'));
  const entries = unzipSync(readFileSync(file));
  assert.deepEqual(Object.keys(entries).sort(), ['color.png', 'manifest.json', 'outline.png']);
  const manifest = JSON.parse(strFromU8(entries['manifest.json']));
  assert.deepEqual(manifest.bots[0].scopes, ['personal', 'groupChat']);
  assert.equal(manifest.id, '44444444-4444-4444-8444-444444444444');
  assert.match(manifest.description.full, /Google Gemini/);
  assert.match(manifest.description.full, /GitLab/);
  assert.ok(!manifest.description.full.includes('no external AI'));
  assert.ok(!strFromU8(entries['manifest.json']).includes('must-never'));
  for (const [name, size] of [['color', 192], ['outline', 32]]) {
    const bytes = Buffer.from(entries[`${name}.png`]);
    assert.deepEqual(bytes, readFileSync(join(directory, `${name}.png`)));
    let offset = 8; const compressed = [];
    while (offset < bytes.length) {
      const length = bytes.readUInt32BE(offset);
      if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') compressed.push(bytes.subarray(offset + 8, offset + 8 + length));
      offset += length + 12;
    }
    assert.equal(inflateSync(Buffer.concat(compressed)).length, size * (1 + size * 4));
  }
});