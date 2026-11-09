// Browser walkthrough: `npm run e2e`. Starts its own server with a throwaway database.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium, type Page } from 'playwright-core';

const PORT = 4931;
const BASE = `http://127.0.0.1:${PORT}`;
const out = process.env.SHOTS ?? path.join(tmpdir(), 'devart-shots');
mkdirSync(out, { recursive: true });
const proc = spawn(process.execPath, ['server/index.ts'], { env: { ...process.env, PORT: String(PORT), DEVART_DATA: mkdtempSync(path.join(tmpdir(), 'devart-e2e-')) }, stdio: 'inherit' });
for (let i = 0; i < 100; i++) { try { await fetch(`${BASE}/api/v1/me`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const problems: string[] = [];
const results: string[] = [];
let a: Page;
async function open(width = 1440, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/40\d|ERR_/.test(m.text())) problems.push(`console: ${m.text()}`); });
  page.on('dialog', (d) => d.accept());
  return page;
}
const shot = (p: Page, name: string) => p.screenshot({ path: path.join(out, `${name}.png`) });
/** Opens the Insert menu if needed, searches for an item, and returns its draggable button. Dragging it out closes the menu again. */
async function item(p: Page, name: string) {
  if (!(await p.locator('.insert-pop').count())) await p.locator('.insert-toggle').click();
  await p.locator('.insert-pop').getByRole('searchbox').fill(name);
  return p.locator('.insert-pop').getByRole('button', { name, exact: true });
}

async function step(name: string, fn: () => Promise<void>) {
  try { await fn(); results.push(`PASS ${name}`); console.log(`PASS ${name}`); }
  catch (e) { await shot(a, `fail-${results.length}`).catch(() => {}); results.push(`FAIL ${name}: ${(e as Error).message.split('\n')[0]}`); console.log(`FAIL ${name}: ${(e as Error).message}`); }
}
async function dragBy(p: Page, x0: number, y0: number, x1: number, y1: number) {
  await p.mouse.move(x0, y0);
  await p.mouse.down();
  await p.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
  await p.mouse.move(x1, y1, { steps: 4 });
  await p.mouse.up();
}
const middle = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const part = (p: Page, name: string) => p.locator(`.canvas [data-node="${name}"]`);
const boxOf = async (p: Page, name: string) => (await part(p, name).boundingBox())!;
const fileIdOf = (p: Page) => new URL(p.url()).pathname.split('/f/')[1];
const diagramOf = (p: Page, id = fileIdOf(p)) => p.evaluate(async (fid) => (await (await fetch(`/api/v1/files/${fid}/elements`, { cache: 'no-store' })).json()).find((e: any) => e.type === 'diagram'), id);
async function until(p: Page, check: (el: any) => boolean, what: string) {
  for (let i = 0; i < 50; i++) { const d = await diagramOf(p); if (d && check(d)) return d; await p.waitForTimeout(100); }
  assert.fail(`never saved: ${what}: ${JSON.stringify((await diagramOf(p))?.code)}`);
}
const near = (a0: number, b0: number, tolerance = 2) => assert.ok(Math.abs(a0 - b0) <= tolerance, `${a0} should be near ${b0}`);

