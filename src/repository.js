import { randomUUID } from 'node:crypto';

export class StandaloneRepository {
  constructor(backend) { this.backend = backend; }
  domain(identity) { return identity.resource_context; }
  async listAdminSitesForGoogleProfile(profile) { return this.listSitesForAdminIdentity({ google_id: profile.sub, email: profile.email, resource_context: profile.resource_context }); }
  async listSitesForAdminIdentity(identity) { return (await this.backend.call(this.domain(identity), identity, 'slimweb_sites_list', 'backend_ai_assistant', 'GET', '/internal/mcp/v1/sites')).sites; }
  async resolveAdminSiteForIdentity(identity, args) { const data = await this.backend.call(this.domain(identity), identity, 'slimweb_site_select', 'backend_ai_assistant', 'POST', '/internal/mcp/v1/site-context/resolve', args.site_code ? { site_code: args.site_code } : { site_id: args.site_id }); return { ...identity, ...data.actor, site: data.site, permissions: data.actor.permissions }; }
  async selectSiteForAdminIdentity(identity, args) { const actor = await this.resolveAdminSiteForIdentity(identity, args); return { site: actor.site, actor, themes: [] }; }
  async getBasicSettings(actor) { return this.backend.call(this.domain(actor), actor, 'slimweb_settings_get', 'basic_settings', 'GET', `/internal/mcp/v1/sites/${encodeURIComponent(actor.site.site_code)}/settings/basic`); }
  async updateBasicSettings(actor, args) { return this.backend.call(this.domain(actor), actor, 'slimweb_settings_update', 'basic_settings', 'PATCH', `/internal/mcp/v1/sites/${encodeURIComponent(actor.site.site_code)}/settings/basic`, { name: args.name }, randomUUID()); }
}
