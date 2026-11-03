import express, { type NextFunction, type Request, type Response } from 'express';
import { originAllowed } from './access.ts';
import { all, newId, newToken, one, run } from './db.ts';
import { CLOSE_GONE, closeConnections, dropLive, flush, mutate, readContent, replaceContent, yElements } from './live.ts';
import { canvasSvg, convert, diagramSvg, type ExportFormat } from './exporter.ts';
import { renderDiagram, diagramSize, elementBounds } from '../shared/render.ts';
import { SYNTAX_REFERENCE } from '../shared/dsl.ts';
import { ICON_ALIASES, ICON_NAMES } from '../shared/icons.ts';
import { DIAGRAM_TYPES, type CanvasElement, type DiagramType, type Theme } from '../shared/types.ts';

interface Authed extends Request { user?: any; team?: string }

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const bad = (m: string) => new HttpError(400, m);
const denied = (m: string) => new HttpError(403, m);
const notFound = (m = 'Not found') => new HttpError(404, m);

/** DevArt has no accounts: every request acts as one local user. The earliest user fills that role, so older data stays reachable. */
export function localUser() {
  const existing = one('SELECT * FROM users ORDER BY created_at LIMIT 1');
  if (existing) return existing;
  const id = newId(), teamId = newId(), now = Date.now();
  run('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?,?,?,?,?)', id, 'local@devart.invalid', 'You', '', now);
  run('INSERT INTO teams (id, name, created_at) VALUES (?,?,?)', teamId, 'My workspace', now);
  run('INSERT INTO team_members (team_id, user_id, role) VALUES (?,?,?)', teamId, id, 'owner');
  return one('SELECT * FROM users WHERE id = ?', id)!;
}

const publicUser = (u: any) => ({ id: u.id, email: u.email, name: u.name, theme: u.theme });

function loadFile(req: Authed, allowDeleted = false) {
  const file = one('SELECT id, team_id, title, created_at, updated_at, deleted_at FROM files WHERE id = ?', req.params.id);
  if (!file || (file.deleted_at && !allowDeleted)) throw notFound('Diagram not found');
  return file;
}

const fileJson = (f: any) => ({ id: f.id, title: f.title, createdAt: f.created_at, updatedAt: f.updated_at, deletedAt: f.deleted_at ?? undefined });
const elementsOf = (fileId: string): CanvasElement[] => JSON.parse(readContent(fileId)?.canvas ?? '[]');

function createFile(teamId: string, ownerId: string, title: string) {
  const id = newId(), now = Date.now();
  run('INSERT INTO files (id, team_id, owner_id, title, share_token, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', id, teamId, ownerId, title || 'Untitled', newToken(), now, now);
  return one('SELECT * FROM files WHERE id = ?', id)!;
}

const isType = (t: unknown): t is DiagramType => DIAGRAM_TYPES.includes(t as DiagramType);
const themeOf = (t: unknown): Theme => (t === 'dark' ? 'dark' : 'light');

/** Places a new element clear of existing content so diagrams drawn through MCP don't overlap. */
function placed(fileId: string, w: number) {
  const els = elementsOf(fileId);
  const b = elementBounds(els);
  return { x: b ? b.x : 0, y: b ? b.y + b.h + 60 : 0, z: Math.max(0, ...els.map((e) => e.z)) + 1, w };
}

function diagramJson(e: CanvasElement) {
  const r = renderDiagram(e.diagramType ?? 'architecture', e.code ?? '', { nodeOffsets: e.nodeOffsets });
  return { id: e.id, title: e.title, type: e.diagramType, code: e.code, x: e.x, y: e.y, width: e.w, height: e.h, issues: r.issues };
}

