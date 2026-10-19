import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { initialize, Setup } from '../src/setup.js';
import { CliClient } from '../src/cli-client.js';
import { loadConfig, privateDirectory } from '../src/config.js';
import { requireThat, safeCode } from '../src/foundation.js';
import { Store } from '../src/store.js';

try {
  const [command, ...args] = process.argv.slice(2);
  const setup = new Setup(privateDirectory, new CliClient());
  let result;
  if (command === 'init') { requireThat(args.length === 0, 'UNEXPECTED_ARGUMENT'); result = initialize(privateDirectory); }
  else if (command === 'preview') { requireThat(args.length === 1, 'USE_preview_HTTPS-ENDPOINT'); result = setup.preview(args[0]); }
  else if (command === 'preflight') { requireThat(args.length === 0, 'UNEXPECTED_ARGUMENT'); result = await setup.preflight(); }
  else if (command === 'consent') { requireThat(args.length === 1 && args[0] === '--confirm', 'EXPLICIT_--confirm_REQUIRED'); await setup.cli.consent(); result = { next: 'npm run setup -- preflight' }; }
  else if (command === 'create' || command === 'endpoint') {
    requireThat(args.length === 2 && args[1] === '--confirm', 'USE_COMMAND_HTTPS-ENDPOINT_--confirm'); result = await setup[command](args[0], true);
  } else if (command === 'finish') {
    requireThat(args[0] === '--confirm' && (args.length === 1 ||
      (args.length === 2 && args[1] === '--test-only-allow-bot-metadata-mismatch')), 'USE_finish_--confirm_OPTIONAL_--test-only-allow-bot-metadata-mismatch');
    result = await setup.finish(true, args.length === 2);
  }
  else if (command === 'recover') { requireThat(args.length === 3 && args[2] === '--confirm', 'USE_recover_MANAGEMENT-ID_PRIVATE-CREDENTIAL-FILE_--confirm'); result = await setup.recover(args[0], args[1], true); }
  else if (command === 'allow') { requireThat(args.length === 2 && args[1] === '--confirm', 'USE_allow_USER-OBJECT-ID_--confirm'); result = setup.allow(args[0], true); }
  else if (command === 'doctor') {
    const config = loadConfig(privateDirectory, false);
    let shapeValid = true; try { loadConfig(privateDirectory); } catch { shapeValid = false; }
    let state = 'not-created';
    if (existsSync(join(privateDirectory, 'conversations.json'))) { new Store(join(privateDirectory, 'conversations.json')); state = 'valid'; }
    result = { node: process.version, configurationShape: shapeValid ? 'valid' : 'incomplete', conversationState: state,
      cliInstalled: existsSync('tools/node_modules/@microsoft/teams.cli/dist/index.js'),
      microsoftBotCredentials: 'NOT_VERIFIED (shape is not authentication)', teamsDelivery: 'NOT_TESTED',
      registeredIdentity: !!config.botClientId, createAttemptExists: existsSync(setup.markerFile),
      testOnlyBotMetadataException: config.testOnlyBotMetadataException === true,
      next: shapeValid ? 'Start SERVER and TUNNEL; install app; REGISTER and explicitly send.' : 'Read docs/BEGINNER.md; complete account, consent and registration steps.' };
  } else throw new Error('command');
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(`ARGUS: ${safeCode(error)}`); process.exitCode = 1; }