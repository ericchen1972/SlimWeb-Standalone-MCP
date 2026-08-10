import { SlimWebBackendRepository } from '@slimweb/mcp-core/backend-repository';
import { createCapabilityToolProfile } from '@slimweb/mcp-core/capability-profile';
import { createToolProfile } from '@slimweb/mcp-core/tool-profile';

import { StandaloneBackend } from './backend.js';
import { createDomainContext } from './domainContext.js';

const PHASE1_CAPABILITIES = ['site_context', 'basic_settings_read', 'basic_settings_write'];

function profileForCapabilities(capabilities) {
  return capabilities.includes('full_contract_v1')
    ? createToolProfile()
    : createCapabilityToolProfile(capabilities);
}

export function createStandaloneContext(options = {}) {
  const backend = options.backend ?? new StandaloneBackend({
    registryBaseUrl: options.registryBaseUrl ?? process.env.WEBLESS_REGISTRY_BASE_URL,
    secret: options.secret ?? process.env.WEBLESS_MCP_SECRET,
    fetchImpl: options.fetchImpl
  });
  const capabilitiesByDomain = new Map();

  const loadCapabilities = async (domain, identity) => {
    const key = String(domain).trim();
    if (!capabilitiesByDomain.has(key)) {
      capabilitiesByDomain.set(key, backend.request({
        identity: { ...identity, resource_context: key },
        tool: 'slimweb_auth_status',
        permission: 'backend_ai_assistant',
        method: 'GET',
        path: '/internal/mcp/v1/version'
      }).catch((error) => {
        capabilitiesByDomain.delete(key);
        throw error;
      }));
    }
    const data = await capabilitiesByDomain.get(key);
    if (data.contract !== 'slimweb-backend' || data.major !== 1
      || !PHASE1_CAPABILITIES.every((value) => data.capabilities?.includes(value))) {
      throw Object.assign(new Error('Standalone backend contract mismatch.'), { code: 'BACKEND_CONTRACT_MISMATCH' });
    }
    return data.capabilities;
  };

  const resourceContext = createDomainContext(async (domain, profile) => {
    await loadCapabilities(domain, { google_id: profile.sub, email: profile.email });
  });

  return {
    accountRepository: new SlimWebBackendRepository({ transport: backend }),
    resourceContext,
    toolProfile: createCapabilityToolProfile(PHASE1_CAPABILITIES),
    toolProfileResolver: async ({ identity, resourceContext: requestDomain }) => {
      if (!identity) return createCapabilityToolProfile(PHASE1_CAPABILITIES);
      const domain = identity.resource_context ?? requestDomain;
      return profileForCapabilities(await loadCapabilities(domain, identity));
    }
  };
}
