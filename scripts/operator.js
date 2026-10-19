import { loadConfig } from '../src/config.js';
import { requireThat, isAlias, safeCode } from '../src/foundation.js';

try {
  const [command, alias, ...extra] = process.argv.slice(2);
  requireThat(['targets', 'preview', 'send', 'reconcile'].includes(command), 'USE_TARGETS_PREVIEW_SEND_OR_RECONCILE');
  if (command === 'targets') requireThat(alias === undefined, 'UNEXPECTED_ARGUMENT');
  else requireThat(isAlias(alias), 'VALID_ALIAS_REQUIRED');
  if (command === 'preview') requireThat(extra.length === 0, 'UNEXPECTED_ARGUMENT');
  if (command === 'send') requireThat(extra.length === 1 && extra[0] === '--confirm', 'EXPLICIT_--confirm_REQUIRED');
  const config = loadConfig(undefined, false);
  let body;
  if (command === 'preview') body = { alias };
  if (command === 'send') body = { alias, confirm: true };
  if (command === 'reconcile') {
    requireThat(extra.length === 3 && extra[2] === '--confirm', 'USE_reconcile_ALIAS_OUTCOME_ATTEMPT-ID_--confirm');
    body = { alias, outcome: extra[0], attemptId: extra[1], confirm: true };
  }
  const response = await fetch(`http://127.0.0.1:3979/${command}`, {
    method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${config.operatorToken}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(22000), redirect: 'error'
  });
  const result = await response.json();
  console.log(JSON.stringify(result, null, 2));
  if (!response.ok) process.exitCode = 1;
} catch (error) { console.error(safeCode(error)); process.exitCode = 1; }