#!/usr/bin/env node
// Stdio entry point. Starts a local DevArt server if none is running, so Claude Code can draw at any time.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildMcpServer } from './tools.ts';

const url = (process.env.DEVART_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

async function ensureLocalServer() {
  const { hostname, port } = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(hostname)) return;
  try {
    await fetch(`${url}/api/v1/me`, { signal: AbortSignal.timeout(2000) });
    return;
  } catch {
    // Not reachable, so start it below.
  }
  // Stdout carries the MCP protocol, so the launcher's output must stay off it.
  const launcher = fileURLToPath(new URL('../scripts/launcher.ts', import.meta.url));
  await new Promise((resolve) => {
    const child = spawn(process.execPath, [launcher, 'start'], { stdio: 'ignore', windowsHide: true, env: { ...process.env, PORT: port || '80' } });
    child.on('close', resolve);
    child.on('error', resolve);
  });
}

await ensureLocalServer();
await buildMcpServer(`${url}/api/v1`).connect(new StdioServerTransport());
