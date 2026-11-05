// Connector routing for graph diagrams: orthogonal (elbow) paths that keep clear of other shapes, spread
// their attachment points along a side, share a trunk when fanning out, and get small rounded corners.
// Pure and DOM-free so it runs in the browser and Node alike and can be unit-tested on its own.
import type { Point } from './types.ts';

export type Side = 'top' | 'right' | 'bottom' | 'left';
export type Routing = 'elbow' | 'straight' | 'curved';
export type Direction = 'right' | 'down' | 'left' | 'up';
/** The outline an edge attaches to; anything else is treated as its bounding box. */
export type Outline = 'rect' | 'diamond' | 'ellipse';
export interface Box { x: number; y: number; w: number; h: number }

export interface RouteNode {
  id: string;
  box: Box;
  shape?: Outline;
  parent?: string;
  /** Containers are avoided only by edges that neither start nor end inside them, and cost less to cross. */
  group?: boolean;
  /** The area other edges keep out of, when it is larger than the box (a caption under an event, say). */
  keepOut?: Box;
}
export interface RouteEdge {
  from: string;
  to: string;
  routing?: Routing;
  /** Whether this edge may share a trunk with siblings leaving the same side; off for edges with a start arrowhead. */
  bundle?: boolean;
}
export interface RouteOptions {
  direction?: Direction;
  /** Space between a shape's outline and the end of a connector. */
  gap?: number;
  /** Length of the straight run leaving and entering a side before the first bend. */
  stub?: number;
  /** Clearance kept around other shapes. */
  margin?: number;
  /** Spacing given to parallel connectors that would otherwise run on top of each other. */
  spacing?: number;
}
export interface Route {
  routing: Routing;
  /** The polyline, or for a curve a sampled approximation of it. */
  points: Point[];
  /** Cubic Bezier controls for a curved route: start, control 1, control 2, end. */
  curve?: [Point, Point, Point, Point];
  fromSide?: Side;
  toSide?: Side;
  /** Edges with the same bundle key share their first run. */
  bundle?: string;
}

const NORMAL: Record<Side, Point> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };
const add = (a: Point, b: Point, k = 1): Point => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const centre = (b: Box): Point => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const horizontal = (s: Side) => s === 'left' || s === 'right';
const inflate = (b: Box, m: number): Box => ({ x: b.x - m, y: b.y - m, w: b.w + m * 2, h: b.h + m * 2 });

/** Which sides an edge leaves and enters by: facing sides, along the flow direction when there is room. */
export function pickSides(a: Box, b: Box, direction: Direction = 'right', room = 36): [Side, Side] {
  const gx = b.x >= a.x + a.w ? b.x - (a.x + a.w) : a.x >= b.x + b.w ? a.x - (b.x + b.w) : -1;
  const gy = b.y >= a.y + a.h ? b.y - (a.y + a.h) : a.y >= b.y + b.h ? a.y - (b.y + b.h) : -1;
  const ca = centre(a), cb = centre(b);
  const hor = (): [Side, Side] => (cb.x >= ca.x ? ['right', 'left'] : ['left', 'right']);
  const ver = (): [Side, Side] => (cb.y >= ca.y ? ['bottom', 'top'] : ['top', 'bottom']);
  const across = direction === 'right' || direction === 'left';
  if (across) { if (gx >= room) return hor(); if (gy >= room) return ver(); }
  else { if (gy >= room) return ver(); if (gx >= room) return hor(); }
  if (gx < 0 && gy < 0) return Math.abs(cb.x - ca.x) / (a.w + b.w) > Math.abs(cb.y - ca.y) / (a.h + b.h) ? hor() : ver();
  return gx >= gy ? hor() : ver();
}

/** A point on a box's side, `t` along it from the middle. */
function sidePoint(b: Box, side: Side, t: number): Point {
  const c = centre(b);
  if (side === 'top') return { x: c.x + t, y: b.y };
  if (side === 'bottom') return { x: c.x + t, y: b.y + b.h };
  if (side === 'left') return { x: b.x, y: c.y + t };
  return { x: b.x + b.w, y: c.y + t };
}

