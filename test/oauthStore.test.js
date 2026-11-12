import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StandaloneBackend } from '../src/backend.js';
import { createStandaloneContext } from '../src/context.js';
test('prelogin OAuth state uses central registry storage without domain bridge', async () => {
  let request;
  const backend = new StandaloneBackend({
    registryBaseUrl: 'https://registry.example',
    secret: 'registry-secret',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({ ok: true, data: { value: { client: 'x' } } }),
      };
    },
  });
  const context = createStandaloneContext({ backend });
  assert.deepEqual(
    await context.oauthStore.put(
      'client',
      'a'.repeat(64),
      { client: 'x' },
      123,
    ),
    { client: 'x' },
  );
  assert.equal(
    request.url,
    'https://registry.example/internal/mcp/v1/oauth-state/client/' +
      'a'.repeat(64),
  );
  assert.equal(
    request.options.headers['X-SlimWeb-MCP-Secret'],
    'registry-secret',
  );
  assert.deepEqual(JSON.parse(request.options.body), {
    value: { client: 'x' },
    expires_at: 123,
  });
});