a = await open();
try {
  await step('home shows the name, the description, and one way to start', async () => {
    for (const route of ['/', '/login', '/settings', '/s/anything', '/new/ai']) {
      await a.goto(BASE + route);
      await a.waitForSelector('.choices');
      assert.equal(new URL(a.url()).pathname, '/');
    }
    assert.match(await a.locator('.home-hero').textContent() ?? '', /DevArt.*Design and visualize system architectures effortlessly\./);
    assert.equal(await a.locator('.choice').count(), 1);
    assert.match(await a.locator('.choices').textContent() ?? '', /Draw Manually/);
    assert.doesNotMatch(await a.locator('.home').textContent() ?? '', /Draw with AI/);
    assert.equal(await a.locator('.recent').count(), 0, 'nothing else on a first visit');
    assert.equal(await a.locator('input[type=password]').count(), 0);
    await shot(a, 'home');
  });

  await step('draw manually: drag components from the palette onto the canvas', async () => {
    await a.getByRole('button', { name: /Draw Manually/ }).click();
    await a.waitForURL(/\/f\//);
    await a.waitForSelector('.canvas-empty');
    await shot(a, 'manual-empty');
    const canvas = (await a.locator('.canvas').boundingBox())!;
    await (await item(a, 'Service')).dragTo(a.locator('.canvas'), { targetPosition: { x: 300, y: 250 } });
    await part(a, 'Service').waitFor();
    const placed = await boxOf(a, 'Service');
    near(placed.x + 48, canvas.x + 300, 14);
    near(placed.y + 38, canvas.y + 250, 14);
    assert.equal(await a.locator('.canvas-empty').count(), 0);
    await (await item(a, 'Database')).dragTo(a.locator('.canvas'), { targetPosition: { x: 650, y: 250 } });
    await part(a, 'Database').waitFor();
    const after = await boxOf(a, 'Service');
    near(after.x, placed.x);
    near(after.y, placed.y);
    await (await item(a, 'Cache')).dragTo(a.locator('.canvas'), { targetPosition: { x: 420, y: 420 } });
    await part(a, 'Cache').waitFor();
    const d = await until(a, (e) => /Service \[icon: server\]/.test(e.code) && /Database \[icon: database\]/.test(e.code) && /Cache/.test(e.code), 'components');
    assert.equal(d.diagramType, 'architecture', 'manual drawings are the same kind of diagram as AI ones');
  });

  await step('connect components with the Connect tool, and nothing moves', async () => {
    const before = await boxOf(a, 'Service');
    await a.getByRole('button', { name: 'Connect', exact: true }).click();
    await a.waitForSelector('.mode-hint');
    const from = middle(await boxOf(a, 'Service')), to = middle(await boxOf(a, 'Database'));
    await dragBy(a, from.x, from.y, to.x, to.y);
    await until(a, (e) => /Service > Database/.test(e.code), 'connection');
    await a.keyboard.press('Escape');
    assert.equal(await a.locator('.mode-hint').count(), 0);
    const after = await boxOf(a, 'Service');
    near(after.x, before.x);
    near(after.y, before.y);
    await shot(a, 'manual-connected');
  });

  await step('connect from the dot beside a selected component', async () => {
    await part(a, 'Cache').click();
    const dot = middle((await a.locator('.part-connect').boundingBox())!);
    const to = middle(await boxOf(a, 'Database'));
    await dragBy(a, dot.x, dot.y, to.x, to.y);
    await until(a, (e) => /Cache > Database/.test(e.code), 'connection from the dot');
  });

  await step('edit a component name and description', async () => {
    await part(a, 'Service').click();
    await a.getByLabel('Component name', { exact: true }).fill('Payments API');
    await a.getByLabel('Component description').fill('Takes card payments');
    await a.getByRole('button', { name: 'Component colour' }).click();
    await a.getByRole('option', { name: 'Green' }).click();
    await until(a, (e) => /label: "Payments API"/.test(e.code) && /description: "Takes card payments"/.test(e.code) && /color: green/.test(e.code), 'form edits');
    assert.match(await a.locator('.canvas').innerHTML(), /Takes card payments/);
    await part(a, 'Database').dblclick();
    await a.locator('.part-rename').fill('Ledger');
    await a.keyboard.press('Enter');
    await until(a, (e) => /label: Ledger/.test(e.code), 'inline rename');
    await shot(a, 'manual-edited');
  });

  await step('move and resize a component', async () => {
    const before = await boxOf(a, 'Cache');
    const c = middle(before);
    await dragBy(a, c.x, c.y, c.x + 40, c.y + 160);
    await until(a, (e) => e.nodeOffsets?.Cache, 'move');
    const moved = await boxOf(a, 'Cache');
    near(moved.x, before.x + 40, 10);
    near(moved.y, before.y + 160, 10);
    const handle = middle((await a.locator('.part-resize').boundingBox())!);
    await dragBy(a, handle.x, handle.y, handle.x + 100, handle.y + 60);
    await until(a, (e) => /Cache \[[^\]]*w: \d+/.test(e.code), 'resize');
    const resized = await boxOf(a, 'Cache');
    assert.ok(resized.width > moved.width + 50, `grew from ${moved.width} to ${resized.width}`);
    near(resized.x, moved.x, 4);
    near(resized.y, moved.y, 4);
  });

  await step('change a connection: label, direction, arrows, line', async () => {
    await a.locator('.canvas [data-edge="0"]').first().click({ force: true });
    await a.waitForSelector('.edge-ends');
    assert.match(await a.locator('.edge-ends').textContent() ?? '', /Payments API.*Ledger/);
    await a.getByLabel('Connection label').fill('writes');
    await until(a, (e) => /Service > Database: "writes"/.test(e.code), 'label');
    await a.getByRole('button', { name: 'Reverse direction' }).click();
    await until(a, (e) => /Database > Service: "writes"/.test(e.code), 'reverse');
    await a.getByLabel('Connection arrows').selectOption('both');
    await until(a, (e) => /Database <> Service/.test(e.code), 'both ways');
    await a.getByLabel('Connection line').selectOption('dashed');
    await until(a, (e) => /style: dashed/.test(e.code), 'dashed');
    await shot(a, 'manual-connection');
  });

  await step('organize components into a group by dragging, and back out', async () => {
    await (await item(a, 'Group')).dragTo(a.locator('.canvas'), { targetPosition: { x: 200, y: 500 } });
    await part(a, 'Group').waitFor();
    const group = middle(await boxOf(a, 'Group'));
    const lb = await item(a, 'Queue');
    await lb.dragTo(a.locator('.canvas'), { targetPosition: { x: group.x - (await a.locator('.canvas').boundingBox())!.x, y: group.y - (await a.locator('.canvas').boundingBox())!.y } });
    await part(a, 'Queue').waitFor();
    await until(a, (e) => /Group \{[^}]*Queue/.test(e.code), 'dropped into the group');
    const c = middle(await boxOf(a, 'Cache'));
    // Aim for the group's corner, so Cache doesn't land on top of Queue and hide it from the pointer.
    const g = await boxOf(a, 'Group');
    await dragBy(a, c.x, c.y, g.x + g.width - 6, g.y + g.height - 6);
    await until(a, (e) => /Group \{[^}]*Cache/.test(e.code), 'dragged into the group');
    await shot(a, 'manual-group');
    const q = middle(await boxOf(a, 'Cache'));
    await dragBy(a, q.x, q.y, q.x + 700, q.y - 60);
    await until(a, (e) => !/Group \{[^}]*Cache/.test(e.code), 'dragged out of the group');
  });

  await step('zoom, pan, undo, redo, delete', async () => {
    const zoomLabel = () => a.locator('.zoom-val').textContent();
    await a.getByRole('button', { name: 'Fit to content' }).click();
    const fitted = await zoomLabel();
    await a.getByRole('button', { name: 'Zoom in' }).click();
    assert.notEqual(await zoomLabel(), fitted);
    await a.getByRole('button', { name: 'Zoom out' }).click();
    const before = await boxOf(a, 'Queue');
    const canvas = (await a.locator('.canvas').boundingBox())!;
    await dragBy(a, canvas.x + 20, canvas.y + canvas.height - 20, canvas.x + 80, canvas.y + canvas.height - 60);
    const panned = await boxOf(a, 'Queue');
    near(panned.x, before.x + 60, 3);
    near(panned.y, before.y - 40, 3);

    await part(a, 'Queue').click();
    await a.locator('.canvas').focus();
    await a.keyboard.press('Delete');
    await until(a, (e) => !/Queue/.test(e.code), 'delete');
    await a.getByRole('button', { name: 'Undo', exact: true }).click();
    await until(a, (e) => /Queue/.test(e.code), 'undo');
    await a.getByRole('button', { name: 'Redo', exact: true }).click();
    await until(a, (e) => !/Queue/.test(e.code), 'redo');

    await a.mouse.click(canvas.x + 20, canvas.y + canvas.height - 20);
    await a.locator('.canvas').focus();
    await a.keyboard.press('Delete');
    await a.waitForTimeout(300);
    assert.ok(await diagramOf(a), 'Delete with nothing picked keeps the diagram');
  });

  await step('everything is saved: a reload shows the same diagram', async () => {
    const before = await boxOf(a, 'Service');
    assert.match(await a.locator('.save-state').textContent() ?? '', /All changes saved/);
    await a.getByLabel('Diagram name').fill('Payments');
    await a.getByLabel('Diagram name').blur();
    await a.waitForTimeout(300);
    await a.reload();
    await part(a, 'Service').waitFor();
    assert.equal(await a.getByLabel('Diagram name').inputValue(), 'Payments');
    assert.ok(before.width > 0);
    assert.match(await a.locator('.canvas').innerHTML(), /Payments API/);
  });

  await step('export downloads a real PNG, SVG, and PDF', async () => {
    for (const [label, magic] of [['PNG image', '89504e47'], ['SVG vector', '3c737667'], ['PDF', '25504446']]) {
      await a.getByRole('button', { name: 'Export' }).click();
      const dl = a.waitForEvent('download');
      await a.getByRole('menuitem', { name: label }).click();
      const stream = await (await dl).createReadStream();
      const first = await new Promise<Buffer>((r) => stream.once('data', (c) => r(c as Buffer)));
      stream.destroy();
      assert.equal(first.subarray(0, 4).toString('hex'), magic, label);
    }
  });

  await step('the editor has no leftover features', async () => {
    for (const gone of ['Share', 'Comments', 'Version history', 'Present', 'Draw', 'Eraser', 'Snap to grid']) {
      assert.equal(await a.getByRole('button', { name: gone, exact: true }).count(), 0, gone);
    }
    assert.equal(await a.getByRole('tab').count(), 0);
  });

  await step('saved diagrams can be reopened from home', async () => {
    await a.goto(BASE);
    await a.waitForSelector('.recent .file-card', { timeout: 5000 });
    await a.waitForFunction(() => [...document.querySelectorAll('.recent img')].every((i) => (i as HTMLImageElement).complete));
    await shot(a, 'home-with-diagrams');
  });

  await step('a diagram drawn through MCP can be edited by hand without rearranging it', async () => {
    const id = await a.evaluate(async () => {
      const json = { 'Content-Type': 'application/json' };
      const f = await (await fetch('/api/v1/files', { method: 'POST', headers: json, body: JSON.stringify({ title: 'RAG architecture' }) })).json();
      const code = 'direction right\nDocs [icon: file]\nRAG {\n  Embedder [icon: cpu]\n  Index [icon: database, label: "Vector DB"]\n}\nLLM [icon: cpu, description: "Writes the answer"]\nDocs > Embedder: chunks\nEmbedder > Index: vectors\nIndex > LLM';
      await fetch(`/api/v1/files/${f.id}/diagrams`, { method: 'POST', headers: json, body: JSON.stringify({ type: 'architecture', code, title: 'RAG architecture' }) });
      return f.id;
    });
    await a.goto(`${BASE}/f/${id}`);
    await part(a, 'LLM').waitFor();
    await a.waitForTimeout(300);
    const before = { llm: await boxOf(a, 'LLM') };
    await part(a, 'Docs').click();
    await a.getByLabel('Component name', { exact: true }).fill('Documents');
    await until(a, (e) => /label: Documents/.test(e.code), 'rename');
    const from = middle(await boxOf(a, 'Docs')), to = middle(await boxOf(a, 'LLM'));
    await a.getByRole('button', { name: 'Connect', exact: true }).click();
    await dragBy(a, from.x, from.y, to.x, to.y);
    await a.keyboard.press('Escape');
    await until(a, (e) => /Docs > LLM/.test(e.code), 'new connection');
    const llm = await boxOf(a, 'LLM');
    near(llm.x, before.llm.x, 3);
    near(llm.y, before.llm.y, 3);
    await (await item(a, 'Cache')).dragTo(a.locator('.canvas'), { targetPosition: { x: 420, y: 420 } });
    await until(a, (e) => /Cache/.test(e.code), 'new component on an MCP diagram');
    await part(a, 'Cache').waitFor();
    const canvasBox = (await a.locator('.canvas').boundingBox())!;
    const cacheBox = await boxOf(a, 'Cache');
    assert.ok(cacheBox.x >= canvasBox.x && cacheBox.x + cacheBox.width <= canvasBox.x + canvasBox.width, 'a clicked component lands in view, not behind the panel');
    for (const name of ['Docs', 'LLM']) {
      const other = await boxOf(a, name);
      assert.ok(cacheBox.x > other.x + other.width || cacheBox.x + cacheBox.width < other.x || cacheBox.y > other.y + other.height || cacheBox.y + cacheBox.height < other.y, `it doesn't land on ${name}`);
    }
    assert.equal((await a.evaluate(async (fid) => (await (await fetch(`/api/v1/files/${fid}/elements`)).json()).length, fileIdOf(a))), 1, 'added to the same diagram');
    await shot(a, 'mcp-edited');
  });

  await step('older files open: other diagram types and shapes still work', async () => {
    await a.goto(BASE);
    const id = await a.evaluate(async () => {
      const json = { 'Content-Type': 'application/json' };
      const f = await (await fetch('/api/v1/files', { method: 'POST', headers: json, body: JSON.stringify({ title: 'Older file' }) })).json();
      await fetch(`/api/v1/files/${f.id}`, { method: 'PATCH', headers: json, body: JSON.stringify({ elements: [{ id: 'old', type: 'shape', x: 900, y: 40, w: 160, h: 90, z: 1, text: 'Old shape' }] }) });
      for (const [type, code] of [['flowchart', 'Start > Stop'], ['bpmn', 'Team {\n  Begin [type: event]\n  Work [type: activity]\n}\nBegin > Work']]) await fetch(`/api/v1/files/${f.id}/diagrams`, { method: 'POST', headers: json, body: JSON.stringify({ type, code, title: type }) });
      return f.id;
    });
    await a.goto(`${BASE}/f/${id}`);
    await part(a, 'Start').waitFor();
    await part(a, 'Begin').waitFor();
    await part(a, 'Start').click();
    await a.getByLabel('Component name', { exact: true }).fill('Begin here');
    await until(a, (e) => /Begin here/.test(e.code), 'flow chart still edits');
    await a.waitForTimeout(200);
    await shot(a, 'older-file');
    const shape = (await a.locator('.canvas [data-id="old"]').boundingBox())!;
    await a.mouse.click(shape.x + shape.width / 2, shape.y + shape.height / 2);
    await a.getByRole('complementary', { name: 'Properties' }).getByRole('button', { name: 'Delete' }).click();
    await a.waitForTimeout(200);
    assert.equal(await a.locator('.canvas [data-id="old"]').count(), 0);
  });

  await step('a diagram drawn through MCP appears live in an open editor', async () => {
    await a.goto(BASE);
    await a.getByRole('button', { name: /Draw Manually/ }).click();
    await a.waitForURL(/\/f\//);
    await a.waitForSelector('.canvas-empty');
    const id = fileIdOf(a);
    await fetch(`${BASE}/api/v1/files/${id}/diagrams`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'architecture', code: 'FromMcp [icon: server]', title: 'MCP' }) });
    await part(a, 'FromMcp').waitFor({ timeout: 5000 });
  });

  await step('dark mode applies to the app and canvas', async () => {
    await a.getByRole('button', { name: 'Switch theme' }).click();
    assert.equal(await a.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await a.waitForTimeout(200);
    await shot(a, 'dark-editor');
    await a.goto(BASE);
    await a.waitForSelector('.choices');
    await a.waitForTimeout(300);
    await shot(a, 'dark-home');
    await a.getByRole('button', { name: 'Switch theme' }).click();
  });

  await step('deleting from home asks first and removes the diagram', async () => {
    await a.goto(BASE);
    await a.waitForSelector('.recent .file-card');
    const n = await a.locator('.recent .file-card').count();
    await a.locator('.recent .file-card').first().hover();
    await a.locator('.recent .file-delete').first().click();
    await a.waitForFunction((c) => document.querySelectorAll('.recent .file-card').length === c - 1, n);
  });

  await step('PWA: Chrome reports it installable, with a valid manifest', async () => {
    await a.goto(BASE);
    await a.evaluate(() => navigator.serviceWorker.ready);
    const cdp = await a.context().newCDPSession(a);
    const { errors } = await cdp.send('Page.getAppManifest') as any;
    assert.deepEqual(errors, [], 'manifest errors');
    // Normal test contexts count as incognito, where Chrome never offers install, so this needs a real profile.
    const profile = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'devart-profile-')), { channel: 'chrome', headless: true });
    try {
      const page = await profile.newPage();
      await page.goto(BASE);
      await page.evaluate(() => navigator.serviceWorker.ready);
      const session = await profile.newCDPSession(page);
      const { installabilityErrors } = await session.send('Page.getInstallabilityErrors') as any;
      assert.deepEqual(installabilityErrors, [], 'installability errors');
    } finally {
      await profile.close();
    }
    for (const icon of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) {
      const r = await fetch(`${BASE}/${icon}`);
      assert.equal(r.headers.get('content-type'), 'image/png', icon);
    }
  });

  await step('PWA: the app opens and edits offline, then syncs when back', async () => {
    const c = await open();
    await c.goto(BASE);
    await c.evaluate(() => navigator.serviceWorker.ready);
    await c.reload();
    await c.waitForFunction(() => !!navigator.serviceWorker.controller);
    await c.waitForSelector('.choices');
    const made = await c.evaluate(async () => {
      const file = async (title: string) => (await (await fetch('/api/v1/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) })).json()).id;
      return { opened: await file('Opened before'), unopened: await file('Never opened') };
    });
    await c.goto(`${BASE}/f/${made.opened}`);
    await c.waitForSelector('.canvas');
    await c.waitForTimeout(800);

    await c.context().setOffline(true);
    await c.reload();
    await c.waitForSelector('.canvas');
    await c.waitForSelector('.save-state:has-text("Offline"), .save-state:has-text("Connecting")');
    await c.waitForSelector('.pwa-status:has-text("saved copy")');
    await (await item(c, 'Service')).dragTo(c.locator('.canvas'), { targetPosition: { x: 420, y: 420 } });
    await part(c, 'Service').waitFor();
    await c.waitForTimeout(500);
    await shot(c, 'offline');

    await c.reload();
    await part(c, 'Service').waitFor();
    await c.goto(`${BASE}/f/${made.unopened}`);
    await c.waitForSelector('h2:has-text("available offline")');

    await c.context().setOffline(false);
    await c.goto(`${BASE}/f/${made.opened}`);
    await c.waitForFunction(async (id) => {
      const f = await (await fetch(`/api/v1/files/${id}`, { cache: 'no-store' })).json();
      return JSON.stringify(f.elements).includes('Service');
    }, made.opened, { timeout: 8000, polling: 300 });
    await c.waitForFunction(() => !document.querySelector('.pwa-status'), undefined, { timeout: 8000 });
    await c.context().close();
  });

  await step('narrow windows keep every screen usable', async () => {
    const m = await open(390, 800);
    const noOverflow = async () => assert.equal(await m.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal page scroll');
    await m.goto(BASE);
    await m.waitForSelector('.choices');
    await shot(m, 'mobile-home');
    await noOverflow();
    await m.getByRole('button', { name: /Draw Manually/ }).click();
    await m.waitForURL(/\/f\//);
    assert.equal(await m.locator('.insert-pop').count(), 0, 'the insert menu starts closed');
    await (await item(m, 'Service')).dragTo(m.locator('.canvas'), { targetPosition: { x: 150, y: 450 } });
    await part(m, 'Service').waitFor();
    await m.waitForTimeout(200);
    await shot(m, 'mobile-editor');
    await noOverflow();
    await m.locator('.canvas').click({ position: { x: 300, y: 250 } }); // deselect so the properties sheet does not cover the drop spot
    await (await item(m, 'Database')).dragTo(m.locator('.canvas'), { targetPosition: { x: 300, y: 550 } });
    await part(m, 'Database').waitFor();
    await m.waitForTimeout(200);
    await shot(m, 'mobile-editor-2');
    const canvas = (await m.locator('.canvas').boundingBox())!;
    const added = await boxOf(m, 'Database');
    assert.ok(added.x >= canvas.x && added.x + added.width <= canvas.x + canvas.width, 'a clicked component lands in view');
    await m.context().close();
  });
} finally {
  await browser.close();
  proc.kill();
}
console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed. Screenshots: ${out}`);
if (problems.length) console.log('Browser errors:\n' + [...new Set(problems)].join('\n'));
process.exit(results.some((r) => r.startsWith('FAIL')) || problems.length ? 1 : 0);
