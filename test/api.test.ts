// End-to-end tests against a real server process with a throwaway database.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

const PORT = 4917;
const BASE = `http://127.0.0.1:${PORT}`;
const API = `${BASE}/api/v1`;
const dir = mkdtempSync(path.join(tmpdir(), 'devart-'));
let proc: ChildProcess;

async function req(method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(API + p, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, type, body: type.includes('json') ? await res.json() as any : await res.arrayBuffer() };
}
const get = (p: string) => req('GET', p);
const post = (p: string, b: unknown = {}) => req('POST', p, b);
const patch = (p: string, b: unknown) => req('PATCH', p, b);

/** fetch() can't override Host, so rebinding checks go through http.request. */
const withHost = (host: string, p: string) => new Promise<number>((resolve, reject) => {
  const r = request({ host: '127.0.0.1', port: PORT, path: p, headers: { Host: host } }, (res) => { res.resume(); resolve(res.statusCode!); });
  r.on('error', reject);
  r.end();
});

const serverEnv = { ...process.env, PORT: String(PORT), DEVART_DATA: dir };
async function startServer() {
  proc = spawn(process.execPath, ['server/index.ts'], { env: serverEnv, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try { await fetch(`${API}/me`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
}

before(startServer);
after(() => {
  proc.kill();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* the OS may still hold the db on Windows */ }
});

test('no sign-in: the first request has a user, and removed features are gone', async () => {
  const me = await get('/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.name, 'You');
  for (const route of ['/teams', '/presets', '/tokens', '/ai/status']) assert.equal((await get(route)).status, 404, route);
  for (const route of ['/import', '/ai/draw']) assert.equal((await post(route, {})).status, 404, route);
  const f = (await post('/files', { title: 'Gone' })).body;
  for (const route of ['comments', 'versions', 'embed-tokens']) assert.equal((await get(`/files/${f.id}/${route}`)).status, 404, route);
});

test('other websites are kept out', async () => {
  assert.equal(await withHost('evil.test', '/api/v1/me'), 403, 'DNS rebinding: foreign Host');
  assert.equal(await withHost('evil.test:4917', '/'), 403);
  assert.equal(await withHost(`localhost:${PORT}`, '/api/v1/me'), 200);
  assert.equal(await withHost(`127.0.0.1:${PORT}`, '/api/v1/me'), 200);
  assert.equal((await req('POST', '/files', { title: 'csrf' }, { Origin: 'https://evil.test' })).status, 403, 'cross-site write');
  assert.equal((await req('POST', '/files', { title: 'csrf' }, { Origin: 'null' })).status, 403, 'sandboxed-frame write');
  const f = (await post('/files', { title: 'ws' })).body;
  const code = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/collab/${f.id}`, { origin: 'https://evil.test' });
    ws.on('unexpected-response', (_q, res) => resolve(res.statusCode));
    ws.on('open', () => resolve('open'));
  });
  assert.equal(code, 403, 'cross-site WebSocket');
});

test('refuses to listen beyond this machine unless told to', () => {
  const r = spawnSync(process.execPath, ['server/index.ts'], { env: { ...process.env, HOST: '0.0.0.0', PORT: '4918', DEVART_DATA: dir }, encoding: 'utf8', timeout: 15000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no login/);
});

test('diagrams: create, validate issues, update, export to each format', async () => {
  const f = (await post('/files', { title: 'Diagrams' })).body;
  const d = (await post(`/files/${f.id}/diagrams`, { type: 'architecture', code: 'A [icon: server] > B: call', title: 'One' })).body;
  assert.deepEqual(d.issues, []);
  const broken = (await patch(`/files/${f.id}/elements/${d.id}`, { code: 'A {' })).body;
  assert.equal(broken.issues[0].severity, 'error');
  await patch(`/files/${f.id}/elements/${d.id}`, { code: 'A > B' });
  for (const [format, magic] of [['png', '89504e47'], ['pdf', '25504446']] as const) {
    const r = await get(`/files/${f.id}/export?format=${format}&elementId=${d.id}`);
    assert.equal(r.status, 200);
    assert.equal(Buffer.from(r.body as ArrayBuffer).subarray(0, 4).toString('hex'), magic);
  }
  const svg = await get(`/files/${f.id}/export?format=svg`);
  assert.match(Buffer.from(svg.body as ArrayBuffer).toString(), /^<svg /);
});

test('export options: scale, transparent background, and Mermaid', async () => {
  const f = (await post('/files', { title: 'Options' })).body;
  const d = (await post(`/files/${f.id}/diagrams`, { type: 'architecture', code: 'A > B: call', title: 'One' })).body;
  const pngWidth = (b: ArrayBuffer) => Buffer.from(b).readUInt32BE(16);
  const one = await get(`/files/${f.id}/export?format=png&elementId=${d.id}&scale=1`);
  const three = await get(`/files/${f.id}/export?format=png&elementId=${d.id}&scale=3`);
  assert.ok(Math.abs(pngWidth(three.body as ArrayBuffer) - pngWidth(one.body as ArrayBuffer) * 3) <= 3);
  const text = async (p: string) => Buffer.from((await get(p)).body as ArrayBuffer).toString();
  assert.match(await text(`/files/${f.id}/export?format=svg`), /<rect [^>]*fill=/);
  assert.doesNotMatch(await text(`/files/${f.id}/export?format=svg&transparent=1`), /^<svg[^>]*>\s*<rect x=/);
  const pdf = await get(`/files/${f.id}/export?format=pdf&scale=3&transparent=1`);
  assert.equal(Buffer.from(pdf.body as ArrayBuffer).subarray(0, 4).toString(), '%PDF');
  const rendered = await post('/render', { type: 'architecture', code: 'A > B', format: 'svg', transparent: true });
  assert.equal(rendered.status, 200);
  const mmd = await text(`/files/${f.id}/export?format=mermaid&elementId=${d.id}`);
  assert.match(mmd, /^flowchart LR\n/);
  assert.match(mmd, /-->\|"call"\|/);
});

test('templates are listed and fetched by id', async () => {
  const list = (await get('/templates')).body;
  assert.equal(list.length, 6);
  const one = await get(`/templates/${list[0].id}`);
  assert.equal(one.status, 200);
  assert.equal(one.body.code, list[0].code);
  assert.equal((await get('/templates/nope')).status, 404);
});

test('files can be renamed, searched, deleted, and restored', async () => {
  const f = (await post('/files', { title: 'Delete me' })).body;
  await post(`/files/${f.id}/diagrams`, { type: 'architecture', code: 'uniquenode123' });
  assert.equal((await patch(`/files/${f.id}`, { title: 'Renamed' })).body.title, 'Renamed');
  assert.ok((await get('/files?q=uniquenode123')).body.some((x: any) => x.id === f.id), 'search reads diagram contents');
  await req('DELETE', `/files/${f.id}`);
  assert.equal((await get(`/files/${f.id}`)).status, 404);
  assert.ok(!(await get('/files')).body.some((x: any) => x.id === f.id));
  await post(`/files/${f.id}/restore`);
  assert.equal((await get(`/files/${f.id}`)).status, 200);
});

test('a manual drawing left empty stays off the list, but appears once it has content', async () => {
  const f = (await post('/files', { title: 'Untitled architecture' })).body;
  const listed = async () => (await get('/files')).body.some((x: any) => x.id === f.id);
  assert.equal(await listed(), false);
  assert.equal((await get(`/files/${f.id}`)).status, 200, 'it still opens');
  await post(`/files/${f.id}/diagrams`, { type: 'architecture', code: 'A' });
  assert.equal(await listed(), true);
});

test('older diagram types, shapes, and stored text are preserved', async () => {
  const f = (await post('/files', { title: 'Old' })).body;
  const elements = [{ id: 's', type: 'shape', x: 0, y: 0, w: 100, h: 60, z: 1, text: 'Old shape' }];
  await patch(`/files/${f.id}`, { elements });
  for (const type of ['flowchart', 'bpmn', 'erd', 'sequence']) assert.equal((await post(`/files/${f.id}/diagrams`, { type, code: type === 'erd' ? 'users {\n id int\n}' : 'A > B' })).status, 200, type);
  const svg = Buffer.from((await get(`/files/${f.id}/export?format=svg`)).body as ArrayBuffer).toString();
  assert.match(svg, /Old shape/);
  assert.equal((await get(`/files/${f.id}/export?format=json`)).body.elements.length, 5);
});

test('live sync: edits flow between windows and into the REST view, and REST writes reach open editors', async () => {
  const f = (await post('/files', { title: 'Live' })).body;
  const open = () => {
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(`ws://127.0.0.1:${PORT}/collab`, f.id, doc, { WebSocketPolyfill: WebSocket as any, disableBc: true });
    return { doc, provider };
  };
  const synced = (p: WebsocketProvider) => new Promise<void>((r) => (p.synced ? r() : p.once('sync', () => r())));
  const a = open(), b = open();
  await Promise.all([synced(a.provider), synced(b.provider)]);
  a.doc.getMap('elements').set('x', { id: 'x', type: 'shape', x: 0, y: 0, w: 10, h: 10, z: 1 });
  await new Promise((r) => setTimeout(r, 1200));
  assert.ok(b.doc.getMap('elements').get('x'));
  assert.equal((await get(`/files/${f.id}`)).body.elements.length, 1);

  const d = (await post(`/files/${f.id}/diagrams`, { type: 'architecture', code: 'A > B' })).body;
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(a.doc.getMap('elements').get(d.id), 'a diagram drawn through MCP appears in an open editor');

  await req('DELETE', `/files/${f.id}`);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(a.provider.wsconnected, false, 'a deleted file ends the session');
  a.provider.destroy();
  b.provider.destroy();
  await post(`/files/${f.id}/restore`);
});

test('a browser\'s saved copy does not duplicate content after the server restarts', async () => {
  const f = (await post('/files', { title: 'Saved copy' })).body;
  await patch(`/files/${f.id}`, { elements: [{ id: 'only', type: 'shape', x: 0, y: 0, w: 10, h: 10, z: 1 }] });
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`ws://127.0.0.1:${PORT}/collab`, f.id, doc, { WebSocketPolyfill: WebSocket as any, disableBc: true });
  await new Promise<void>((r) => provider.once('sync', () => r()));
  assert.equal(doc.getMap('elements').size, 1);
  provider.destroy();

  const exited = new Promise((r) => proc.once('exit', r));
  proc.kill();
  await exited;
  await startServer();

  const again = new WebsocketProvider(`ws://127.0.0.1:${PORT}/collab`, f.id, doc, { WebSocketPolyfill: WebSocket as any, disableBc: true });
  await new Promise<void>((r) => again.once('sync', () => r()));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(doc.getMap('elements').size, 1);
  again.destroy();
});

async function exerciseMcp(client: Client) {
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(tools, ['draw_architecture', 'draw_from_template', 'export_file', 'export_mermaid', 'get_diagram_syntax', 'import_mermaid', 'list_diagrams', 'list_files', 'list_templates', 'render_diagram', 'update_diagram', 'validate_diagram']);
  const json = (r: any) => JSON.parse(r.content[0].text);
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });

  assert.equal(json(await call('validate_diagram', { code: 'users {' })).valid, false);
  assert.match(json(await call('get_diagram_syntax', {})).reference, /direction right/);
  const bad: any = await call('draw_architecture', { title: 'Bad', code: 'A {' });
  assert.equal(bad.isError, true);
  assert.equal(json(bad).saved, false);
  const drawn: any = await call('draw_architecture', { title: 'From MCP', code: 'A [icon: server] > B: hi' });
  const info = JSON.parse(drawn.content[0].text);
  assert.equal(drawn.content[1].type, 'image');
  assert.match(info.url, /\/f\//);
  await call('update_diagram', { fileId: info.fileId, diagramId: info.diagramId, code: 'A > C' });
  assert.equal(json(await call('list_diagrams', { fileId: info.fileId }))[0].code, 'A > C');
  const png: any = await call('export_file', { fileId: info.fileId, format: 'png', elementId: info.diagramId });
  assert.equal(png.content[0].type, 'image');
  assert.ok(json(await call('list_files', { query: 'From MCP' })).some((f: any) => f.id === info.fileId));
  const missing: any = await call('list_diagrams', { fileId: 'does-not-exist' });
  assert.equal(missing.isError, true);

  const mermaid = (await call('export_mermaid', { fileId: info.fileId, diagramId: info.diagramId }) as any).content[0].text;
  assert.match(mermaid, /^flowchart LR/);
  const imported: any = await call('import_mermaid', { mermaid: 'sequenceDiagram\n  Alice->>Bob: hi\n  Bob-->>Alice: hello', title: 'Imported' });
  const importedInfo = json(imported);
  assert.equal(importedInfo.saved, true);
  assert.equal(importedInfo.type, 'sequence');
  assert.equal(imported.content[1].type, 'image');
  assert.equal(json(await call('list_diagrams', { fileId: importedInfo.fileId }))[0].code, 'Alice\nBob\n\nAlice > Bob: hi\nBob --> Alice: hello');
  const graph = json(await call('import_mermaid', { mermaid: 'graph TD\n  A[Web] --> B[(DB)]' }));
  assert.equal(graph.type, 'architecture');
  assert.equal((await call('import_mermaid', { mermaid: 'pie\n "a": 1' }) as any).isError, true);

  const templates = json(await call('list_templates', {}));
  assert.equal(templates.length, 6);
  const fromTemplate: any = await call('draw_from_template', { templateId: 'oauth-flow' });
  assert.equal(json(fromTemplate).saved, true);
  assert.equal(json(fromTemplate).type, 'sequence');
  assert.equal((await call('draw_from_template', { templateId: 'nope' }) as any).isError, true);
}

test('MCP over HTTP', async () => {
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));
  await exerciseMcp(client);
  await client.close();
});

test('MCP over stdio', async () => {
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['mcp/stdio.ts'], env: { ...process.env as Record<string, string>, DEVART_URL: BASE } }));
  await exerciseMcp(client);
  await client.close();
});
