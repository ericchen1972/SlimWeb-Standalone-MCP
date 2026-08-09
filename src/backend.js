import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';

export class BackendError extends Error { constructor(message, code = 'UPSTREAM_FAILED', status = null) { super(message); this.code = code; this.status = status; } }

export class StandaloneBackend {
  constructor({ registryBaseUrl, secret, fetchImpl = fetch, lookupImpl = lookup, timeoutMs = 15000 }) { this.registryBaseUrl = registryBaseUrl.replace(/\/+$/, ''); this.secret = secret; this.fetch = fetchImpl; this.lookup = lookupImpl; this.timeoutMs = timeoutMs; }

  async request({ identity, tool, permission, method = 'GET', path, body, idempotencyKey }) {
    const domain = String(identity?.resource_context ?? '').trim();
    if (domain === '') throw new BackendError('Standalone Domain context is required.', 'DOMAIN_REQUIRED');
    return this.call(domain, identity, tool, permission, method, path, body, idempotencyKey);
  }

  async call(domain, identity, tool, permission, method, path, body, idempotencyKey) {
    const requestId = randomUUID();
    const scope = await this.json(`${this.registryBaseUrl}/internal/standalone/mcp/v1/bridge-token`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-SlimWeb-MCP-Secret': this.secret, 'X-Request-Id': requestId }, body: JSON.stringify({ domain, actor: { google_sub: identity.google_id ?? identity.google_sub ?? '', email: identity.email ?? '' }, tool, permission, method, path, request_id: requestId }) });
    const origin = String(scope.origin ?? '');
    if (!/^https:\/\//.test(origin) && origin !== 'http://192.168.0.188') throw new BackendError('Registered instance origin is not allowed.', 'INSECURE_INSTANCE_REJECTED');
    if (origin !== 'http://192.168.0.188') await this.assertPublicOrigin(origin);
    const headers = { accept: 'application/json', authorization: `Bearer ${scope.token}`, 'X-Request-Id': requestId };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    return this.json(`${origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  }

  async assertPublicOrigin(origin) {
    const url = new URL(origin);
    let answers;
    try { answers = await this.lookup(url.hostname, { all: true, verbatim: true }); }
    catch { throw new BackendError('Standalone backend DNS lookup failed.', 'INSTANCE_UNREACHABLE'); }
    if (!answers.length || answers.some(({ address }) => isPrivateAddress(address))) throw new BackendError('Registered instance resolves to a forbidden network.', 'INSECURE_INSTANCE_REJECTED');
  }

  async json(url, options) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try { response = await this.fetch(url, { ...options, signal: controller.signal }); } catch { throw new BackendError('Standalone backend is unreachable.', 'INSTANCE_UNREACHABLE'); } finally { clearTimeout(timer); }
    let payload; try { payload = await response.json(); } catch { throw new BackendError('Backend returned invalid JSON.', 'UPSTREAM_INVALID_RESPONSE', response.status); }
    if (!response.ok || payload?.ok !== true || !('data' in payload)) throw new BackendError(payload?.error?.message ?? 'Backend rejected the request.', payload?.error?.code ?? 'UPSTREAM_FAILED', response.status);
    return payload.data;
  }
}

function isPrivateAddress(address) {
  const value = String(address).toLowerCase();
  if (value.includes(':')) return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') || /^fe[89ab]/.test(value) || value.startsWith('ff');
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
