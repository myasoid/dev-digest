#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ApiClient } from './http/client.js';
import { loadHttpConfig } from './http/config.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const config = loadHttpConfig();
  const client = new ApiClient(config);
  const server = createServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio IS the MCP transport — stdout must stay protocol-only JSON-RPC.
  // Any human-readable startup logging goes to stderr.
  console.error(`devdigest mcp-server running on stdio (DevDigest API: ${config.baseUrl})`);
}

main().catch((err: unknown) => {
  console.error('mcp-server failed to start:', err);
  process.exit(1);
});