/** How far inside its bounding side a shape's outline lies, `t` along the side from the middle. */
function outlineDepth(b: Box, shape: Outline | undefined, side: Side, t: number) {
  const along = horizontal(side) ? b.h / 2 : b.w / 2, across = horizontal(side) ? b.w / 2 : b.h / 2;
  const u = Math.min(1, Math.abs(t) / (along || 1));
  if (shape === 'diamond') return across * u;
  if (shape === 'ellipse') return across * (1 - Math.sqrt(1 - u * u));
  return 0;
}

/** Half the length of a side that ports may use, keeping clear of corners and slanted ends. */
function halfSpan(b: Box, shape: Outline | undefined, side: Side) {
  const along = horizontal(side) ? b.h / 2 : b.w / 2;
  if (shape === 'diamond') return along * 0.35;
  if (shape === 'ellipse') return along * 0.5;
  return Math.max(0, along - Math.min(12, along / 3));
}

/** Where a ray from a shape's centre towards `to` leaves its outline, plus `gap`. */
function clipOutline(b: Box, shape: Outline | undefined, to: Point, gap: number): Point {
  const c = centre(b), dx = to.x - c.x, dy = to.y - c.y;
  if (!dx && !dy) return c;
  const rx = b.w / 2 || 1, ry = b.h / 2 || 1;
  const s = shape === 'diamond' ? 1 / (Math.abs(dx) / rx + Math.abs(dy) / ry)
    : shape === 'ellipse' ? 1 / Math.hypot(dx / rx, dy / ry)
    : Math.min(dx ? rx / Math.abs(dx) : Infinity, dy ? ry / Math.abs(dy) : Infinity);
  const len = Math.hypot(dx, dy);
  return { x: c.x + dx * s + (dx / len) * gap, y: c.y + dy * s + (dy / len) * gap };
}

/** Drops repeated points and the middle of straight runs. */
export function simplify(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    if (out.length && dist(out.at(-1)!, p) < 0.01) continue;
    if (out.length >= 2) {
      const a = out.at(-2)!, b = out.at(-1)!;
      const cross = (b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x);
      const dot = (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y);
      if (Math.abs(cross) < 0.01 && dot >= 0) { out[out.length - 1] = p; continue; }
    }
    out.push(p);
  }
  return out;
}

// ---- grid search ----

interface Obstacle { box: Box; weight: number }
const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
const dirOf = (p: Point) => (p.x > 0 ? 0 : p.y > 0 ? 1 : p.x < 0 ? 2 : 3);
const BEND = 40;

