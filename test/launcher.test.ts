// Runs the real launcher on its own port and data folder, without opening a browser window.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const PORT = 4942;
const data = mkdtempSync(path.join(tmpdir(), 'devart-launcher-'));
const env = { ...process.env, PORT: String(PORT), DEVART_DATA: data, DEVART_OPEN: '0' };
const launcher = (command: string) => spawnSync(process.execPath, ['scripts/launcher.ts', command], { env, encoding: 'utf8', timeout: 40000 });
const up = async () => { try { return (await fetch(`http://127.0.0.1:${PORT}/api/v1/me`)).ok; } catch { return false; } };
const pid = () => readFileSync(path.join(data, 'server.pid'), 'utf8');

test('open starts the server once, keeps it after exiting, and stop ends it', async () => {
  assert.equal(await up(), false);
  assert.equal(launcher('open').status, 0);
  assert.equal(await up(), true, 'server outlives the launcher');
  const first = pid();
  assert.equal(launcher('open').status, 0);
  assert.equal(pid(), first, 'a second open reuses the running server');
  assert.equal(launcher('stop').status, 0);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(await up(), false);
  assert.equal(existsSync(path.join(data, 'server.pid')), false);
  assert.match(launcher('stop').stdout, /not running/);
});

test('the hidden Windows entry point starts the server and reports success', { skip: process.platform !== 'win32' }, async () => {
  const r = spawnSync('wscript.exe', ['scripts\\DevArt.vbs'], { env, timeout: 40000 });
  assert.equal(r.status, 0);
  assert.equal(await up(), true);
  assert.equal(launcher('stop').status, 0);
  await new Promise((r) => setTimeout(r, 500));
});

test('stop leaves alone a server it did not start', async () => {
  const other = spawnSync(process.execPath, ['scripts/launcher.ts', 'open'], { env, encoding: 'utf8', timeout: 40000 });
  assert.equal(other.status, 0);
  const saved = pid();
  // A stale PID file must not get an unrelated process killed.
  writeFileSync(path.join(data, 'server.pid'), String(process.pid));
  const r = launcher('stop');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /started some other way/);
  assert.equal(await up(), true);
  process.kill(Number(saved));
  await new Promise((r) => setTimeout(r, 500));
});

test('MCP over stdio starts the server when needed and draws an architecture', async () => {
  assert.equal(await up(), false);
  const client = new Client({ name: 'test', version: '1' });
  const { DEVART_TOKEN: _omit, ...base } = env as Record<string, string>;
  // Run from another folder, as Claude Code does from any project.
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [path.resolve('mcp/stdio.ts')], cwd: tmpdir(),
    env: { ...base, DEVART_URL: `http://127.0.0.1:${PORT}` },
  }));
  try {
    assert.equal(await up(), true, 'the connector started the server');
    const bad: any = await client.callTool({ name: 'draw_architecture', arguments: { title: 'Broken', code: 'Group {' } });
    assert.equal(bad.isError, true);
    assert.equal(JSON.parse(bad.content[0].text).saved, false);
    const files = async () => (await (await fetch(`http://127.0.0.1:${PORT}/api/v1/files`)).json()) as any[];
    assert.ok(!(await files()).some((f) => f.title === 'Broken'), 'code with errors saves nothing');

    const code = 'direction right\nUsers [icon: users]\nCloud [icon: cloud, color: blue] {\n  API [icon: gateway]\n  Orders [icon: server]\n}\nDB [icon: database, color: green]\nUsers > API: HTTPS\nAPI > Orders\nOrders > DB: SQL';
    const drawn: any = await client.callTool({ name: 'draw_architecture', arguments: { title: 'Payments', code } });
    assert.equal(drawn.isError, undefined);
    const info = JSON.parse(drawn.content[0].text);
    assert.equal(info.saved, true);
    assert.equal(info.url, `http://127.0.0.1:${PORT}/f/${info.fileId}`);
    assert.equal(drawn.content[1].type, 'image');
    assert.equal(Buffer.from(drawn.content[1].data, 'base64').subarray(0, 4).toString('hex'), '89504e47');
    if (process.env.SHOTS) writeFileSync(path.join(process.env.SHOTS, 'mcp-architecture.png'), Buffer.from(drawn.content[1].data, 'base64'));
    const file = await (await fetch(`http://127.0.0.1:${PORT}/api/v1/files/${info.fileId}`)).json() as any;
    assert.equal(file.elements[0].type, 'diagram');

    const second: any = await client.callTool({ name: 'draw_architecture', arguments: { title: 'Second', code: 'A > B', fileId: info.fileId } });
    assert.equal(JSON.parse(second.content[0].text).fileId, info.fileId);
    const after = await (await fetch(`http://127.0.0.1:${PORT}/api/v1/files/${info.fileId}`)).json() as any;
    assert.equal(after.elements.length, 2);
  } finally {
    await client.close();
    assert.equal(launcher('stop').status, 0);
    await new Promise((r) => setTimeout(r, 500));
  }
});

test('open refuses a port used by another program', async () => {
  const blocker = createServer((_q, s) => { s.end('not devart'); });
  await new Promise<void>((r) => blocker.listen(PORT, '127.0.0.1', r));
  try {
    const r = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
      import('node:child_process').then(({ spawn }) => {
        const c = spawn(process.execPath, ['scripts/launcher.ts', 'open'], { env });
        let stderr = '';
        c.stderr.on('data', (d) => { stderr += d; });
        c.on('close', (code) => resolve({ code, stderr }));
      });
    });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /another program/);
  } finally {
    blocker.close();
  }
});
