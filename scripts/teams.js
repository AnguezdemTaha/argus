import { CliClient } from '../src/cli-client.js';
import { requireThat, safeCode } from '../src/foundation.js';

try {
  const args = process.argv.slice(2);
  const help = args.includes('--help') || args.includes('-h');
  requireThat(help || ['login', 'logout', 'status', '--version'].includes(args[0]) ||
    (args[0] === 'app' && ['list', 'get'].includes(args[1])), 'USE_GUARDED_SETUP_COMMANDS_FOR_MUTATIONS');
  requireThat(!args.includes('--verbose') && !args.includes('-v'), 'VERBOSE_DISABLED_TO_PROTECT_SECRETS');
  const cli = new CliClient();
  if (args[0] === 'login' || args[0] === 'logout') await cli.interactive(args);
  else {
    if (!help && args[0] !== '--version') await cli.bridge('storage');
    const result = await cli.execute(`${process.cwd()}/tools/node_modules/@microsoft/teams.cli/dist/index.js`, ['--disable-auto-update', ...args], { json: args.includes('--json') });
    console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
  }
} catch (error) { console.error(`ARGUS: ${safeCode(error)}`); process.exitCode = 1; }