class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop(): number {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i, mk = lk;
        if (l < k.length && k[l] < mk) { m = l; mk = k[l]; }
        if (r < k.length && k[r] < mk) { m = r; mk = k[r]; }
        if (m === i) break;
        k[i] = k[m]; v[i] = v[m]; i = m;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

const uniqSorted = (vals: number[]) => {
  return [...new Set(vals.map((v) => Math.round(v * 100) / 100))].sort((a, b) => a - b);
};

/**
 * Cheapest orthogonal path from `s` (leaving in direction `sd`) to `t` (arriving in direction `td`), over the
 * grid formed by the obstacles' borders. Bends cost extra, crossing an obstacle costs a lot, and runs away
 * from the preferred lines through `pref` cost a little, so bends land midway between the ends.
 */
export function gridPath(s: Point, sd: Point, t: Point, td: Point, obstacles: Obstacle[], pref: Point): Point[] {
  const xs0 = [s.x, t.x, pref.x], ys0 = [s.y, t.y, pref.y];
  for (const { box } of obstacles) { xs0.push(box.x, box.x + box.w); ys0.push(box.y, box.y + box.h); }
  xs0.push(Math.min(...xs0) - 24, Math.max(...xs0) + 24);
  ys0.push(Math.min(...ys0) - 24, Math.max(...ys0) + 24);
  const xs = uniqSorted(xs0), ys = uniqSorted(ys0);
  const near = (arr: number[], v: number) => {
    let best = 0;
    for (let i = 1; i < arr.length; i++) if (Math.abs(arr[i] - v) < Math.abs(arr[best] - v)) best = i;
    return best;
  };
  const W = xs.length, H = ys.length;
  const sx = near(xs, s.x), sy = near(ys, s.y), tx = near(xs, t.x), ty = near(ys, t.y);
  const goalDir = dirOf(td);
  const N = W * H * 4;
  const g = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const done = new Uint8Array(N);
  const id = (ix: number, iy: number, d: number) => ((iy * W + ix) << 2) | d;
  const hEst = (ix: number, iy: number) => Math.abs(xs[ix] - xs[tx]) + Math.abs(ys[iy] - ys[ty]);
  const stepCost = (x0: number, y0: number, x1: number, y1: number, vertical: boolean) => {
    const len = Math.abs(x1 - x0) + Math.abs(y1 - y0);
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    let c = len + len * 0.002 * (vertical ? Math.abs(mx - pref.x) : Math.abs(my - pref.y));
    for (const o of obstacles) {
      const b = o.box;
      if (mx > b.x + 0.25 && mx < b.x + b.w - 0.25 && my > b.y + 0.25 && my < b.y + b.h - 0.25) c += len * o.weight + 30 * o.weight;
    }
    return c;
  };
  const start = id(sx, sy, dirOf(sd));
  g[start] = 0;
  const heap = new Heap();
  heap.push(hEst(sx, sy), start);
  let goal = -1;
  while (heap.size) {
    const u = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    const d = u & 3, cell = u >> 2, ix = cell % W, iy = (cell - ix) / W;
    if (ix === tx && iy === ty && d === goalDir) { goal = u; break; }
    const relax = (v: number, cost: number, nx: number, ny: number) => {
      if (cost < g[v]) { g[v] = cost; prev[v] = u; heap.push(cost + hEst(nx, ny), v); }
    };
    const nx = ix + DX[d], ny = iy + DY[d];
    if (nx >= 0 && nx < W && ny >= 0 && ny < H) relax(id(nx, ny, d), g[u] + stepCost(xs[ix], ys[iy], xs[nx], ys[ny], d % 2 === 1), nx, ny);
    relax(id(ix, iy, (d + 1) & 3), g[u] + BEND, ix, iy);
    relax(id(ix, iy, (d + 3) & 3), g[u] + BEND, ix, iy);
  }
  if (goal < 0) return [s, { x: pref.x, y: s.y }, { x: pref.x, y: t.y }, t];
  const cells: Point[] = [];
  for (let v = goal; v >= 0; v = prev[v]) {
    const cell = v >> 2, ix = cell % W, iy = (cell - ix) / W;
    // Grid lines are rounded; the lines through the ends snap back to the exact ends so runs stay straight.
    cells.push({ x: ix === sx ? s.x : ix === tx ? t.x : xs[ix], y: iy === sy ? s.y : iy === ty ? t.y : ys[iy] });
  }
  cells.reverse();
  cells[0] = s;
  cells[cells.length - 1] = t;
  return simplify(cells);
}

// ---- routing ----

interface Plan {
  i: number;
  e: RouteEdge;
  a: RouteNode;
  b: RouteNode;
  routing: Routing;
  fs: Side;
  ts: Side;
  ft: number;
  tt: number;
  bundle?: string;
  lead: number;
}

/** Routes every edge between the given nodes; edges with a missing or identical end get null. */
export function routeEdges(nodes: RouteNode[], edges: RouteEdge[], opts: RouteOptions = {}): (Route | null)[] {
  const gap = opts.gap ?? 3, stub = opts.stub ?? 18, margin = opts.margin ?? 12, spacing = opts.spacing ?? 8;
  const direction = opts.direction ?? 'right';
  const byId = new Map(nodes.map((x) => [x.id, x]));
  const ancestors = (id: string) => {
    const out = new Set<string>();
    for (let p = byId.get(id)?.parent; p && !out.has(p); p = byId.get(p)?.parent) out.add(p);
    return out;
  };
  const plans: (Plan | null)[] = edges.map((e, i) => {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b || a === b) return null;
    const routing = e.routing ?? 'elbow';
    const [fs, ts] = pickSides(a.box, b.box, direction, stub * 2);
    return { i, e, a, b, routing, fs, ts, ft: 0, tt: 0, lead: stub };
  });

