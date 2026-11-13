import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDomainContext, normalizeDomain } from '../src/domainContext.js';

test('Domain context normalizes hostname and IP values', () => {
  assert.equal(normalizeDomain(' Shop.Example.COM '), 'shop.example.com');
  assert.equal(normalizeDomain('192.168.0.188'), '192.168.0.188');
});

test('Domain context rejects missing and non-host values', () => {
  for (const [value, code] of [
    ['', 'DOMAIN_REQUIRED'],
    ['https://shop.example.com', 'DOMAIN_INVALID'],
    ['shop.example.com/path', 'DOMAIN_INVALID'],
    ['shop.example.com:443', 'DOMAIN_INVALID'],
    ['*.example.com', 'DOMAIN_INVALID']
  ]) {
    assert.throws(() => normalizeDomain(value), (error) => error.code === code);
  }
});

test('Domain context reads OAuth resource parameter and keeps health unscoped', () => {
  const context = createDomainContext(async () => {});
  assert.equal(context.parse(new URL('https://mcp.example/healthz')), null);
  assert.equal(context.parse(new URL('https://mcp.example/oauth/authorize?resource=https%3A%2F%2Fmcp.example%2Fmcp%3Fdomain%3Dshop.example.com')), 'shop.example.com');
  assert.equal(context.appendToUrl('/auth/login?next=%2Foauth%2Fauthorize', 'shop.example.com'), '/auth/login?next=%2Foauth%2Fauthorize&domain=shop.example.com');
});

test('Domain context keeps next query and fragment while replacing supplied domain', () => {
  const context = createDomainContext(async () => {});
  assert.equal(
    context.appendToUrl('/oauth/authorize?client_id=client&domain=foreign.example#consent', 'shop.example.com'),
    '/oauth/authorize?client_id=client&domain=shop.example.com#consent'
  );
});

test('only issuer discovery and registration can omit domain', () => {
  const context = createDomainContext(async () => {});
  for (const path of ['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp', '/mcp/.well-known/oauth-authorization-server', '/.well-known/openid-configuration', '/.well-known/openid-configuration/mcp', '/mcp/.well-known/openid-configuration', '/oauth/register']) {
    assert.equal(context.parse(new URL('https://mcp.example' + path)), null);
  }
  for (const path of ['/mcp', '/auth/login', '/auth/google', '/oauth/authorize', '/oauth/token', '/oauth/revoke', '/.well-known/oauth-protected-resource/mcp']) {
    assert.throws(() => context.parse(new URL('https://mcp.example' + path)), {code: 'DOMAIN_REQUIRED'});
  }
});
