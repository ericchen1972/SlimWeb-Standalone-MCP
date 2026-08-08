import assert from 'node:assert/strict';
import { test } from 'node:test';

import { StandaloneBackend } from '../src/backend.js';

function jsonResponse(status, payload, headers = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', ...headers } });
}

test('backend exchanges central credential for a route-scoped merchant token', async () => {
  const requests = [];
  const backend = new StandaloneBackend({
    registryBaseUrl: 'https://slimweb.tw',
    secret: 'central-secret',
    lookupImpl: async () => [{ address: '203.0.113.10', family: 4 }],
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (requests.length === 1) return jsonResponse(200, { ok: true, data: { origin: 'https://shop.example.com', token: 'bridge-token', expires_at: 1 }, warnings: [] });
      return jsonResponse(200, { ok: true, data: { sites: [] }, warnings: [] });
    }
  });

  const result = await backend.call('shop.example.com', { google_id: 'owner-sub', email: 'owner@example.com' }, 'slimweb_sites_list', 'backend_ai_assistant', 'GET', '/internal/mcp/v1/sites');

  assert.deepEqual(result, { sites: [] });
  assert.equal(requests[0].options.headers['X-SlimWeb-MCP-Secret'], 'central-secret');
  assert.equal(JSON.parse(requests[0].options.body).domain, 'shop.example.com');
  assert.equal(requests[1].url, 'https://shop.example.com/internal/mcp/v1/sites');
  assert.equal(requests[1].options.headers.authorization, 'Bearer bridge-token');
  assert.equal(requests[1].options.headers['X-SlimWeb-MCP-Secret'], undefined);
  assert.equal(requests[1].options.redirect, 'manual');
});

test('backend rejects a production hostname resolving to a private address', async () => {
  let calls = 0;
  const backend = new StandaloneBackend({
    registryBaseUrl: 'https://slimweb.tw', secret: 'secret',
    lookupImpl: async () => [{ address: '127.0.0.1', family: 4 }],
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(200, { ok: true, data: { origin: 'https://shop.example.com', token: 'token' }, warnings: [] });
    }
  });
  await assert.rejects(
    backend.call('shop.example.com', { google_id: 'sub' }, 'slimweb_sites_list', 'backend_ai_assistant', 'GET', '/internal/mcp/v1/sites'),
    (error) => error.code === 'INSECURE_INSTANCE_REJECTED'
  );
  assert.equal(calls, 1, 'merchant fetch must not run after private DNS resolution');
});

test('backend rejects arbitrary and redirected origins', async () => {
  const backend = new StandaloneBackend({
    registryBaseUrl: 'https://slimweb.tw', secret: 'secret',
    fetchImpl: async () => jsonResponse(200, { ok: true, data: { origin: 'http://169.254.169.254', token: 'token' }, warnings: [] })
  });
  await assert.rejects(
    backend.call('bad.example', { google_id: 'sub' }, 'slimweb_sites_list', 'backend_ai_assistant', 'GET', '/internal/mcp/v1/sites'),
    (error) => error.code === 'INSECURE_INSTANCE_REJECTED'
  );
});