  // Ports: edges sharing a side are spread along it in the order of their other ends, so they do not cross.
  type End = { p: Plan; end: 'from' | 'to' };
  const sides = new Map<string, End[]>();
  for (const p of plans) {
    if (!p || p.routing === 'straight') continue;
    for (const end of ['from', 'to'] as const) {
      const key = end === 'from' ? `${p.a.id}\0${p.fs}` : `${p.b.id}\0${p.ts}`;
      sides.set(key, [...(sides.get(key) ?? []), { p, end }]);
    }
  }
  const assign = (order: (x: End) => number) => {
    for (const [key, list] of sides) {
      const { p: p0, end: end0 } = list[0];
      const node = end0 === 'from' ? p0.a : p0.b, side = end0 === 'from' ? p0.fs : p0.ts;
      const fan = list.length > 1 && list.every((x) => x.end === 'from' && x.p.routing === 'elbow' && x.p.e.bundle !== false);
      if (fan) { for (const x of list) { x.p.ft = 0; x.p.bundle = key; } continue; }
      list.sort((x, y) => order(x) - order(y) || x.p.i - y.p.i);
      const half = halfSpan(node.box, node.shape, side);
      const step = Math.min((half * 2) / (list.length + 1), 36);
      list.forEach((x, j) => {
        const t = (j - (list.length - 1) / 2) * step;
        if (x.end === 'from') x.p.ft = t; else x.p.tt = t;
      });
    }
  };
  const along = (side: Side, pt: Point) => (horizontal(side) ? pt.y : pt.x);
  // An end alone on its side lines up with the other end when it can, so a near-straight edge has no tiny jog.
  const align = () => {
    for (const p of plans) {
      if (!p || p.routing === 'straight' || horizontal(p.fs) !== horizontal(p.ts) || p.fs === p.ts) continue;
      const alone = (id: string, side: Side) => sides.get(`${id}\0${side}`)?.length === 1;
      if (alone(p.b.id, p.ts)) {
        const want = along(p.fs, sidePoint(p.a.box, p.fs, p.ft)) - along(p.ts, centre(p.b.box));
        if (Math.abs(want) <= halfSpan(p.b.box, p.b.shape, p.ts)) { p.tt = want; continue; }
      }
      if (alone(p.a.id, p.fs)) {
        const want = along(p.ts, sidePoint(p.b.box, p.ts, p.tt)) - along(p.fs, centre(p.a.box));
        if (Math.abs(want) <= halfSpan(p.a.box, p.a.shape, p.fs)) p.ft = want;
      }
    }
  };
  assign((x) => along(x.end === 'from' ? x.p.fs : x.p.ts, centre((x.end === 'from' ? x.p.b : x.p.a).box)));
  align();

  // A fan-out runs together for part of the way to its nearest target, then splits.
  const setLeads = () => {
    const bundles = new Map<string, Plan[]>();
    for (const p of plans) if (p?.bundle) bundles.set(p.bundle, [...(bundles.get(p.bundle) ?? []), p]);
    for (const list of bundles.values()) {
      const n = NORMAL[list[0].fs], sb = sidePoint(list[0].a.box, list[0].fs, 0);
      const reach = list.map((p) => {
        const t1 = add(sidePoint(p.b.box, p.ts, p.tt), NORMAL[p.ts], stub);
        return (t1.x - sb.x) * n.x + (t1.y - sb.y) * n.y;
      }).filter((r) => r > stub * 2);
      // A third of the way leaves the branches room for their labels.
      const lead = reach.length ? Math.max(stub, Math.min(...reach) / 3) : stub;
      for (const p of list) p.lead = lead;
    }
  };
  setLeads();

