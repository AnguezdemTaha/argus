import test from 'node:test';
import assert from 'node:assert/strict';
import { listGeminiModels } from '../scripts/check-gemini-network.js';

test('model listing paginates and returns only generation model IDs without credentials in URLs', async () => {
  const pages = [];
  const models = await listGeminiModels(' synthetic-secret ', async (url, options) => {
    assert.equal(options.headers['x-goog-api-key'], 'synthetic-secret');
    assert.ok(!String(url).includes('synthetic-secret'));
    pages.push(url.searchParams.get('pageToken'));
    return Response.json(pages.length === 1 ? {
      models: [
        { name: 'models/example-lite', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/embedding', supportedGenerationMethods: ['embedContent'] }
      ], nextPageToken: 'second'
    } : {
      models: [{ name: 'models/example-flash', supportedGenerationMethods: ['generateContent'] }]
    });
  });
  assert.deepEqual(models, ['example-flash', 'example-lite']);
  assert.deepEqual(pages, [null, 'second']);
});

test('model listing reports safe HTTP errors without remote body content', async () => {
  await assert.rejects(listGeminiModels('synthetic', async () =>
    new Response('sensitive remote details', { status: 403 })), error => {
    assert.equal(error.code, 'GEMINI_HTTP_403');
    assert.ok(!error.message.includes('sensitive'));
    return true;
  });
});

test('model listing validates credentials and rejects cyclic pages', async () => {
  for (const key of [undefined, '', 'bad key']) {
    await assert.rejects(listGeminiModels(key, async () => assert.fail('must not fetch')), /GEMINI_/);
  }
  await assert.rejects(listGeminiModels('synthetic', async () =>
    Response.json({ models: [], nextPageToken: 'repeat' })), /GEMINI_INVALID_PAGINATION/);
});
