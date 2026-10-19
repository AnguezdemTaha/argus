import { ArgusAssistant } from '../src/ai.js';
import { requireThat, SafeError, safeCode } from '../src/foundation.js';
import { pathToFileURL } from 'node:url';

export async function listGeminiModels(apiKey, fetchImpl = fetch) {
  const key = apiKey?.trim();
  requireThat(typeof key === 'string' && key.length > 0, 'GEMINI_NOT_CONFIGURED', 503);
  requireThat(/^[\x21-\x7e]+$/.test(key), 'GEMINI_INVALID_KEY_FORMAT', 503);
  const models = new Set();
  const pages = new Set();
  let pageToken;
  for (let page = 0; page < 20; page++) {
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(20000)
      });
    } catch {
      throw new SafeError('GEMINI_MODEL_LIST_UNAVAILABLE', 503);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new SafeError(`GEMINI_HTTP_${response.status}`, 503);
    }
    let data;
    try { data = await response.json(); } catch {
      throw new SafeError('GEMINI_INVALID_RESPONSE', 503);
    }
    requireThat(Array.isArray(data?.models), 'GEMINI_INVALID_RESPONSE', 503);
    for (const model of data.models) {
      if (model?.supportedGenerationMethods?.includes('generateContent')) {
        requireThat(typeof model.name === 'string' && /^models\/[a-zA-Z0-9._-]+$/.test(model.name),
          'GEMINI_INVALID_RESPONSE', 503);
        models.add(model.name.slice('models/'.length));
      }
    }
    if (data.nextPageToken === undefined) return [...models].sort();
    requireThat(typeof data.nextPageToken === 'string' && data.nextPageToken.length > 0 &&
      !pages.has(data.nextPageToken) && page < 19, 'GEMINI_INVALID_PAGINATION', 503);
    pageToken = data.nextPageToken;
    pages.add(pageToken);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain && process.argv.includes('--list-models')) {
  try {
    const models = await listGeminiModels(process.env.GEMINI_API_KEY);
    requireThat(models.length > 0, 'GEMINI_NO_GENERATION_MODELS', 503);
    console.log('Models advertising generateContent (generation/tool access still needs testing):');
    for (const model of models) console.log(model);
  } catch (error) {
    console.error(`FAIL: ${safeCode(error)}`);
    process.exitCode = 1;
  }
} else if (isMain && process.argv.includes('--generate')) {
  console.log(`Node ${process.version}; Gemini-only test (no Jira, Teams or conversation history)`);
  const started = Date.now();
  try {
    const assistant = new ArgusAssistant({
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL || undefined
    });
    console.log(`Gemini model: ${assistant.model}`);
    await assistant.reply([], 'Reply with only OK.');
    console.log(`PASS: Gemini generated a response in ${Date.now() - started} ms.`);
  } catch (error) {
    console.error(`FAIL: ${safeCode(error)} after ${Date.now() - started} ms.`);
    process.exitCode = 1;
  }
} else if (isMain) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models';
  console.log(`Node ${process.version}; credential-free Google connectivity check`);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    console.log(`Google reachable: HTTP ${response.status} (no API key supplied)`);
    await response.body?.cancel();
  } catch (error) {
    console.log(JSON.stringify({
      name: error.name,
      code: error.cause?.code,
      nestedCodes: error.cause?.errors?.map(item => item.code)
    }));
    process.exitCode = 1;
  }
}