  const route = (p: Plan): Route => {
    const { a, b } = p;
    if (p.routing === 'straight') {
      const P = clipOutline(a.box, a.shape, centre(b.box), gap), T = clipOutline(b.box, b.shape, centre(a.box), gap);
      return { routing: 'straight', points: [P, T] };
    }
    const n1 = NORMAL[p.fs], n2 = NORMAL[p.ts];
    const sb = sidePoint(a.box, p.fs, p.ft), tb = sidePoint(b.box, p.ts, p.tt);
    const P = add(sb, n1, gap - outlineDepth(a.box, a.shape, p.fs, p.ft));
    const T = add(tb, n2, gap - outlineDepth(b.box, b.shape, p.ts, p.tt));
    if (p.routing === 'curved') {
      const k = Math.min(160, Math.max(30, dist(P, T) * 0.4));
      const curve: Route['curve'] = [P, add(P, n1, k), add(T, n2, k), T];
      return { routing: 'curved', curve, points: sampleCurve(curve), fromSide: p.fs, toSide: p.ts };
    }
    const S1 = add(sb, n1, p.lead), T1 = add(tb, n2, stub);
    const pref = { x: (S1.x + T1.x) / 2, y: (S1.y + T1.y) / 2 };
    if (p.bundle) { if (horizontal(p.fs)) pref.x = S1.x; else pref.y = S1.y; }
    const skip = new Set([...ancestors(a.id), ...ancestors(b.id)]);
    const lo = { x: Math.min(S1.x, T1.x) - 160, y: Math.min(S1.y, T1.y) - 160 };
    const hi = { x: Math.max(S1.x, T1.x) + 160, y: Math.max(S1.y, T1.y) + 160 };
    const obstacles: Obstacle[] = [];
    for (const x of nodes) {
      if (skip.has(x.id)) continue;
      const box = inflate(x.keepOut ?? x.box, margin);
      if (box.x > hi.x || box.x + box.w < lo.x || box.y > hi.y || box.y + box.h < lo.y) continue;
      obstacles.push({ box, weight: x.group ? 2 : 20 });
    }
    const mid = gridPath(S1, n1, T1, { x: -n2.x, y: -n2.y }, obstacles, pref);
    return { routing: 'elbow', points: simplify([P, ...mid, T]), fromSide: p.fs, toSide: p.ts, bundle: p.bundle };
  };

  let routes = plans.map((p) => (p ? route(p) : null));
  // Second pass: re-order each side's ports by where their routes actually head, which untangles crossings.
  if ([...sides.values()].some((l) => l.length > 1)) {
    const heading = (x: End) => {
      const r = routes[x.p.i];
      if (!r || r.points.length < 2) return 0;
      const pts = x.end === 'from' ? r.points : [...r.points].reverse();
      const side = x.end === 'from' ? x.p.fs : x.p.ts;
      // The first point that moves off the side's axis tells which way the route turns.
      const base = pts[0];
      for (const q of pts.slice(1)) if (Math.abs(along(side, q) - along(side, base)) > 0.5) return along(side, q);
      return along(side, pts.at(-1)!);
    };
    const keys = new Map<End, number>();
    for (const list of sides.values()) for (const x of list) keys.set(x, heading(x));
    assign((x) => keys.get(x)!);
    align();
    setLeads();
    routes = plans.map((p) => (p ? route(p) : null));
  }
  nudge(routes, spacing);
  return routes;
}

