#!/usr/bin/env node
/**
 * Hunch MCP server entry point. Connects over stdio.
 * NOTE: stdout is the JSON-RPC channel — all logging goes to stderr.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[hunch] MCP server connected over stdio');
}

main().catch((err: unknown) => {
  console.error('[hunch] fatal:', err);
  process.exit(1);
});
