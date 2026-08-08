function domainError(code, message, status = 422) { const error = new Error(message); error.code = code; error.status = status; return error; }

export function normalizeDomain(value) {
  const domain = String(value ?? '').trim().toLowerCase();
  if (!domain) throw domainError('DOMAIN_REQUIRED', 'A Standalone Domain is required.', 400);
  if (/[\s\/:?#@*]/.test(domain) || domain.length > 253 || (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(domain) && !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain))) throw domainError('DOMAIN_INVALID', 'The Standalone Domain is invalid.');
  return domain;
}

export function createDomainContext(validate) {
  return {
    parse(url) {
      if (['/', '/healthz', '/readyz'].includes(url.pathname)) return null;
      let value = url.searchParams.get('domain');
      if (!value && url.searchParams.get('resource')) {
        try { value = new URL(url.searchParams.get('resource')).searchParams.get('domain'); } catch {}
      }
      return normalizeDomain(value);
    },
    async validateAfterIdentity(domain, identity) { await validate(domain, identity); return domain; },
    equals(left, right) { return left === right; },
    appendToUrl(path, domain) { const url = new URL(path, 'https://local.invalid'); url.searchParams.set('domain', domain); return `${url.pathname}${url.search}`; },
    resourceUrl(base, domain) { return `${base.replace(/\/+$/, '')}/mcp?domain=${encodeURIComponent(domain)}`; }
  };
}
