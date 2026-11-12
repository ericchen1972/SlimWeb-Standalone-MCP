import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createStandaloneRequestHandler } from '../src/server.js';

test('standalone OAuth consent and PKCE preserve domain, reject cross-domain sessions', async () => {
  const state = new Map();
  const backend = {
    async bootstrapIdentity({credential,resourceContext}) {
      assert.equal(credential,'test');
      assert.equal(resourceContext,'customer.example');
      return {profile:{sub:'owner',email:'owner@example.com'},backend_grant:'independently-verified-oauth-fixture-grant'};
    },
    async oauthState(method, kind, key, body) {
      const k = kind + key;
      if (method === 'PUT') {
        state.set(k, body);
        return body.value;
      }
      const row = state.get(k);
      if (method === 'DELETE') state.delete(k);
      return row && row.expires_at > Date.now() / 1000 ? row.value : null;
    },
    async request({ path, identity }) {
      assert.equal(identity.backend_grant,'independently-verified-oauth-fixture-grant');
      if (path.endsWith('/version'))
        return {
          contract: 'slimweb-backend',
          major: 1,
          capabilities: [
            'site_context',
            'basic_settings_read',
            'basic_settings_write',
          ],
        };
      return {
        sites: [
          {
            site_id: 1,
            site_code: 'swcb_a',
            name: 'Customer shop',
            permissions: ['system_admin'],
          },
        ],
      };
    },
  };
  const server = createServer(
    createStandaloneRequestHandler({
      backend,
      publicBaseUrl: 'https://standalone-mcp.example',
      sessionSecret: 'test-secret',
      googleVerifier: {
        async verify() {
          return { sub: 'owner', email: 'owner@example.com' };
        },
      },
    }),
  );
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const domain = 'customer.example';
  const call = (path, options = {}) =>
    fetch(base + path + (path.includes('?') ? '&' : '?') + 'domain=' + domain, {
      redirect: 'manual',
      ...options,
    });
  const post = (body) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  try {
    const login = await call('/auth/google', post({ credential: 'test' }));
    const cookie = login.headers.get('set-cookie');
    const redirect = 'https://client.example/callback';
    const client = await (
      await call('/oauth/register', post({ redirect_uris: [redirect] }))
    ).json();
    const verifier = 'v'.repeat(43);
    const params = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: redirect,
      response_type: 'code',
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    });
    const consent = await call('/oauth/authorize?' + params, {
      headers: { cookie },
    });
    assert.equal(consent.status, 200);
    const html = await consent.text();
    const consent_token = html.match(/name="consent_token" value="([^"]+)"/)[1];
    const approved = await call('/oauth/authorize', {
      ...post({ consent_token, decision: 'allow' }),
      headers: { 'content-type': 'application/json', cookie },
    });
    assert.equal(approved.status, 302);
    const code = new URL(approved.headers.get('location')).searchParams.get(
      'code',
    );
    const tokenResponse = await call(
      '/oauth/token',
      post({
        grant_type: 'authorization_code',
        code,
        client_id: client.client_id,
        redirect_uri: redirect,
        code_verifier: verifier,
      }),
    );
    assert.equal(tokenResponse.status, 200);
    const token = (await tokenResponse.json()).access_token;
    const headers = {
      'content-type': 'application/json',
      authorization: 'Bearer ' + token,
    };
    const message = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    assert.equal(
      (await call('/mcp', { method: 'POST', headers, body: message })).status,
      200,
    );
    assert.equal(
      (
        await fetch(base + '/mcp?domain=other.example', {
          method: 'POST',
          headers,
          body: message,
        })
      ).status,
      401,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
