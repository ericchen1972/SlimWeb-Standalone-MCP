# SlimWeb Standalone MCP

Domain-scoped remote MCP shell for independent SlimWeb Standalone installations. It uses `@slimweb/mcp-core` for OAuth, sessions, protocol handling, and the public tool contract. Merchant reads and writes are performed only by the registered Standalone Laravel backend through short-lived RS256 Bridge Tokens.

Phase 1 advertises exactly five tools: authentication status, site list, site selection, basic-settings read, and website-name update. This service has no merchant database, filesystem, FTP, GCS, or object-storage credentials.

Required runtime configuration:

```text
GOOGLE_CLIENT_ID
MCP_SESSION_SECRET
PUBLIC_BASE_URL
WEBLESS_REGISTRY_BASE_URL
WEBLESS_MCP_SECRET
NODE_ENV
```

`main` deploys a no-traffic Cloud Run candidate. Production traffic must be promoted only after OAuth, Domain binding, tool contract, and reversible name-update checks pass.
