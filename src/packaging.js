import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { loadConfig } from './config.js';
import { requireThat, isId } from './foundation.js';

export function createPackage(directory, outputDirectory) {
  const config = loadConfig(directory);
  requireThat(isId(config.manifestId) && isId(config.managementAppId), 'FINISH_REGISTRATION_FIRST');
  const manifest = {
    $schema: 'https://developer.microsoft.com/json-schemas/teams/v1.25/MicrosoftTeams.schema.json',
    manifestVersion: '1.25', version: config.manifestVersion || '1.0.0', id: config.manifestId,
    developer: { name: 'ARGUS test developer', websiteUrl: 'https://example.com', privacyUrl: 'https://example.com/privacy', termsOfUseUrl: 'https://example.com/terms' },
    name: { short: 'ARGUS', full: 'ARGUS AI assistant' },
    description: { short: 'AI chat with optional read-only Jira and GitLab tools',
      full: 'Consenting test participants only. Chat and recent context are sent to Google Gemini. Optional Jira and GitLab tools use a shared configured account. Proactive tests send fixed synthetic messages.' },
    icons: { color: 'color.png', outline: 'outline.png' }, accentColor: '#126F5C',
    bots: [{ botId: config.botClientId, scopes: ['personal', 'groupChat'], supportsFiles: false, isNotificationOnly: false }],
    permissions: [], validDomains: []
  };
  const files = { 'manifest.json': strToU8(JSON.stringify(manifest, null, 2)) };
  for (const [name, size] of [['color', 192], ['outline', 32]]) {
    const bytes = readFileSync(join(directory, `${name}.png`));
    requireThat(bytes.length > 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      bytes.readUInt32BE(16) === size && bytes.readUInt32BE(20) === size, 'INVALID_ORIGINAL_ICON');
    files[`${name}.png`] = bytes;
  }
  mkdirSync(outputDirectory, { recursive: true });
  const file = join(outputDirectory, 'ARGUS.zip'); writeFileSync(file, zipSync(files));
  return { file, warning: 'Review placeholder developer/privacy/terms URLs before distribution. ZIP contains only manifest and original icons.' };
}