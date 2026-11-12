import { createHash, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export class BackendError extends Error { constructor(message, code = 'UPSTREAM_FAILED', status = null) { super(message); this.code = code; this.status = status; } }

export class StandaloneBackend {
  constructor({ registryBaseUrl, secret, fetchImpl = pinnedFetch, lookupImpl = lookup, timeoutMs = 15000, trustedPrivateOrigins = [] }) { this.registryBaseUrl = registryBaseUrl.replace(/\/+$/, ''); this.secret = secret; this.fetch = fetchImpl; this.lookup = lookupImpl; this.timeoutMs = timeoutMs; this.trustedPrivateOrigins = new Set(trustedPrivateOrigins.filter(origin => origin === 'http://192.168.0.188')); }

  // OAuth registration happens before identity/domain authorization. Keep its
  // shared state in the central registry, never behind a customer bridge token.
  async oauthState(method, kind, key, body) {
    const data = await this.json(`${this.registryBaseUrl}/internal/mcp/v1/oauth-state/${encodeURIComponent(kind)}/${encodeURIComponent(key)}`, {
      method,
      headers: { 'content-type': 'application/json', 'X-SlimWeb-MCP-Secret': this.secret },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual'
    });
    return data.value;
  }

  bootstrapIdentity({credential,resourceContext}) {
    return this.json(`${this.registryBaseUrl}/internal/mcp/v1/actor-grants/bootstrap`,{
      method:'POST',headers:{'content-type':'application/json','X-SlimWeb-MCP-Secret':this.secret},
      body:JSON.stringify({credential,target:'standalone',domain:resourceContext}),redirect:'manual'
    });
  }

  revokeIdentityGrant(identity) {
    return this.json(`${this.registryBaseUrl}/internal/mcp/v1/actor-grants/revoke`,{
      method:'POST',headers:{'content-type':'application/json','X-SlimWeb-MCP-Secret':this.secret},
      body:JSON.stringify({backend_grant:identity.backend_grant}),redirect:'manual'
    });
  }

  async request({ identity, tool, permission, method = 'GET', path, body, idempotencyKey }) {
    const domain = String(identity?.resource_context ?? '').trim();
    if (domain === '') throw new BackendError('Standalone Domain context is required.', 'DOMAIN_REQUIRED');
    return this.call(domain, identity, tool, permission, method, path, body, idempotencyKey);
  }

  async call(domain, identity, tool, permission, method, path, body, idempotencyKey) {
    const requestId = randomUUID();
    const serializedBody = body === undefined ? undefined : JSON.stringify(body);
    const scope = await this.json(`${this.registryBaseUrl}/internal/standalone/mcp/v1/bridge-token`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-SlimWeb-MCP-Secret': this.secret, 'X-Request-Id': requestId }, body: JSON.stringify({ domain, backend_grant: identity.backend_grant ?? '', tool, permission, method, path, body_hash:createHash('sha256').update(serializedBody ?? '').digest('hex'), request_id: requestId }) });
    const origin = String(scope.origin ?? '');
    const target = await this.assertPublicOrigin(origin);
    if (!/^\/internal\/mcp\/v1\//.test(path) || /[\\\x00-\x20]/.test(path)) throw new BackendError('Backend route is invalid.', 'INSECURE_INSTANCE_REJECTED');
    const headers = { accept: 'application/json', authorization: `Bearer ${scope.token}`, 'X-Request-Id': requestId };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    return this.json(`${origin}${path}`, { method, headers, body: serializedBody, redirect: 'manual', lookup: (_host, options, callback) => {
      if (options?.all) callback(null, [target]);
      else callback(null, target.address, target.family);
    } });
  }

  async assertPublicOrigin(origin) {
    let url;
    try { url = new URL(origin); } catch { throw new BackendError('Registered instance origin is invalid.', 'INSECURE_INSTANCE_REJECTED'); }
    const trusted = this.trustedPrivateOrigins.has(origin);
    if (origin !== url.origin || url.username || url.password || (url.protocol !== 'https:' && !trusted) || (url.port && url.port !== '443')) throw new BackendError('Registered instance origin is not allowed.', 'INSECURE_INSTANCE_REJECTED');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    let answers;
    try { answers = isIP(host) ? [{address: host, family: isIP(host)}] : await this.lookup(host, { all: true, verbatim: true }); }
    catch { throw new BackendError('Standalone backend DNS lookup failed.', 'INSTANCE_UNREACHABLE'); }
    if (!answers.length || (!trusted && answers.some(({ address }) => isPrivateAddress(address)))) throw new BackendError('Registered instance resolves to a forbidden network.', 'INSECURE_INSTANCE_REJECTED');
    return answers[0];
  }

  async json(url, options) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try { response = await this.fetch(url, { ...options, redirect: 'manual', signal: controller.signal }); } catch { throw new BackendError('Standalone backend is unreachable.', 'INSTANCE_UNREACHABLE'); } finally { clearTimeout(timer); }
    if (response.status >= 300 && response.status < 400) throw new BackendError('Backend redirects are not allowed.', 'INSECURE_INSTANCE_REJECTED');
    let payload; try { payload = await response.json(); } catch { throw new BackendError('Backend returned invalid JSON.', 'UPSTREAM_INVALID_RESPONSE', response.status); }
    if (!response.ok || payload?.ok !== true || !('data' in payload)) throw Object.assign(new BackendError(payload?.error?.message ?? 'Backend rejected the request.', payload?.error?.code ?? 'UPSTREAM_FAILED', response.status), {details: payload?.error?.details ?? {}});
    return payload.data;
  }
}

function isPrivateAddress(address) {
  const value = String(address).toLowerCase();
  if (!isIP(value)) return true;
  if (value.includes(':')) {
    const normalized = new URL(`http://[${value}]`).hostname.slice(1, -1);
    const first = parseInt(normalized.split(':')[0], 16);
    const second = parseInt(normalized.split(':')[1] || '0', 16);
    return (first & 0xe000) !== 0x2000 || first === 0x2002 || (first === 0x2001 && second < 0x200) || normalized.startsWith('2001:db8:');
  }
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 198 && (b === 18 || b === 19));
}

// Native transport binds the socket to the validated answer. It deliberately
// avoids global fetch's independent resolver, proxy environment and redirects.
export function pinnedFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return reject(new Error('Unsupported protocol'));
    const request = (parsed.protocol === 'https:' ? httpsRequest : httpRequest)(parsed, {
      method: options.method ?? 'GET', headers: options.headers, signal: options.signal,
      lookup: options.lookup, agent: false
    }, response => {
      let size = 0;
      const chunks = [];
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 16 * 1024 * 1024) { response.destroy(new Error('Backend response too large')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        try {
          const body = [204, 205, 304].includes(response.statusCode) ? null : Buffer.concat(chunks);
          resolve(new Response(body, {status: response.statusCode, headers: response.headers}));
        } catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.end(options.body);
  });
}
