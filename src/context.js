import { createToolProfile } from '@slimweb/mcp-core/tool-profile';
import { StandaloneBackend } from './backend.js';
import { createDomainContext } from './domainContext.js';
import { StandaloneRepository } from './repository.js';

const TOOLS = ['slimweb_auth_status', 'slimweb_sites_list', 'slimweb_site_select', 'slimweb_settings_get', 'slimweb_settings_update'];

export function createStandaloneContext(options = {}) {
  const backend = options.backend ?? new StandaloneBackend({ registryBaseUrl: options.registryBaseUrl ?? process.env.WEBLESS_REGISTRY_BASE_URL, secret: options.secret ?? process.env.WEBLESS_MCP_SECRET, fetchImpl: options.fetchImpl });
  const resourceContext = createDomainContext(async (domain, profile) => {
    const data = await backend.call(domain, { google_id: profile.sub, email: profile.email }, 'slimweb_auth_status', 'backend_ai_assistant', 'GET', '/internal/mcp/v1/version');
    if (data.contract !== 'slimweb-backend' || data.major !== 1 || !['site_context', 'basic_settings_read', 'basic_settings_write'].every((value) => data.capabilities?.includes(value))) throw Object.assign(new Error('Standalone backend contract mismatch.'), { code: 'BACKEND_CONTRACT_MISMATCH' });
  });
  return { accountRepository: new StandaloneRepository(backend), resourceContext, toolProfile: createToolProfile({ enabledTools: TOOLS, schemaProjections: { slimweb_settings_update: ['site_id', 'name'] } }) };
}
