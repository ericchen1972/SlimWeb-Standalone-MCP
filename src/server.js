import { createServer } from 'node:http';
import { createRequestHandler } from '@slimweb/mcp-core';
import { createStandaloneContext } from './context.js';

const server = createServer(createRequestHandler({ ...createStandaloneContext(), sessionSecret: process.env.MCP_SESSION_SECRET, publicBaseUrl: process.env.PUBLIC_BASE_URL, secureCookies: process.env.NODE_ENV === 'production' }));
server.listen(Number(process.env.PORT ?? 8080), process.env.HOST ?? '0.0.0.0');
