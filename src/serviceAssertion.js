import { createPublicKey, verify } from 'node:crypto';

function assertionError(code, message, status = 401) {
  return Object.assign(new Error(message), { code, status });
}

function decodeJson(value, code) {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw assertionError(code, 'The SlimAI service assertion is malformed.');
  }
}

export function verifyServiceAssertion(token, options = {}) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3 || parts.some((part) => part === '')) {
    throw assertionError('SERVICE_ASSERTION_MALFORMED', 'The SlimAI service assertion is malformed.');
  }

  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  const header = decodeJson(encodedHeader, 'SERVICE_ASSERTION_MALFORMED');
  const claims = decodeJson(encodedClaims, 'SERVICE_ASSERTION_MALFORMED');
  if (header.alg !== 'RS256' || header.typ !== 'JWT') {
    throw assertionError('SERVICE_ASSERTION_ALGORITHM_INVALID', 'The SlimAI service assertion algorithm is invalid.');
  }

  const key = options.publicKeys?.[header.kid];
  if (typeof header.kid !== 'string' || !key) {
    throw assertionError('SERVICE_ASSERTION_KEY_INVALID', 'The SlimAI service assertion key is unknown.');
  }
  let valid = false;
  try {
    valid = verify(
      'RSA-SHA256',
      Buffer.from(`${encodedHeader}.${encodedClaims}`),
      createPublicKey(key),
      Buffer.from(encodedSignature, 'base64url')
    );
  } catch {
    valid = false;
  }
  if (!valid) {
    throw assertionError('SERVICE_ASSERTION_SIGNATURE_INVALID', 'The SlimAI service assertion signature is invalid.');
  }

  const now = Number(options.now?.() ?? Math.floor(Date.now() / 1000));
  const validIdentity = typeof claims.sub === 'string' && claims.sub.trim() !== ''
    || typeof claims.email === 'string' && claims.email.trim() !== '';
  if (claims.iss !== options.issuer
    || !Number.isInteger(claims.instance_id) || claims.instance_id < 1
    || typeof claims.domain !== 'string' || claims.domain === ''
    || typeof claims.jti !== 'string' || claims.jti.length < 8
    || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)
    || claims.exp <= claims.iat || claims.exp - claims.iat > 120
    || claims.iat > now + 5 || !validIdentity) {
    throw assertionError('SERVICE_ASSERTION_CLAIMS_INVALID', 'The SlimAI service assertion claims are invalid.');
  }
  if (claims.aud !== options.audience) {
    throw assertionError('SERVICE_ASSERTION_AUDIENCE_INVALID', 'The SlimAI service assertion audience is invalid.');
  }
  if (claims.exp < now) {
    throw assertionError('SERVICE_ASSERTION_EXPIRED', 'The SlimAI service assertion has expired.');
  }
  if (claims.domain !== options.domain) {
    throw assertionError('SERVICE_ASSERTION_DOMAIN_MISMATCH', 'The SlimAI service assertion Domain does not match this request.');
  }

  return Object.freeze({ ...claims });
}

export function parsePublicKeys(value) {
  let parsed = value;
  try {
    if (!parsed || typeof parsed !== 'object') parsed = JSON.parse(String(value ?? ''));
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  return Object.fromEntries(Object.entries(parsed).flatMap(([kid, key]) => {
    if (typeof key !== 'string' || key === '') return [];
    const pem = key.includes('BEGIN PUBLIC KEY')
      ? key
      : Buffer.from(key, 'base64').toString('utf8');
    return [[kid, pem]];
  }));
}
