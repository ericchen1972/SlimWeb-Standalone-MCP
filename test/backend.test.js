import assert from 'node:assert/strict';
import { test } from 'node:test';

import { StandaloneBackend, pinnedFetch } from '../src/backend.js';
import { createServer } from 'node:http';

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

test('backend transport derives the Domain only from signed resource identity', async () => {
  const requests = [];
  const backend = new StandaloneBackend({
    registryBaseUrl: 'https://slimweb.tw',
    secret: 'central-secret',
    lookupImpl: async () => [{ address: '203.0.113.10', family: 4 }],
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (requests.length === 1) return jsonResponse(200, { ok: true, data: { origin: 'https://shop.example.com', token: 'bridge-token' } });
      return jsonResponse(200, { ok: true, data: { settings: { name: 'Demo' } } });
    }
  });

  const result = await backend.request({
    identity: { google_id: 'owner-sub', email: 'owner@example.com', resource_context: 'shop.example.com' },
    tool: 'slimweb_settings_get',
    permission: 'basic_settings',
    method: 'GET',
    path: '/internal/mcp/v1/sites/swcb_demo/settings/basic'
  });

  assert.equal(result.settings.name, 'Demo');
  assert.equal(JSON.parse(requests[0].options.body).domain, 'shop.example.com');
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

test('backend rejects mapped IPv6 and mixed public/private DNS answers', async () => {
  for (const addresses of [['::ffff:127.0.0.1'], ['::ffff:7f00:1'], ['93.184.216.34', '169.254.169.254'], ['64:ff9b::7f00:1'], ['2002:7f00:1::'], ['2001::7f00:1']]) {
    let calls = 0;
    const backend = new StandaloneBackend({registryBaseUrl: 'https://slimweb.tw', secret: 'x',
      lookupImpl: async () => addresses.map(address => ({address, family: address.includes(':') ? 6 : 4})),
      fetchImpl: async () => { calls++; return jsonResponse(200, {ok:true, data:{origin:'https://shop.example.com',token:'t'}}); }
    });
    await assert.rejects(backend.call('shop.example.com', {}, 't', 'p', 'GET', '/internal/mcp/v1/sites'), e => e.code === 'INSECURE_INSTANCE_REJECTED');
    assert.equal(calls, 1);
  }
});

test('backend binds connection lookup to the checked DNS answer without resolving twice', async () => {
  let lookups = 0, calls = 0;
  const backend = new StandaloneBackend({registryBaseUrl:'https://slimweb.tw',secret:'x',
    lookupImpl:async () => [{address: ++lookups === 1 ? '93.184.216.34' : '127.0.0.1', family:4}],
    fetchImpl:async (url, options) => {
      if (++calls === 1) return jsonResponse(200,{ok:true,data:{origin:'https://shop.example.com',token:'t'}});
      assert.equal(options.redirect, 'manual');
      const address = await new Promise((resolve, reject) => options.lookup('shop.example.com', {}, (err, address) => err ? reject(err) : resolve(address)));
      assert.equal(address, '93.184.216.34');
      return jsonResponse(200,{ok:true,data:{}});
    }
  });
  await backend.call('shop.example.com',{},'t','p','GET','/internal/mcp/v1/sites');
  assert.equal(lookups,1);
});

test('private BOBO origin requires an exact operator-configured exception', async () => {
  for (const [trustedPrivateOrigins, origin, allowed] of [
    [[], 'http://192.168.0.188', false],
    [['http://192.168.0.188'], 'http://192.168.0.188', true],
    [['http://192.168.0.188'], 'http://192.168.0.189', false],
    [['http://192.168.0.188'], 'http://192.168.0.188:8080', false],
    [['http://192.168.0.188'], 'http://192.168.0.188/path', false]
  ]) {
    let calls=0;
    const backend=new StandaloneBackend({registryBaseUrl:'https://slimweb.tw', secret:'x', trustedPrivateOrigins,
      fetchImpl:async()=>jsonResponse(200,{ok:true,data:++calls===1?{origin,token:'t'}:{}})});
    const request=backend.call('192.168.0.188',{},'t','p','GET','/internal/mcp/v1/sites');
    if(allowed) await request;
    else await assert.rejects(request,e=>e.code==='INSECURE_INSTANCE_REJECTED');
    assert.equal(calls,allowed?2:1);
  }
});

test('native transport connects using the supplied pin and does not follow redirects', async () => {
  let hits = 0, lookups = 0;
  const server = createServer((request, response) => {
    hits++;
    if (request.url === '/empty') { response.writeHead(204); response.end(); return; }
    response.writeHead(302, {location: 'http://127.0.0.1/metadata'});
    response.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await pinnedFetch(`http://does-not-exist.invalid:${server.address().port}/`, {
      lookup: (hostname, options, callback) => {
        lookups++;
        assert.equal(hostname, 'does-not-exist.invalid');
        if (options.all) callback(null, [{address: '127.0.0.1', family: 4}]);
        else callback(null, '127.0.0.1', 4);
      }
    });
    assert.equal(response.status, 302);
    assert.equal(hits, 1);
    assert.equal(lookups, 1);
    const empty = await pinnedFetch(`http://127.0.0.1:${server.address().port}/empty`);
    assert.equal(empty.status, 204);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
