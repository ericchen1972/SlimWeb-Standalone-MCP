import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { createStandaloneRequestHandler } from '../src/server.js';
import { verifyServiceAssertion } from '../src/serviceAssertion.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const NOW = 1_786_322_400;
const ISSUER = 'https://slimweb.tw';
const AUDIENCE = 'https://standalone-mcp.slimweb.tw';

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function assertion(overrides = {}, headerOverrides = {}) {
  const header = encode({ alg: 'RS256', typ: 'JWT', kid: 'test-key', ...headerOverrides });
  const claims = encode({
    iss: ISSUER,
    aud: AUDIENCE,
    instance_id: 17,
    domain: '192.168.0.188',
    sub: 'owner-sub',
    email: 'owner@example.com',
    name: 'Owner',
    jti: 'assertion-id-0001',
    iat: NOW,
    exp: NOW + 60,
    ...overrides
  });
  const input = `${header}.${claims}`;
  const signature = sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url');

  return `${input}.${signature}`;
}

const options = {
  issuer: ISSUER,
  audience: AUDIENCE,
  publicKeys: { 'test-key': publicKey.export({ type: 'spki', format: 'pem' }) },
  now: () => NOW
};

test('verifies a short-lived Webless assertion bound to one Domain and instance', () => {
  const claims = verifyServiceAssertion(assertion(), { ...options, domain: '192.168.0.188' });

  assert.equal(claims.instance_id, 17);
  assert.equal(claims.domain, '192.168.0.188');
  assert.equal(claims.sub, 'owner-sub');
});

test('rejects wrong audience, Domain, instance shape, expiry, algorithm, and signature', () => {
  for (const [token, expected, domain = '192.168.0.188'] of [
    [assertion({ aud: 'https://wrong.example' }), 'SERVICE_ASSERTION_AUDIENCE_INVALID'],
    [assertion(), 'SERVICE_ASSERTION_DOMAIN_MISMATCH', 'other.example.com'],
    [assertion({ instance_id: 0 }), 'SERVICE_ASSERTION_CLAIMS_INVALID'],
    [assertion({ iat: NOW - 60, exp: NOW - 1 }), 'SERVICE_ASSERTION_EXPIRED'],
    [assertion({}, { alg: 'HS256' }), 'SERVICE_ASSERTION_ALGORITHM_INVALID'],
    [`${assertion().slice(0, -1)}x`, 'SERVICE_ASSERTION_SIGNATURE_INVALID']
  ]) {
    assert.throws(
      () => verifyServiceAssertion(token, { ...options, domain }),
      (error) => error.code === expected
    );
  }
});

test('converts a valid assertion into one request-local core session without exposing the core secret', async () => {
  const liveNow = Math.floor(Date.now() / 1000);
  const liveAssertion = () => assertion({ iat: liveNow, exp: liveNow + 60 });
  const calls = [];
  const backend = {
    async request(input) {
      calls.push(input);
      if (input.path === '/internal/mcp/v1/version') {
        return {
          contract: 'slimweb-backend', major: 1,
          capabilities: ['site_context', 'basic_settings_read', 'basic_settings_write', 'full_contract_v1']
        };
      }
      if (input.path === '/internal/mcp/v1/sites') {
        return { sites: [{
          id: 9, site_id: 9, site_code: 'swcb_demo', callback_code: 'swcb_demo', name: 'Demo',
          permissions: ['backend_ai_assistant', 'basic_settings', 'system_admin']
        }] };
      }
      return {};
    }
  };
  const handler = createStandaloneRequestHandler({
    backend,
    sessionSecret: 'hosted-core-secret-that-is-never-returned',
    publicBaseUrl: AUDIENCE,
    secureCookies: false,
    assertionIssuer: ISSUER,
    assertionAudience: AUDIENCE,
    assertionPublicKeys: options.publicKeys,
    now: () => liveNow
  });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${baseUrl}/mcp?domain=192.168.0.188`, {
      method: 'POST',
      headers: { authorization: `Bearer ${liveAssertion()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.ok(
      payload.result.tools.some(({ name }) => name === 'slimweb_posters_create'),
      'full_contract_v1 should expose the complete tool profile'
    );
    assert.equal(calls[0].identity.resource_context, '192.168.0.188');
    assert.equal(calls[0].identity.google_id, 'owner-sub');
    assert.doesNotMatch(JSON.stringify(payload), /hosted-core-secret/);

    const beforeMismatch = calls.length;
    const mismatch = await fetch(`${baseUrl}/mcp?domain=other.example.com`, {
      method: 'POST',
      headers: { authorization: `Bearer ${liveAssertion()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    });
    assert.equal(mismatch.status, 401);
    assert.equal((await mismatch.json()).error.code, 'SERVICE_ASSERTION_DOMAIN_MISMATCH');
    assert.equal(calls.length, beforeMismatch);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