/** Separates interior runs of different edges that would lie on top of each other. */
function nudge(routes: (Route | null)[], spacing: number) {
  for (const vertical of [true, false]) {
    type Seg = { r: Route; i: number; c: number; lo: number; hi: number; key: string };
    const segs: Seg[] = [];
    routes.forEach((r, ri) => {
      if (!r || r.routing !== 'elbow') return;
      const pts = r.points;
      for (let i = r.bundle ? 2 : 1; i + 1 <= pts.length - 2; i++) {
        const a = pts[i], b = pts[i + 1];
        if (vertical ? Math.abs(a.x - b.x) > 0.01 : Math.abs(a.y - b.y) > 0.01) continue;
        const [u, v] = vertical ? [a.y, b.y] : [a.x, b.x];
        segs.push({ r, i, c: vertical ? a.x : a.y, lo: Math.min(u, v), hi: Math.max(u, v), key: r.bundle ?? `#${ri}` });
      }
    });
    segs.sort((s, t) => s.c - t.c || s.lo - t.lo);
    const used = new Set<Seg>();
    for (const s of segs) {
      if (used.has(s)) continue;
      const cluster = [s];
      for (const t of segs) {
        if (t === s || used.has(t) || Math.abs(t.c - s.c) > 0.5) continue;
        if (cluster.some((q) => t.lo < q.hi - 1 && q.lo < t.hi - 1)) cluster.push(t);
      }
      cluster.forEach((q) => used.add(q));
      const keys = [...new Set(cluster.map((q) => q.key))];
      if (keys.length < 2) continue;
      // Order tracks by where each run starts, so the shifted runs do not cross each other.
      const startOf = (k: string) => Math.min(...cluster.filter((q) => q.key === k).map((q) => (vertical ? q.r.points[q.i - 1].x : q.r.points[q.i - 1].y)));
      keys.sort((x, y) => startOf(x) - startOf(y));
      for (const q of cluster) {
        const off = (keys.indexOf(q.key) - (keys.length - 1) / 2) * spacing;
        const pts = q.r.points;
        if (vertical) { pts[q.i] = { ...pts[q.i], x: pts[q.i].x + off }; pts[q.i + 1] = { ...pts[q.i + 1], x: pts[q.i + 1].x + off }; }
        else { pts[q.i] = { ...pts[q.i], y: pts[q.i].y + off }; pts[q.i + 1] = { ...pts[q.i + 1], y: pts[q.i + 1].y + off }; }
      }
    }
  }
}

function sampleCurve([p0, c1, c2, p3]: [Point, Point, Point, Point], steps = 16): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
    });
  }
  return out;
}

// ---- output helpers ----

const f = (v: number) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);