const wrap = (fn: (req: Authed, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve().then(() => fn(req as Authed, res)).then((out) => {
    if (out !== undefined && !res.headersSent) res.json(out);
  }).catch(next);
};

export function buildApi() {
  const r = express.Router();
  r.use(express.json({ limit: '10mb' }));

  r.use((req: Authed, _res, next) => {
    try {
      req.user = localUser();
      // With no credentials to protect it, a write must not come from another website open in the browser.
      if (!['GET', 'HEAD'].includes(req.method) && !originAllowed(req.headers.origin, req.headers.host)) throw denied('Cross-origin request blocked');
      req.team = one('SELECT team_id FROM team_members WHERE user_id = ? ORDER BY rowid LIMIT 1', req.user.id)?.team_id as string;
      next();
    } catch (e) { next(e); }
  });

  r.get('/me', wrap((req) => publicUser(req.user)));
  r.patch('/me', wrap((req) => {
    if (req.body?.theme) run('UPDATE users SET theme = ? WHERE id = ?', themeOf(req.body.theme), req.user.id);
    return publicUser(one('SELECT * FROM users WHERE id = ?', req.user.id));
  }));

  // ---- files ----
  r.get('/files', wrap((req) => {
    const q = req.query.q ? `%${String(req.query.q).replace(/[%_\\]/g, '\\$&')}%` : null;
    // A manual drawing abandoned before anything was added isn't worth listing.
    const rows = all(`SELECT id, title, created_at, updated_at, deleted_at FROM files WHERE team_id = ? AND deleted_at IS NULL AND NOT (canvas = '[]' AND title = 'Untitled architecture')
      ${q ? `AND (title LIKE ? ESCAPE '\\' OR canvas LIKE ? ESCAPE '\\')` : ''} ORDER BY updated_at DESC LIMIT 500`, req.team, ...(q ? [q, q] : []));
    return rows.map(fileJson);
  }));
  r.post('/files', wrap((req) => fileJson(createFile(req.team!, req.user.id, String(req.body?.title ?? '').slice(0, 200)))));
  r.get('/files/:id', wrap((req) => {
    const file = loadFile(req);
    flush(file.id);
    return { ...fileJson(file), elements: elementsOf(file.id) };
  }));
  r.patch('/files/:id', wrap((req) => {
    const file = loadFile(req);
    const { title, elements } = req.body ?? {};
    if (title !== undefined) run('UPDATE files SET title = ?, updated_at = ? WHERE id = ?', String(title).slice(0, 200) || 'Untitled', Date.now(), file.id);
    if (elements !== undefined) {
      if (!Array.isArray(elements)) throw bad('elements must be an array');
      mutate(file.id, (d) => replaceContent(d, { canvas: elements }));
    }
    return fileJson(one('SELECT * FROM files WHERE id = ?', file.id));
  }));
  // Deleting only marks the file, so it can still be brought back through the restore route.
  r.delete('/files/:id', wrap((req) => {
    const file = loadFile(req);
    closeConnections(file.id, CLOSE_GONE);
    run('UPDATE files SET deleted_at = ? WHERE id = ?', Date.now(), file.id);
    return { ok: true };
  }));
  r.post('/files/:id/restore', wrap((req) => {
    const file = loadFile(req, true);
    run('UPDATE files SET deleted_at = NULL WHERE id = ?', file.id);
    return { ok: true };
  }));

  // ---- diagrams ----
  r.get('/files/:id/elements', wrap((req) => elementsOf(loadFile(req).id)));
  r.get('/files/:id/diagrams', wrap((req) => elementsOf(loadFile(req).id).filter((e) => e.type === 'diagram').map(diagramJson)));
  r.post('/files/:id/diagrams', wrap((req) => {
    const file = loadFile(req);
    const { type, code, title } = req.body ?? {};
    if (!isType(type)) throw bad(`type must be one of: ${DIAGRAM_TYPES.join(', ')}`);
    if (typeof code !== 'string') throw bad('code must be a string');
    const size = diagramSize({ diagramType: type, code });
    const el: CanvasElement = { ...placed(file.id, size.w), ...size, id: newId(), type: 'diagram', diagramType: type, code, title: title ?? 'Diagram' };
    mutate(file.id, (d) => yElements(d).set(el.id, el));
    return diagramJson(el);
  }));
  r.patch('/files/:id/elements/:elId', wrap((req) => {
    const file = loadFile(req);
    const cur = elementsOf(file.id).find((e) => e.id === req.params.elId);
    if (!cur) throw notFound('Element not found');
    if (cur.type !== 'diagram') throw bad('Only diagrams can be changed here');
    const next: CanvasElement = { ...cur };
    for (const k of ['title', 'code'] as const) if (req.body?.[k] !== undefined) next[k] = String(req.body[k]);
    Object.assign(next, diagramSize(next));
    mutate(file.id, (d) => yElements(d).set(next.id, next));
    return diagramJson(next);
  }));

  // ---- render and export ----
  r.post('/render', wrap(async (req, res) => {
    const { type, code, theme, format, scale } = req.body ?? {};
    if (!isType(type)) throw bad(`type must be one of: ${DIAGRAM_TYPES.join(', ')}`);
    if (typeof code !== 'string') throw bad('code must be a string');
    const out = diagramSvg(type, code, { theme: themeOf(theme) });
    if (!format || format === 'json') return out;
    if (!['svg', 'png', 'pdf'].includes(format)) throw bad('format must be json, svg, png, or pdf');
    const c = await convert(out.svg, out.width, out.height, format as ExportFormat, Number(scale) || undefined);
    res.type(c.mime).send(c.body);
  }));
  r.get('/syntax', wrap(() => ({ types: DIAGRAM_TYPES, reference: SYNTAX_REFERENCE, icons: ICON_NAMES, iconAliases: ICON_ALIASES })));

  r.get('/files/:id/export', wrap(async (req, res) => {
    const file = loadFile(req);
    const format = String(req.query.format ?? 'svg');
    const c = readContent(file.id)!;
    const safeName = file.title.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'devart';
    const attach = (ext: string) => res.setHeader('Content-Disposition', `attachment; filename="${safeName}.${ext}"`);
    // Text and map data from before DevArt focused on diagrams stays in files, and these two formats still return it.
    if (format === 'md') { attach('md'); return void res.type('text/markdown').send(c.doc); }
    if (format === 'json') {
      attach('devart.json');
      return void res.json({ format: 'devart', version: 1, title: file.title, doc: c.doc, elements: JSON.parse(c.canvas), map: c.map ? JSON.parse(c.map) : null });
    }
    if (!['svg', 'png', 'pdf'].includes(format)) throw bad('format must be svg, png, pdf, md, or json');
    const only = req.query.elementId as string | undefined;
    const els = JSON.parse(c.canvas) as CanvasElement[];
    if (only && !els.some((e) => e.id === only)) throw notFound('Element not found');
    const out = canvasSvg(els, { only, theme: themeOf(req.query.theme), background: req.query.background !== '0' });
    const res2 = await convert(out.svg, out.width, out.height, format as ExportFormat, Number(req.query.scale) || undefined);
    attach(format);
    res.type(res2.mime).send(res2.body);
  }));

  r.use((_req, _res, next) => next(notFound('No such endpoint')));
  r.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof HttpError ? err.status : err.status ?? err.statusCode ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong on the server' : err.message });
  });
  return r;
}
