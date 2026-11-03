// Streamable HTTP endpoint at /mcp. Stateless: each request gets a fresh server.
import type { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildMcpServer } from './tools.ts';

export async function handleMcpHttp(req: Request, res: Response, apiBase: string) {
  const rpcError = (status: number, message: string) => res.status(status).json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null });
  if (req.method !== 'POST') return void rpcError(405, 'This MCP endpoint is stateless; use POST');

  const server = buildMcpServer(apiBase);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { void transport.close(); void server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) rpcError(500, 'MCP request failed');
  }
}
