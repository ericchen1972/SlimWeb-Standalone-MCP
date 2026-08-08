import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { createRequestHandler } from '@slimweb/mcp-core';
import { createStandaloneContext } from '../src/context.js';

const SITE = {
  id: 9,
  site_id: 9,
  site_code: 'swcb_demo',
  callback_code: 'swcb_demo',
  name: 'Demo',
  permissions: ['backend_ai_assistant', 'basic_settings']
};

class FakeBackend {
  calls = [];

  async call(domain, identity, tool, permission, method, path, body, idempotencyKey) {
    this.calls.push({ domain, identity, tool, permission, method, path, body, idempotencyKey });
    if (path === '/internal/mcp/v1/version') return { contract: 'slimweb-backend', major: 1, capabilities: ['site_context', 'basic_settings_read', 'basic_settings_write'] };
    if (path === '/internal/mcp/v1/sites') return { sites: [SITE] };
    if (path === '/internal/mcp/v1/site-context/resolve') return { actor: { site_id: 9, permissions: SITE.permissions }, site: SITE, themes: [] };
    if (method === 'GET') return { site: SITE, settings: { name: 'Demo' } };
    return { ok: true, site: { ...SITE, name: body.name }, settings: { name: body.name } };
  }
}

async function withServer(backend, run) {
  const handler = createRequestHandler({
    ...createStandaloneContext({ backend }),
    sessionSecret: 'test-session-secret',
    publicBaseUrl: 'https://standalone-mcp.slimweb.tw',
    secureCookies: false,
    googleVerifier: { async verify() { return { sub: 'owner-sub', email: 'owner@example.com', name: 'Owner' }; } }
  });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

async function mcp(baseUrl, token, domain, method, params = undefined) {
  const response = await fetch(`${baseUrl}/mcp?domain=${domain}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  return { response, payload: await response.json() };
}

test('Standalone shell binds login, five tools, and backend calls to one Domain', async () => {
  const backend = new FakeBackend();
  await withServer(backend, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/healthz`)).status, 200);
    const login = await fetch(`${baseUrl}/auth/google?domain=192.168.0.188`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: 'test' })
    });
    const loginPayload = await login.json();
    assert.equal(login.status, 200);
    const token = loginPayload.session.access_token;

    const listed = await mcp(baseUrl, token, '192.168.0.188', 'tools/list');
    assert.deepEqual(listed.payload.result.tools.map((tool) => tool.name), [
      'slimweb_auth_status', 'slimweb_sites_list', 'slimweb_site_select', 'slimweb_settings_get', 'slimweb_settings_update'
    ]);
    const updateSchema = listed.payload.result.tools.find((tool) => tool.name === 'slimweb_settings_update').inputSchema;
    assert.deepEqual(Object.keys(updateSchema.properties), ['name', 'site_code']);

    const sites = await mcp(baseUrl, token, '192.168.0.188', 'tools/call', { name: 'slimweb_sites_list', arguments: {} });
    assert.equal(sites.payload.result.structuredContent.sites[0].site_code, 'swcb_demo');

    const selected = await mcp(baseUrl, token, '192.168.0.188', 'tools/call', { name: 'slimweb_site_select', arguments: { site_code: 'swcb_demo' } });
    assert.deepEqual(selected.payload.result.structuredContent.themes, []);

    const updated = await mcp(baseUrl, token, '192.168.0.188', 'tools/call', { name: 'slimweb_settings_update', arguments: { site_code: 'swcb_demo', name: 'Renamed' } });
    assert.equal(updated.payload.result.structuredContent.settings.name, 'Renamed');
    assert.ok(backend.calls.every((call) => call.domain === '192.168.0.188'));

    const beforeMismatch = backend.calls.length;
    const mismatch = await mcp(baseUrl, token, 'other.example.com', 'tools/list');
    assert.equal(mismatch.response.status, 401);
    assert.equal(mismatch.payload.error.data.reason, 'DOMAIN_SESSION_MISMATCH');
    assert.equal(backend.calls.length, beforeMismatch);
  });
});
