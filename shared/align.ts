// Pure geometry for arranging boxes: align, distribute, and the smart guides shown while dragging.
import type { Point } from './types.ts';

export interface Box { x: number; y: number; w: number; h: number }
export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
/** A guide line in canvas coordinates. `axis: 'x'` is a vertical line at x = `at`, running from `from` to `to` along y. */
export interface Guide { axis: 'x' | 'y'; at: number; from: number; to: number }

export function unionBox(boxes: Iterable<Box>): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** How far each box moves to line up with the others' combined bounds. */
export function alignDeltas(boxes: Map<string, Box>, mode: AlignMode): Map<string, Point> {
  const out = new Map<string, Point>();
  const u = unionBox(boxes.values());
  if (!u) return out;
  for (const [id, b] of boxes) {
    let dx = 0, dy = 0;
    if (mode === 'left') dx = u.x - b.x;
    else if (mode === 'center') dx = u.x + u.w / 2 - (b.x + b.w / 2);
    else if (mode === 'right') dx = u.x + u.w - (b.x + b.w);
    else if (mode === 'top') dy = u.y - b.y;
    else if (mode === 'middle') dy = u.y + u.h / 2 - (b.y + b.h / 2);
    else dy = u.y + u.h - (b.y + b.h);
    out.set(id, { x: dx, y: dy });
  }
  return out;
}

/** Spaces boxes with equal gaps along an axis. The first and last boxes stay where they are. */
export function distributeDeltas(boxes: Map<string, Box>, axis: 'x' | 'y'): Map<string, Point> {
  const out = new Map<string, Point>();
  const items = [...boxes].map(([id, b]) => ({ id, start: axis === 'x' ? b.x : b.y, size: axis === 'x' ? b.w : b.h }));
  for (const it of items) out.set(it.id, { x: 0, y: 0 });
  if (items.length < 3) return out;
  items.sort((a, b) => a.start - b.start || a.size - b.size);
  const first = items[0], last = items.at(-1)!;
  const span = last.start + last.size - first.start;
  const gap = (span - items.reduce((s, it) => s + it.size, 0)) / (items.length - 1);
  let at = first.start + first.size + gap;
  for (const it of items.slice(1, -1)) {
    const d = at - it.start;
    out.set(it.id, axis === 'x' ? { x: d, y: 0 } : { x: 0, y: d });
    at += it.size + gap;
  }
  return out;
}

const xs = (b: Box) => [b.x, b.x + b.w / 2, b.x + b.w];
const ys = (b: Box) => [b.y, b.y + b.h / 2, b.y + b.h];

/** The smallest shift (within `threshold`) that lines an edge or centre of `moving` up with one of `others`. */
export function snapToGuides(moving: Box, others: Box[], threshold: number): { dx?: number; dy?: number } {
  const best = (mine: number[], theirs: (b: Box) => number[]) => {
    let d: number | undefined;
    for (const o of others) for (const t of theirs(o)) for (const m of mine) {
      const diff = t - m;
      if (Math.abs(diff) <= threshold && (d === undefined || Math.abs(diff) < Math.abs(d))) d = diff;
    }
    return d;
  };
  return { dx: best(xs(moving), xs), dy: best(ys(moving), ys) };
}

/** Guide lines for every edge or centre of `moving` that lines up (within `eps`) with one of `others`. */
export function guidesFor(moving: Box, others: Box[], eps = 0.5): Guide[] {
  const out: Guide[] = [];
  const seen = new Map<string, Guide>();
  const add = (axis: 'x' | 'y', at: number, a0: number, a1: number, b0: number, b1: number) => {
    const key = `${axis}:${Math.round(at * 2) / 2}`;
    const g = seen.get(key);
    const from = Math.min(a0, b0), to = Math.max(a1, b1);
    if (g) { g.from = Math.min(g.from, from); g.to = Math.max(g.to, to); return; }
    const fresh = { axis, at, from, to };
    seen.set(key, fresh);
    out.push(fresh);
  };
  for (const o of others) {
    for (const m of xs(moving)) for (const t of xs(o)) if (Math.abs(m - t) <= eps) add('x', t, moving.y, moving.y + moving.h, o.y, o.y + o.h);
    for (const m of ys(moving)) for (const t of ys(o)) if (Math.abs(m - t) <= eps) add('y', t, moving.x, moving.x + moving.w, o.x, o.x + o.w);
  }
  return out;
}