/** SVG path data for a polyline with each corner rounded by up to `radius`. */
export function roundedPath(pts: Point[], radius = 6): string {
  if (!pts.length) return '';
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const l1 = dist(a, b), l2 = dist(b, c);
    const r = Math.min(radius, i === 1 ? l1 : l1 / 2, i + 1 === pts.length - 1 ? l2 : l2 / 2);
    if (r < 0.5 || !l1 || !l2) { d += `L${f(b.x)} ${f(b.y)}`; continue; }
    const p1 = add(b, { x: (a.x - b.x) / l1, y: (a.y - b.y) / l1 }, r), p2 = add(b, { x: (c.x - b.x) / l2, y: (c.y - b.y) / l2 }, r);
    d += `L${f(p1.x)} ${f(p1.y)}Q${f(b.x)} ${f(b.y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  const last = pts.at(-1)!;
  return pts.length > 1 ? `${d}L${f(last.x)} ${f(last.y)}` : d;
}

/** Path data for a route: rounded elbows, a cubic curve, or a straight line. */
export function routePath(r: Route, radius = 6): string {
  if (r.curve) {
    const [p0, c1, c2, p3] = r.curve;
    return `M${f(p0.x)} ${f(p0.y)}C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p3.x)} ${f(p3.y)}`;
  }
  return roundedPath(r.points, r.routing === 'elbow' ? radius : 0);
}

/** The tip of each end and a point behind it, for drawing arrowheads. */
export function routeEnds(r: Route): { start: [Point, Point]; end: [Point, Point] } {
  if (r.curve) {
    const [p0, c1, c2, p3] = r.curve;
    return { start: [p0, dist(c1, p0) > 0.01 ? c1 : p3], end: [p3, dist(c2, p3) > 0.01 ? c2 : p0] };
  }
  const p = r.points;
  return { start: [p[0], p[1] ?? p[0]], end: [p.at(-1)!, p.at(-2) ?? p[0]] };
}

/** Pulls a route's ends back by the given lengths, so a line stops at the base of its arrowhead. */
export function trimRoute(r: Route, start: number, end: number): Route {
  const pull = (tip: Point, from: Point, k: number) => {
    const l = dist(tip, from);
    return l > k * 1.5 && k > 0 ? add(tip, { x: (from.x - tip.x) / l, y: (from.y - tip.y) / l }, k) : tip;
  };
  if (r.curve) {
    const [p0, c1, c2, p3] = r.curve;
    return { ...r, curve: [pull(p0, c1, start), c1, c2, pull(p3, c2, end)] };
  }
  const pts = [...r.points];
  if (pts.length > 1) {
    pts[0] = pull(pts[0], pts[1], start);
    pts[pts.length - 1] = pull(pts.at(-1)!, pts.at(-2)!, end);
  }
  return { ...r, points: pts };
}

export function translateRoute(r: Route, dx: number, dy: number): Route {
  const m = (p: Point) => ({ x: p.x + dx, y: p.y + dy });
  return { ...r, points: r.points.map(m), curve: r.curve ? (r.curve.map(m) as Route['curve']) : undefined };
}

// ---- labels ----

/** Centres of edge labels: on a run of the edge, clear of other labels, shapes and lines where possible. */
export function placeLabels(routes: (Route | null)[], sizes: ({ w: number; h: number } | null | undefined)[], obstacles: Box[]): (Box | null)[] {
  const placed: Box[] = [];
  const overlaps = (a: Box, b: Box, pad = 0) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
  const hitsSeg = (b: Box, p: Point, q: Point) => {
    if (Math.max(p.x, q.x) <= b.x || Math.min(p.x, q.x) >= b.x + b.w || Math.max(p.y, q.y) <= b.y || Math.min(p.y, q.y) >= b.y + b.h) return false;
    // Axis-aligned runs overlap the box once their extents do; slanted ones are sampled.
    if (Math.abs(p.x - q.x) < 0.01 || Math.abs(p.y - q.y) < 0.01) return true;
    const steps = Math.max(2, Math.ceil(dist(p, q) / 6));
    for (let i = 0; i <= steps; i++) {
      const x = p.x + ((q.x - p.x) * i) / steps, y = p.y + ((q.y - p.y) * i) / steps;
      if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) return true;
    }
    return false;
  };
  return routes.map((r, ri) => {
    const size = sizes[ri];
    if (!r || !size || r.points.length < 2) return null;
    const pts = r.points;
    const segs = pts.slice(0, -1).map((p, i) => ({ p, q: pts[i + 1], i, len: dist(p, pts[i + 1]) }));
    const midIdx = (segs.length - 1) / 2;
    const longest = Math.max(...segs.map((s) => s.len));
    let best: Box | null = null, bestScore = Infinity;
    for (const s of segs) {
      if (s.len < 1) continue;
      const vertical = Math.abs(s.q.x - s.p.x) < Math.abs(s.q.y - s.p.y);
      const extent = vertical ? size.h : size.w;
      for (const t of r.curve ? [0.5] : [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
        const c = { x: s.p.x + (s.q.x - s.p.x) * t, y: s.p.y + (s.q.y - s.p.y) * t };
        const box = { x: c.x - size.w / 2, y: c.y - size.h / 2, w: size.w, h: size.h };
        let score = Math.abs(t - 0.5) * 30 + Math.abs(s.i - midIdx) * (r.curve ? 1 : 4) + (longest - s.len) * 0.05;
        if (!r.curve && s.len < extent + 10) score += 40;
        for (const b of placed) if (overlaps(box, b, 3)) score += 1000;
        for (const b of obstacles) if (overlaps(box, b)) score += 400;
        const tip = pts.at(-1)!, tail = pts[0];
        if (dist(c, tip) < extent / 2 + 10 || dist(c, tail) < extent / 2 + 4) score += 200;
        routes.forEach((o, oi) => {
          if (!o || oi === ri) return;
          const near = { x: box.x - 4, y: box.y - 4, w: box.w + 8, h: box.h + 8 };
          for (let k = 0; k < o.points.length - 1; k++) if (hitsSeg(near, o.points[k], o.points[k + 1])) { score += 60; break; }
        });
        if (score < bestScore) { bestScore = score; best = box; }
      }
    }
    if (best) placed.push(best);
    return best;
  });
}
