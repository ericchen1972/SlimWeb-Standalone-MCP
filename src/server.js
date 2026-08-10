import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequestHandler } from '@slimweb/mcp-core';
import { createSignedToken } from '@slimweb/mcp-core/session';

import { createStandaloneContext } from './context.js';
import { normalizeDomain } from './domainContext.js';
import { parsePublicKeys, verifyServiceAssertion } from './serviceAssertion.js';

function bearerToken(request) {
  const value = String(request.headers.authorization ?? '');
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
}

function assertionError(response, error) {
  response.writeHead(Number(error.status ?? 401), { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ error: { code: error.code ?? 'SERVICE_ASSERTION_INVALID', message: error.message } }));
}

export function createStandaloneRequestHandler(options = {}) {
  const sessionSecret = options.sessionSecret ?? process.env.MCP_SESSION_SECRET;
  const publicBaseUrl = options.publicBaseUrl ?? process.env.PUBLIC_BASE_URL;
  const core = createRequestHandler({
    ...createStandaloneContext(options),
    sessionSecret,
    publicBaseUrl,
    secureCookies: options.secureCookies ?? process.env.NODE_ENV === 'production',
    ...(options.googleVerifier ? { googleVerifier: options.googleVerifier } : {})
  });
  const assertionOptions = {
    issuer: options.assertionIssuer ?? process.env.STANDALONE_SLIMAI_ASSERTION_ISSUER ?? 'https://slimweb.tw',
    audience: options.assertionAudience ?? publicBaseUrl,
    publicKeys: parsePublicKeys(options.assertionPublicKeys ?? process.env.STANDALONE_SLIMAI_ASSERTION_PUBLIC_KEYS_JSON),
    ...(options.now ? { now: options.now } : {})
  };

  return async (request, response) => {
    const token = bearerToken(request);
    if (token.split('.').length !== 3) return core(request, response);

    try {
      const url = new URL(request.url, publicBaseUrl ?? 'https://standalone-mcp.invalid');
      const domain = normalizeDomain(url.searchParams.get('domain'));
      const claims = verifyServiceAssertion(token, { ...assertionOptions, domain });
      request.headers.authorization = `Bearer ${createSignedToken({
        account_id: `standalone:${claims.instance_id}:${claims.sub || claims.email}`,
        email: claims.email,
        name: claims.name,
        google_id: claims.sub,
        site_id: null,
        resource_context: claims.domain,
        service_assertion_jti: claims.jti,
        iat: claims.iat,
        exp: claims.exp
      }, sessionSecret)}`;
    } catch (error) {
      assertionError(response, error);
      return;
    }

    return core(request, response);
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const server = createServer(createStandaloneRequestHandler());
  server.listen(Number(process.env.PORT ?? 8080), process.env.HOST ?? '0.0.0.0');
}
