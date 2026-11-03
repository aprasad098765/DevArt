// Holds one authoritative Y.Doc per open file. Browser sync, REST and MCP writes all pass through it.
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import type { WebSocket } from 'ws';
import { one, run } from './db.ts';
import type { CanvasElement, MapModel } from '../shared/types.ts';

const MSG_SYNC = 0, MSG_AWARENESS = 1;
const FLUSH_MS = 800, EVICT_MS = 60_000;

interface Conn { ws: WebSocket; clientIds: Set<number> }
interface Live {
  id: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  conns: Set<Conn>;
  flushTimer?: NodeJS.Timeout;
  evictTimer?: NodeJS.Timeout;
  dirty: boolean;
}
const lives = new Map<string, Live>();

export const yElements = (d: Y.Doc) => d.getMap<CanvasElement>('elements');
export const yDocText = (d: Y.Doc) => d.getText('doc');
export const yMap = (d: Y.Doc) => d.getMap<MapModel>('map');

export function materialize(d: Y.Doc) {
  return {
    doc: yDocText(d).toString(),
    canvas: JSON.stringify([...yElements(d).values()]),
    map: yMap(d).get('model') ? JSON.stringify(yMap(d).get('model')) : '',
  };
}

export function replaceContent(d: Y.Doc, content: { doc?: string; canvas?: CanvasElement[]; map?: MapModel | null }) {
  d.transact(() => {
    if (content.doc !== undefined) {
      const t = yDocText(d);
      t.delete(0, t.length);
      t.insert(0, content.doc);
    }
    if (content.canvas) {
      const els = yElements(d);
      for (const k of [...els.keys()]) els.delete(k);
      for (const e of content.canvas) els.set(e.id, e);
    }
    if (content.map !== undefined) {
      if (content.map) yMap(d).set('model', content.map);
      else yMap(d).delete('model');
    }
  }, 'server');
}

function send(ws: WebSocket, data: Uint8Array) {
  if (ws.readyState === ws.OPEN) ws.send(data, (err) => { if (err) ws.close(); });
}

export function getLive(id: string): Live {
  let live = lives.get(id);
  if (live) return live;
  const row = one('SELECT ystate, doc, canvas, map FROM files WHERE id = ?', id);
  if (!row) throw new Error('file not found');
  const doc = new Y.Doc();
  if (row.ystate) Y.applyUpdate(doc, new Uint8Array(row.ystate));
  else {
    replaceContent(doc, { doc: row.doc, canvas: JSON.parse(row.canvas), map: row.map ? JSON.parse(row.map) : null });
    // Save the seeded state now. Regenerating it on a later load would create new CRDT ids, and a browser's
    // saved copy would then merge in as duplicate content.
    run('UPDATE files SET ystate = ? WHERE id = ?', Y.encodeStateAsUpdate(doc), id);
  }
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null);
  live = { id, doc, awareness, conns: new Set(), dirty: false };
  const l = live;
  doc.on('update', (update: Uint8Array) => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeUpdate(enc, update);
    const msg = encoding.toUint8Array(enc);
    for (const c of l.conns) send(c.ws, msg);
    l.dirty = true;
    if (!l.flushTimer) l.flushTimer = setTimeout(() => flush(id), FLUSH_MS);
  });
  awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    const changed = [...added, ...updated, ...removed];
    if (origin && typeof origin === 'object' && 'clientIds' in origin) {
      for (const cid of added) (origin as Conn).clientIds.add(cid);
      for (const cid of removed) (origin as Conn).clientIds.delete(cid);
    }
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_AWARENESS);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
    const msg = encoding.toUint8Array(enc);
    for (const c of l.conns) send(c.ws, msg);
  });
  lives.set(id, live);
  scheduleEvict(live);
  return live;
}

/** Writes pending changes to SQLite. */
export function flush(id: string) {
  const l = lives.get(id);
  if (!l) return;
  clearTimeout(l.flushTimer);
  l.flushTimer = undefined;
  if (!l.dirty) return;
  l.dirty = false;
  const m = materialize(l.doc);
  run('UPDATE files SET ystate = ?, doc = ?, canvas = ?, map = ?, updated_at = ? WHERE id = ?', Y.encodeStateAsUpdate(l.doc), m.doc, m.canvas, m.map, Date.now(), id);
}

function scheduleEvict(l: Live) {
  clearTimeout(l.evictTimer);
  l.evictTimer = setTimeout(() => {
    if (l.conns.size) return;
    flush(l.id);
    l.awareness.destroy();
    l.doc.destroy();
    lives.delete(l.id);
  }, EVICT_MS);
  l.evictTimer.unref?.();
}

/** Applies a server-side change, broadcasts it to open editors, and persists before returning. */
export function mutate(id: string, fn: (d: Y.Doc) => void) {
  const l = getLive(id);
  l.doc.transact(() => fn(l.doc), 'server');
  flush(id);
  scheduleEvict(l);
}

export function readContent(id: string) {
  const l = lives.get(id);
  if (l) return materialize(l.doc);
  const row = one('SELECT doc, canvas, map FROM files WHERE id = ?', id);
  return row ? { doc: row.doc as string, canvas: row.canvas as string, map: row.map as string } : null;
}

export function dropLive(id: string) {
  const l = lives.get(id);
  if (!l) return;
  for (const c of l.conns) c.ws.close(CLOSE_GONE, 'file removed');
  clearTimeout(l.flushTimer);
  clearTimeout(l.evictTimer);
  l.awareness.destroy();
  l.doc.destroy();
  lives.delete(id);
}

// y-websocket stops retrying on 4400-4499, which ends the session for a deleted file.
export const CLOSE_GONE = 4404;

export function closeConnections(id: string, code = CLOSE_GONE) {
  const l = lives.get(id);
  if (l) for (const c of l.conns) c.ws.close(code, 'file removed');
}

export function attachConnection(id: string, ws: WebSocket) {
  const l = getLive(id);
  clearTimeout(l.evictTimer);
  const conn: Conn = { ws, clientIds: new Set() };
  l.conns.add(conn);
  ws.binaryType = 'arraybuffer';

  ws.on('message', (raw: ArrayBuffer) => {
    try {
      const dec = decoding.createDecoder(new Uint8Array(raw));
      const kind = decoding.readVarUint(dec);
      if (kind === MSG_SYNC) {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_SYNC);
        syncProtocol.readSyncMessage(dec, enc, l.doc, conn);
        if (encoding.length(enc) > 1) send(ws, encoding.toUint8Array(enc));
      } else if (kind === MSG_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(l.awareness, decoding.readVarUint8Array(dec), conn);
      }
    } catch {
      ws.close(1003, 'bad message');
    }
  });
  ws.on('close', () => {
    l.conns.delete(conn);
    awarenessProtocol.removeAwarenessStates(l.awareness, [...conn.clientIds], null);
    if (!l.conns.size) { flush(id); scheduleEvict(l); }
  });

  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MSG_SYNC);
  syncProtocol.writeSyncStep1(enc, l.doc);
  send(ws, encoding.toUint8Array(enc));
  const states = [...l.awareness.getStates().keys()];
  if (states.length) {
    const a = encoding.createEncoder();
    encoding.writeVarUint(a, MSG_AWARENESS);
    encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(l.awareness, states));
    send(ws, encoding.toUint8Array(a));
  }
}

export function flushAll() {
  for (const id of lives.keys()) flush(id);
}

