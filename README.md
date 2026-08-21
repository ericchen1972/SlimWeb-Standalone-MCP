# SlimWeb Standalone MCP

Domain-scoped remote MCP shell for independent SlimWeb Standalone installations. It uses `@slimweb/mcp-core` for OAuth, sessions, protocol handling, and the public tool contract. Merchant reads and writes are performed only by the registered Standalone Laravel backend through short-lived RS256 Bridge Tokens.

Backends that advertise the original Phase 1 capability set receive exactly five tools: authentication status, site list, site selection, basic-settings read, and website-name update. A backend receives the complete `@slimweb/mcp-core` tool profile only after it advertises `full_contract_v1` together with the required Phase 1 capabilities. This service has no merchant database, filesystem, FTP, GCS, or object-storage credentials.

For full-contract Theme work, Default is immutable. `slimweb_themes_create_from_default` creates a custom Theme without copying Default root storage, while `slimweb_themes_create_from_theme` clones only an explicit non-Default Theme shell/profile. Active custom Theme root/profile writes require `confirmed_active_theme_edit: true` after explicit user confirmation.

SlimAI authenticates with a Webless-issued RS256 assertion bound to one registered installation and Domain. The hosted service validates that assertion and converts it into a request-local core session; `MCP_SESSION_SECRET` is never distributed to Standalone installations or returned to callers.

Required runtime configuration:

```text
GOOGLE_CLIENT_ID
MCP_SESSION_SECRET
PUBLIC_BASE_URL
WEBLESS_REGISTRY_BASE_URL
WEBLESS_MCP_SECRET
STANDALONE_SLIMAI_ASSERTION_ISSUER
STANDALONE_SLIMAI_ASSERTION_PUBLIC_KEYS_JSON
NODE_ENV
```

`STANDALONE_SLIMAI_ASSERTION_PUBLIC_KEYS_JSON` maps JWT `kid` values to PEM public keys or base64-encoded PEM public keys. `PUBLIC_BASE_URL` is also the required assertion audience.

`main` deploys a no-traffic Cloud Run candidate. Production traffic must be promoted only after OAuth, Domain binding, tool contract, and reversible name-update checks pass.
