// Pure SVG rendering for diagrams and canvas elements. Runs in both the browser and Node so that
// on-screen output, REST exports and MCP renders all match. Every interpolated value is escaped.
import dagre from '@dagrejs/dagre';
import { iconPath } from './icons.ts';
import { parseDiagram, type GraphEdge, type ParsedDiagram, type Props, type SeqItem } from './dsl.ts';
import type { CanvasElement, DiagramIssue, DiagramType, Point, PresetStyle, ShapeKind, Theme } from './types.ts';

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const n = (v: number) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);

export interface Palette { bg: string; fg: string; muted: string; line: string; surface: string; group: string; note: string }
export const palette = (t: Theme): Palette =>
  t === 'dark'
    ? { bg: '#14161b', fg: '#e8eaee', muted: '#9aa1ad', line: '#7b8390', surface: '#1e2128', group: '#ffffff0a', note: '#5c5222' }
    : { bg: '#ffffff', fg: '#1b1e24', muted: '#667080', line: '#59616e', surface: '#ffffff', group: '#1b1e2408', note: '#fdf0a6' };

const NAMED: Record<string, string> = {
  blue: '#3b82f6', green: '#22a565', red: '#e5484d', orange: '#f0822e', purple: '#8b5cf6', yellow: '#d8a80f',
  pink: '#e4509a', gray: '#7b8390', grey: '#7b8390', teal: '#14a3a8', black: '#20232a', white: '#f4f5f7',
};
export function color(c: string | undefined, preset?: PresetStyle): string | undefined {
  if (!c) return undefined;
  const k = c.toLowerCase();
  const v = preset?.colors?.[k] ?? NAMED[k] ?? c;
  return /^#[0-9a-f]{3,8}$/i.test(v) ? v : undefined;
}
const FONTS = {
  clean: "Inter, 'Segoe UI', system-ui, -apple-system, Arial, sans-serif",
  mono: "'JetBrains Mono', Consolas, Menlo, monospace",
  hand: "'Segoe Print', 'Comic Sans MS', 'Chalkboard SE', cursive",
};
const CHAR_W = 0.56;
export const textWidth = (s: string, size: number) => s.length * size * CHAR_W;

export function wrapText(text: string, maxW: number, size: number): string[] {
  const max = Math.max(1, Math.floor(maxW / (size * CHAR_W)));
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      const cand = line ? `${line} ${word}` : word;
      if (cand.length <= max) line = cand;
      else {
        if (line) out.push(line);
        line = word;
        while (line.length > max) { out.push(line.slice(0, max)); line = line.slice(max); }
      }
    }
    out.push(line);
  }
  return out;
}

function svgText(lines: string[], x: number, y: number, size: number, fill: string, anchor = 'middle', extra = '') {
  const lh = size * 1.25;
  const y0 = y - ((lines.length - 1) * lh) / 2;
  return `<text x="${n(x)}" y="${n(y0)}" font-size="${size}" fill="${esc(fill)}" text-anchor="${anchor}" dominant-baseline="central" ${extra}>${lines
    .map((l, i) => `<tspan x="${n(x)}" dy="${i ? n(lh) : 0}">${esc(l)}</tspan>`).join('')}</text>`;
}

export function iconSvg(name: string | undefined, x: number, y: number, size: number, stroke: string) {
  const d = iconPath(name);
  if (!d) return '';
  const s = n(size / 24);
  return `<g transform="translate(${n(x)} ${n(y)}) scale(${s})" fill="none" stroke="${esc(stroke)}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${esc(d)}"/></g>`;
}

export function shapeMarkup(kind: ShapeKind | string, x: number, y: number, w: number, h: number, attrs: string): string {
  const r = x + w, b = y + h, cx = x + w / 2, cy = y + h / 2;
  const poly = (pts: number[][]) => `<polygon points="${pts.map((p) => `${n(p[0])},${n(p[1])}`).join(' ')}" ${attrs}/>`;
  const path = (d: string) => `<path d="${d}" ${attrs}/>`;
  switch (kind) {
    case 'ellipse': case 'oval': case 'circle': return `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(w / 2)}" ry="${n(h / 2)}" ${attrs}/>`;
    case 'diamond': return poly([[cx, y], [r, cy], [cx, b], [x, cy]]);
    case 'hexagon': { const d = Math.min(w / 4, h / 2); return poly([[x + d, y], [r - d, y], [r, cy], [r - d, b], [x + d, b], [x, cy]]); }
    case 'parallelogram': { const d = Math.min(w / 5, 24); return poly([[x + d, y], [r, y], [r - d, b], [x, b]]); }
    case 'triangle': return poly([[cx, y], [r, b], [x, b]]);
    case 'cylinder': {
      const ry = Math.min(h / 5, 14);
      return path(`M${n(x)} ${n(y + ry)}A${n(w / 2)} ${n(ry)} 0 0 1 ${n(r)} ${n(y + ry)}V${n(b - ry)}A${n(w / 2)} ${n(ry)} 0 0 1 ${n(x)} ${n(b - ry)}Z`) +
        `<path d="M${n(x)} ${n(y + ry)}A${n(w / 2)} ${n(ry)} 0 0 0 ${n(r)} ${n(y + ry)}" ${attrs.replace(/fill="[^"]*"/, 'fill="none"')}/>`;
    }
    case 'document': { const d = Math.min(h / 6, 12); return path(`M${n(x)} ${n(y)}H${n(r)}V${n(b - d)}C${n(x + w * 0.75)} ${n(b - 3 * d)} ${n(x + w * 0.25)} ${n(b + d)} ${n(x)} ${n(b - d)}Z`); }
    case 'cloud': return path(`M${n(x + w * 0.25)} ${n(b)}C${n(x - w * 0.08)} ${n(b)} ${n(x - w * 0.05)} ${n(y + h * 0.45)} ${n(x + w * 0.2)} ${n(y + h * 0.42)}C${n(x + w * 0.2)} ${n(y - h * 0.1)} ${n(x + w * 0.72)} ${n(y - h * 0.12)} ${n(x + w * 0.75)} ${n(y + h * 0.33)}C${n(r + w * 0.08)} ${n(y + h * 0.3)} ${n(r + w * 0.08)} ${n(b)} ${n(x + w * 0.78)} ${n(b)}Z`);
    case 'rounded': return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(Math.min(h / 2, 14))}" ${attrs}/>`;
    default: return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="4" ${attrs}/>`;
  }
}

function arrowHead(tip: Point, from: Point, fill: string, size = 9) {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x);
  const p = (d: number, off: number) => `${n(tip.x - d * Math.cos(a + off))},${n(tip.y - d * Math.sin(a + off))}`;
  return `<polygon points="${n(tip.x)},${n(tip.y)} ${p(size, 0.42)} ${p(size, -0.42)}" fill="${esc(fill)}"/>`;
}
const dashFor = (style?: string) => (style === 'dashed' ? 'stroke-dasharray="7 5"' : style === 'dotted' ? 'stroke-dasharray="1.5 5" stroke-linecap="round"' : '');

function smooth(pts: Point[]) {
  if (pts.length < 3) return pts.map((p, i) => `${i ? 'L' : 'M'}${n(p.x)} ${n(p.y)}`).join('');
  let d = `M${n(pts[0].x)} ${n(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
    d += `Q${n(pts[i].x)} ${n(pts[i].y)} ${n(mx)} ${n(my)}`;
  }
  const last = pts.at(-1)!;
  return `${d}L${n(last.x)} ${n(last.y)}`;
}

/** The point where a ray from a box's centre towards `to` leaves the box. */
function clipToBox(box: { x: number; y: number; w: number; h: number }, to: Point): Point {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const dx = to.x - cx, dy = to.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const s = Math.min(dx ? box.w / 2 / Math.abs(dx) : Infinity, dy ? box.h / 2 / Math.abs(dy) : Infinity);
  return { x: cx + dx * s, y: cy + dy * s };
}

/** Where a ray from a shape's centre towards `to` crosses its outline. */
function clipToShape(box: Box, shape: string | undefined, to: Point): Point {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const dx = to.x - cx, dy = to.y - cy;
  const rx = box.w / 2, ry = box.h / 2;
  if (shape === 'diamond' && (dx || dy)) { const s = 1 / (Math.abs(dx) / rx + Math.abs(dy) / ry); return { x: cx + dx * s, y: cy + dy * s }; }
  if ((shape === 'oval' || shape === 'ellipse' || shape === 'circle') && (dx || dy)) { const s = 1 / Math.hypot(dx / rx, dy / ry); return { x: cx + dx * s, y: cy + dy * s }; }
  return clipToBox(box, to);
}

/** Picks readable text for a fill, so pale shapes stay legible in dark mode and vice versa. */
function textOn(fill: string | undefined, p: Palette) {
  const m = fill && /^#([0-9a-f]{6})/i.exec(fill);
  if (!m) return p.fg;
  const v = parseInt(m[1], 16);
  const luminance = (0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
  return luminance > 0.6 ? '#1b1e24' : '#f4f5f7';
}

export interface RenderResult { svg: string; width: number; height: number; issues: DiagramIssue[] }
export interface RenderOpts {
  theme?: Theme;
  preset?: PresetStyle;
  nodeOffsets?: Record<string, Point>;
  background?: boolean;
}
interface Ctx { p: Palette; preset?: PresetStyle; font: string; shadow: boolean; d: ParsedDiagram; opts: RenderOpts }

const wrapSvg = (body: string, w: number, h: number, ctx: { font: string }, bg?: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(w)} ${n(h)}" width="${n(w)}" height="${n(h)}" font-family="${esc(ctx.font)}">${bg ? `<rect width="100%" height="100%" fill="${esc(bg)}"/>` : ''}${body}</svg>`;

function makeCtx(d: ParsedDiagram, opts: RenderOpts): Ctx {
  const face = (d.directives.typeface ?? opts.preset?.typeface ?? 'clean') as keyof typeof FONTS;
  return {
    p: palette(opts.theme ?? 'light'), preset: opts.preset, d, opts,
    font: FONTS[face] ?? FONTS.clean,
    shadow: (d.directives.styleMode ?? opts.preset?.styleMode) === 'shadow',
  };
}
const shadowAttr = (c: Ctx) => (c.shadow ? 'style="filter:drop-shadow(0 2px 4px #0003)"' : '');

/** Applies a team preset's enforced rules to a parsed diagram. */
function presetIssues(d: ParsedDiagram, preset?: PresetStyle): DiagramIssue[] {
  if (!preset) return [];
  const out: DiagramIssue[] = [];
  let re: RegExp | null = null;
  try { re = preset.nameRegex ? new RegExp(preset.nameRegex) : null; } catch { /* invalid team regex: skip the rule */ }
  const allowed = preset.allowedColors?.map((c) => c.toLowerCase());
  const check = (id: string, props: Props, line: number, needsIcon: boolean) => {
    if (re && !re.test(id)) out.push({ line, severity: 'warning', message: `"${id}" breaks the preset naming rule ${preset.nameRegex}` });
    if (allowed && props.color && !allowed.includes(props.color.toLowerCase())) out.push({ line, severity: 'warning', message: `Colour "${props.color}" on "${id}" is not allowed by the preset` });
    if (needsIcon && preset.requireIcons && !props.icon) out.push({ line, severity: 'warning', message: `"${id}" needs an icon under the preset` });
  };
  d.nodes.forEach((x) => check(x.id, x.props, x.line, !x.isGroup));
  d.tables.forEach((t) => check(t.id, t.props, t.line, false));
  return out;
}

// ---- graph layouts (architecture, flow chart) ----

interface Box { x: number; y: number; w: number; h: number }

const sizeProp = (v: string | undefined, fallback: number) => {
  const size = Number(v);
  return v && Number.isFinite(size) ? Math.min(640, Math.max(48, size)) : fallback;
};

function nodeSize(id: string, props: Props, type: DiagramType): { w: number; h: number } {
  const auto = autoNodeSize(id, props, type);
  return { w: sizeProp(props.w, auto.w), h: sizeProp(props.h, auto.h) };
}

function autoNodeSize(id: string, props: Props, type: DiagramType): { w: number; h: number } {
  const label = props.label ?? id;
  if (type === 'flowchart') {
    const shape = props.shape ?? 'rect';
    const scale = shape === 'diamond' ? 1.7 : shape === 'hexagon' || shape === 'parallelogram' ? 1.3 : 1;
    const lines = wrapText(label, 180, 13);
    const w = Math.max(...lines.map((l) => textWidth(l, 13)), 70) + 34;
    return { w: Math.max(120, w * scale), h: Math.max(shape === 'diamond' ? 90 : 56, lines.length * 17 + 26 * scale) };
  }
  const lines = wrapText(label, 130, 13);
  const notes = props.description ? wrapText(props.description, 150, 11) : [];
  const w = Math.max(...lines.map((l) => textWidth(l, 13)), ...notes.map((l) => textWidth(l, 11)), 40) + 28;
  return { w: Math.max(96, w), h: (iconPath(props.icon) ? 46 : 14) + lines.length * 17 + notes.length * 14 + 14 };
}

function edgeStyle(e: GraphEdge) {
  const dashed = e.op === '--' || e.op === '-->' || e.props.style === 'dashed';
  return {
    style: e.props.style ?? (dashed ? 'dashed' : 'solid'),
    endHead: e.op === '>' || e.op === '<>' || e.op === '-->',
    startHead: e.op === '<' || e.op === '<>',
  };
}

function renderEdge(pts: Point[], e: GraphEdge, c: Ctx) {
  const stroke = color(e.props.color, c.preset) ?? c.p.line;
  const st = edgeStyle(e);
  let out = `<path d="${smooth(pts)}" fill="none" stroke="${esc(stroke)}" stroke-width="${esc(/^\d+(\.\d+)?$/.test(e.props.width ?? '') ? e.props.width : 1.5)}" ${dashFor(st.style)}/>`;
  if (st.endHead && pts.length > 1) out += arrowHead(pts.at(-1)!, pts.at(-2)!, stroke);
  if (st.startHead && pts.length > 1) out += arrowHead(pts[0], pts[1], stroke);
  if (e.label) {
    const m = pts[Math.floor((pts.length - 1) / 2)], m2 = pts[Math.ceil((pts.length - 1) / 2)];
    const x = (m.x + m2.x) / 2, y = (m.y + m2.y) / 2;
    const lines = wrapText(e.label, 150, 11);
    const w = Math.max(...lines.map((l) => textWidth(l, 11))) + 10, h = lines.length * 14 + 4;
    out += `<rect x="${n(x - w / 2)}" y="${n(y - h / 2)}" width="${n(w)}" height="${n(h)}" rx="3" fill="${esc(c.p.bg)}" opacity="0.9"/>` + svgText(lines, x, y, 11, c.p.muted);
  }
  return out;
}

interface GraphLayout { boxes: Map<string, Box>; edges: { e: GraphEdge; pts: Point[] }[]; width: number; height: number; dx: number; dy: number }

function layoutGraph(d: ParsedDiagram, c: Ctx, sized: (id: string, props: Props) => { w: number; h: number }): GraphLayout {
  const dirs: Record<string, string> = { right: 'LR', left: 'RL', down: 'TB', up: 'BT' };
  const defaultDir = d.type === 'flowchart' ? 'down' : 'right';
  const rankdir = dirs[d.directives.direction ?? c.preset?.direction ?? defaultDir] ?? dirs[defaultDir];
  const g = new dagre.graphlib.Graph({ compound: true, multigraph: true });
  g.setGraph({ rankdir, nodesep: 46, ranksep: 74, marginx: 28, marginy: 28 });
  g.setDefaultEdgeLabel(() => ({}));
  const groupIds = new Set(d.nodes.filter((x) => x.isGroup).map((x) => x.id));
  for (const x of d.nodes) {
    if (x.isGroup) g.setNode(x.id, { label: x.id, clusterLabelPos: 'top', paddingTop: 34, paddingBottom: 18, paddingLeft: 18, paddingRight: 18 });
    else { const s = sized(x.id, x.props); g.setNode(x.id, { width: s.w, height: s.h }); }
  }
  for (const x of d.nodes) if (x.parent) g.setParent(x.id, x.parent);

  // dagre cannot route edges to compound nodes, so an edge to a group is laid out against its first leaf.
  const firstLeaf = (id: string): string | null => {
    if (!groupIds.has(id)) return id;
    for (const k of (g.children(id) ?? [])) { const leaf = firstLeaf(k); if (leaf) return leaf; }
    return null;
  };
  for (const id of groupIds) if (!firstLeaf(id)) g.setNode(id, { width: 160, height: 70 });
  const isAncestor = (a: string, b: string) => { for (let p = g.parent(b); p; p = g.parent(p)) if (p === a) return true; return false; };
  d.edges.forEach((e, i) => {
    const a = firstLeaf(e.from) ?? e.from, b = firstLeaf(e.to) ?? e.to;
    if (a === b || isAncestor(e.from, e.to) || isAncestor(e.to, e.from)) return;
    const reversedOp = e.op === '<';
    g.setEdge(reversedOp ? b : a, reversedOp ? a : b, { width: e.label ? Math.min(150, textWidth(e.label, 11) + 10) : 0, height: e.label ? 18 : 0, labelpos: 'c' }, String(i));
  });
  dagre.layout(g);

  const boxes = new Map<string, Box>();
  const offsets = c.opts.nodeOffsets ?? {};
  for (const x of d.nodes) {
    const v = g.node(x.id) as { x: number; y: number; width: number; height: number } | undefined;
    if (!v) continue;
    // Moving a group carries everything inside it.
    const o = { x: 0, y: 0 };
    for (let cur: typeof x | undefined = x; cur; cur = cur.parent ? d.nodes.find((k) => k.id === cur!.parent) : undefined) {
      o.x += offsets[cur.id]?.x ?? 0;
      o.y += offsets[cur.id]?.y ?? 0;
    }
    boxes.set(x.id, { x: v.x - v.width / 2 + o.x, y: v.y - v.height / 2 + o.y, w: v.width, h: v.height });
  }
  const movedSet = new Set(Object.keys(offsets).filter((k) => offsets[k].x || offsets[k].y));
  // Groups re-fit around dragged children, deepest first.
  const childrenOf = (id: string) => d.nodes.filter((x) => x.parent === id);
  const refit = (id: string): boolean => {
    const kids = childrenOf(id);
    let changed = movedSet.has(id);
    for (const k of kids) if (refit(k.id)) changed = true;
    if (changed && kids.length) {
      const bs = kids.map((k) => boxes.get(k.id)!).filter(Boolean);
      const x0 = Math.min(...bs.map((b) => b.x)) - 18, y0 = Math.min(...bs.map((b) => b.y)) - 34;
      const x1 = Math.max(...bs.map((b) => b.x + b.w)) + 18, y1 = Math.max(...bs.map((b) => b.y + b.h)) + 18;
      boxes.set(id, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
    return changed;
  };
  d.nodes.filter((x) => !x.parent).forEach((x) => refit(x.id));

  const touched = (id: string) => {
    for (let cur: string | undefined = id; cur; cur = d.nodes.find((x) => x.id === cur)?.parent) if (movedSet.has(cur)) return true;
    return false;
  };
  const edges: GraphLayout['edges'] = [];
  d.edges.forEach((e, i) => {
    const a = boxes.get(e.from), b = boxes.get(e.to);
    if (!a || !b || isAncestor(e.from, e.to) || isAncestor(e.to, e.from) || e.from === e.to) return;
    const u = firstLeaf(e.from) ?? e.from, w = firstLeaf(e.to) ?? e.to;
    const reversedOp = e.op === '<';
    const edge = g.edge({ v: reversedOp ? w : u, w: reversedOp ? u : w, name: String(i) }) as { points: Point[] } | undefined;
    const direct = !edge || touched(e.from) || touched(e.to) || groupIds.has(e.from) || groupIds.has(e.to);
    let pts: Point[];
    if (direct) {
      const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      pts = [clipToBox(a, cb), clipToBox(b, ca)];
    } else pts = reversedOp ? [...edge!.points].reverse() : edge!.points;
    edges.push({ e, pts });
  });

  let maxX = 0, maxY = 0, minX = Infinity, minY = Infinity;
  for (const b of boxes.values()) { maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h); minX = Math.min(minX, b.x); minY = Math.min(minY, b.y); }
  for (const { pts } of edges) for (const p of pts) { maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); }
  // Moved nodes can leave the origin in either direction, so the content is kept tight against the margin.
  const anchored = movedSet.size > 0 && Number.isFinite(minX);
  const dx = anchored ? 28 - minX : 0, dy = anchored ? 28 - minY : 0;
  if (dx || dy) {
    for (const b of boxes.values()) { b.x += dx; b.y += dy; }
    for (const ed of edges) ed.pts = ed.pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    maxX += dx; maxY += dy;
  }
  return { boxes, edges, width: maxX + 28, height: maxY + 28, dx, dy };
}

/** Where a graph diagram's parts land, for editors that need to place things on top of it. */
export function graphLayout(type: DiagramType, code: string, nodeOffsets?: Record<string, Point>) {
  const d = parseDiagram(type, code);
  const L = layoutGraph(d, makeCtx(d, { nodeOffsets }), (id, props) => nodeSize(id, props, type));
  return { boxes: L.boxes, dx: L.dx, dy: L.dy, titleY: d.directives.title ? 30 : 0 };
}

const safeLink = (url?: string) => (url && /^(https?:\/\/|\/)/.test(url) ? url : undefined);
function linked(body: string, props: Props) {
  const url = safeLink(props.link);
  return url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${body}</a>` : body;
}

function renderGraph(d: ParsedDiagram, c: Ctx): { body: string; width: number; height: number } {
  const L = layoutGraph(d, c, (id, props) => nodeSize(id, props, d.type));
  let out = '';
  const depth = (id: string): number => { const x = d.nodes.find((k) => k.id === id); return x?.parent ? 1 + depth(x.parent) : 0; };
  for (const x of d.nodes.filter((k) => k.isGroup).sort((a, b) => depth(a.id) - depth(b.id))) {
    const b = L.boxes.get(x.id);
    if (!b) continue;
    const col = color(x.props.color, c.preset) ?? c.p.muted;
    const icon = iconSvg(x.props.icon, b.x + 9, b.y + 7, 18, col);
    out += `<g data-node="${esc(x.id)}">` + linked(
      `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" rx="8" fill="${esc(x.props.color ? `${col}12` : c.p.group)}" stroke="${esc(col)}" stroke-opacity="0.65" stroke-dasharray="${x.parent ? '5 4' : '0'}"/>` +
      icon + svgText([x.props.label ?? x.id], b.x + (icon ? 32 : 12), b.y + 16, 12, x.props.color ? col : c.p.muted, 'start', 'font-weight="600"'), x.props) + '</g>';
  }
  if (d.type === 'flowchart') {
    const shapeOf = (id: string) => d.nodes.find((k) => k.id === id)?.props.shape;
    for (const ed of L.edges) {
      if (ed.pts.length < 2) continue;
      // Dagre clips edges to bounding boxes, which leaves gaps at diamonds and ovals.
      const first = ed.e.from, last = ed.e.to;
      const A = L.boxes.get(first), B = L.boxes.get(last);
      const pts = [...ed.pts];
      if (A) pts[0] = clipToShape(A, shapeOf(first), pts[1]);
      if (B) pts[pts.length - 1] = clipToShape(B, shapeOf(last), pts[pts.length - 2]);
      ed.pts = pts;
    }
  }
  for (const { e, pts } of L.edges) {
    // A wide invisible stroke keeps thin connections easy to click.
    out += `<g data-edge="${d.edges.indexOf(e)}"><path d="${smooth(pts)}" fill="none" stroke="transparent" stroke-width="14"/>${renderEdge(pts, e, c)}</g>`;
  }
  for (const x of d.nodes.filter((k) => !k.isGroup)) {
    const b = L.boxes.get(x.id);
    if (!b) continue;
    const label = x.props.label ?? x.id;
    const col = color(x.props.color, c.preset) ?? color(c.preset?.defaultNodeColor, c.preset);
    const stroke = col ?? c.p.line;
    let body: string;
    if (d.type === 'flowchart') {
      const attrs = `fill="${esc(col ? `${col}22` : c.p.surface)}" stroke="${esc(stroke)}" stroke-width="1.5"`;
      const shape = x.props.shape ?? 'rect';
      const lines = wrapText(label, b.w - 26, 13);
      const iconB = iconPath(x.props.icon);
      body = shapeMarkup(shape, b.x, b.y, b.w, b.h, attrs) +
        (iconB ? iconSvg(x.props.icon, b.x + 10, b.y + b.h / 2 - 9, 18, stroke) : '') +
        svgText(lines, b.x + b.w / 2 + (iconB ? 8 : 0), b.y + b.h / 2, 13, c.p.fg);
    } else {
      const hasIcon = !!iconPath(x.props.icon);
      const lines = wrapText(label, b.w - 14, 13);
      const notes = x.props.description ? wrapText(x.props.description, b.w - 14, 11) : [];
      const noteText = (labelY: number) => (notes.length ? svgText(notes, b.x + b.w / 2, labelY + (lines.length * 16 + notes.length * 14) / 2 + 1, 11, c.p.muted) : '');
      if (hasIcon) {
        // Icon nodes have no fill of their own, so a transparent box makes the whole node clickable.
        const labelY = b.y + 46 + (lines.length - 1) * 8;
        body = `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" fill="transparent"/>` + iconSvg(x.props.icon, b.x + b.w / 2 - 15, b.y + 7, 30, stroke) + svgText(lines, b.x + b.w / 2, labelY, 13, c.p.fg) + noteText(labelY);
      } else {
        const labelY = b.y + b.h / 2 - notes.length * 7;
        body = shapeMarkup('rect', b.x, b.y, b.w, b.h, `fill="${esc(col ? `${col}22` : c.p.surface)}" stroke="${esc(stroke)}" stroke-width="1.3"`) + svgText(lines, b.x + b.w / 2, labelY, 13, c.p.fg) + noteText(labelY);
      }
    }
    out += `<g data-node="${esc(x.id)}" ${shadowAttr(c)}>${linked(body, x.props)}</g>`;
  }
  return { body: out, width: L.width, height: L.height };
}

// ---- ERD ----

function renderErd(d: ParsedDiagram, c: Ctx) {
  const ROW = 24, HEAD = 34;
  const graph: ParsedDiagram = {
    ...d,
    nodes: d.tables.map((t) => ({ id: t.id, props: t.props, isGroup: false, line: t.line })),
    edges: d.relations.map((r) => ({ from: r.from, to: r.to, op: '-', label: r.label, props: {}, line: r.line })),
  };
  const size = new Map<string, { w: number; h: number }>();
  for (const t of d.tables) {
    const w = Math.max(textWidth(t.id, 14) + 60, ...t.columns.map((col) => textWidth(`${col.name} ${col.type} ${col.attrs.join(' ')}`, 12) + 44), 170);
    size.set(t.id, { w, h: HEAD + Math.max(1, t.columns.length) * ROW + 4 });
  }
  const L = layoutGraph(graph, c, (id) => size.get(id)!);
  let out = '';
  // Each end of a relationship anchors on its column row and picks a side by relative position.
  const anchor = (table: string, col: string | undefined, other: Box) => {
    const b = L.boxes.get(table)!;
    const t = d.tables.find((k) => k.id === table)!;
    const i = col ? t.columns.findIndex((k) => k.name === col) : -1;
    const y = i >= 0 ? b.y + HEAD + i * ROW + ROW / 2 : b.y + b.h / 2;
    const right = other.x + other.w / 2 > b.x + b.w / 2;
    return { x: right ? b.x + b.w : b.x, y, dir: right ? 1 : -1 };
  };
  const crowsFoot = (a: { x: number; y: number; dir: number }, many: boolean, stroke: string) => {
    const s = esc(stroke);
    if (many) return `<path d="M${n(a.x + a.dir * 12)} ${n(a.y)}L${n(a.x)} ${n(a.y - 6)}M${n(a.x + a.dir * 12)} ${n(a.y)}L${n(a.x)} ${n(a.y + 6)}" stroke="${s}" fill="none" stroke-width="1.3"/>`;
    return `<path d="M${n(a.x + a.dir * 8)} ${n(a.y - 6)}V${n(a.y + 6)}" stroke="${s}" fill="none" stroke-width="1.3"/>`;
  };
  for (const r of d.relations) {
    const A = L.boxes.get(r.from), B = L.boxes.get(r.to);
    if (!A || !B) continue;
    const a = anchor(r.from, r.fromCol, B), b = anchor(r.to, r.toCol, A);
    const k = Math.max(30, Math.abs(a.x - b.x) / 2);
    out += `<path d="M${n(a.x)} ${n(a.y)}C${n(a.x + a.dir * k)} ${n(a.y)} ${n(b.x + b.dir * k)} ${n(b.y)} ${n(b.x)} ${n(b.y)}" fill="none" stroke="${esc(c.p.line)}" stroke-width="1.3"/>`;
    out += crowsFoot(a, r.op === '>' || r.op === '<>', c.p.line) + crowsFoot(b, r.op === '<' || r.op === '<>', c.p.line);
    if (r.label) {
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, w = textWidth(r.label, 11) + 10;
      out += `<rect x="${n(mx - w / 2)}" y="${n(my - 9)}" width="${n(w)}" height="18" rx="3" fill="${esc(c.p.bg)}"/>` + svgText([r.label], mx, my, 11, c.p.muted);
    }
  }
  for (const t of d.tables) {
    const b = L.boxes.get(t.id);
    if (!b) continue;
    const col = color(t.props.color, c.preset) ?? c.p.muted;
    let g = `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" rx="6" fill="${esc(c.p.surface)}" stroke="${esc(col)}" stroke-width="1.3"/>`;
    g += `<path d="M${n(b.x)} ${n(b.y + HEAD)}H${n(b.x + b.w)}" stroke="${esc(col)}" stroke-opacity="0.6"/>`;
    const icon = iconSvg(t.props.icon, b.x + 9, b.y + 8, 18, col);
    g += icon + svgText([t.props.label ?? t.id], b.x + (icon ? 33 : 12), b.y + HEAD / 2, 14, c.p.fg, 'start', 'font-weight="600"');
    t.columns.forEach((cl, i) => {
      const y = b.y + HEAD + i * ROW + ROW / 2;
      g += svgText([cl.name], b.x + 12, y, 12, c.p.fg, 'start', cl.attrs.includes('pk') ? 'font-weight="700"' : '');
      g += svgText([[cl.type, ...cl.attrs].filter(Boolean).join(' ')], b.x + b.w - 12, y, 11, c.p.muted, 'end');
    });
    out += `<g data-node="${esc(t.id)}" ${shadowAttr(c)}>${g}</g>`;
  }
  return { body: out, width: L.width, height: L.height };
}

// ---- sequence ----

function renderSequence(d: ParsedDiagram, c: Ctx) {
  const HEAD_H = 54, COL_MIN = 170, STEP = 42, PAD = 30;
  const ps = d.participants;
  const longest = (items: SeqItem[]): number => items.reduce((m, it) => {
    if (it.kind === 'message') return Math.max(m, textWidth(it.label ?? '', 12) + 50);
    if (it.kind === 'block') return Math.max(m, ...it.sections.map((s) => longest(s.items)));
    return m;
  }, 0);
  const colW = Math.max(COL_MIN, Math.min(300, longest(d.sequence)));
  const xOf = new Map(ps.map((p, i) => [p.id, PAD + colW / 2 + i * colW]));
  let y = HEAD_H + 30;
  let parts = '';
  let num = 0;
  const autoNum = d.directives.autoNumber === 'on';
  const active = new Map<string, number[]>();
  const bars: string[] = [];
  const frames: string[] = [];
  const barW = 10;
  const edgeX = (id: string, toward: number) => {
    const x = xOf.get(id) ?? 0;
    return (active.get(id)?.length ?? 0) > 0 ? x + (toward > x ? barW / 2 : -barW / 2) : x;
  };
  const collectIds = (items: SeqItem[], acc: Set<string>) => {
    for (const it of items) {
      if (it.kind === 'message') { acc.add(it.from); acc.add(it.to); }
      else if (it.kind === 'block') it.sections.forEach((s) => collectIds(s.items, acc));
      else acc.add(it.who);
    }
    return acc;
  };
  const walk = (items: SeqItem[], depth: number) => {
    for (const it of items) {
      if (it.kind === 'activate') { const a = active.get(it.who) ?? []; a.push(y - 14); active.set(it.who, a); continue; }
      if (it.kind === 'deactivate') {
        const y0 = active.get(it.who)?.pop();
        if (y0 !== undefined) bars.push(`<rect x="${n(xOf.get(it.who)! - barW / 2)}" y="${n(y0)}" width="${barW}" height="${n(y - 14 - y0)}" fill="${esc(c.p.surface)}" stroke="${esc(c.p.line)}"/>`);
        continue;
      }
      if (it.kind === 'block') {
        const ids = collectIds(it.sections.flatMap((s) => s.items), new Set());
        const xs = [...ids].map((id) => xOf.get(id) ?? 0);
        const inset = 16 + (depth > 0 ? 0 : 8);
        const x0 = (xs.length ? Math.min(...xs) : PAD) - colW / 2 + inset + depth * 8;
        const x1 = (xs.length ? Math.max(...xs) : PAD + colW) + colW / 2 - inset - depth * 8;
        const top = y - 18;
        y += 18;
        const dividers: string[] = [];
        it.sections.forEach((s, i) => {
          if (i > 0) {
            dividers.push(`<path d="M${n(x0)} ${n(y - 18)}H${n(x1)}" stroke="${esc(c.p.muted)}" stroke-dasharray="5 4"/>` + (s.label ? svgText([`[${s.label}]`], x0 + 10, y - 6, 11, c.p.muted, 'start') : ''));
            y += 12;
          }
          walk(s.items, depth + 1);
        });
        const bottom = y - 12;
        const tagW = textWidth(it.block, 11) + 18;
        frames.push(
          `<rect x="${n(x0)}" y="${n(top)}" width="${n(x1 - x0)}" height="${n(bottom - top)}" rx="4" fill="${esc(c.p.group)}" stroke="${esc(c.p.muted)}"/>` +
          `<path d="M${n(x0)} ${n(top + 18)}H${n(x0 + tagW)}L${n(x0 + tagW + 6)} ${n(top + 10)}V${n(top)}" fill="none" stroke="${esc(c.p.muted)}"/>` +
          svgText([it.block], x0 + 8, top + 9, 11, c.p.muted, 'start', 'font-weight="700"') +
          (it.label ? svgText([`[${it.label}]`], x0 + tagW + 14, top + 9, 11, c.p.muted, 'start') : '') + dividers.join(''));
        y += 14;
        continue;
      }
      if (it.kind !== 'message') continue;
      const stroke = color(it.props.color, c.preset) ?? c.p.line;
      const dash = it.op === '--' || it.op === '-->' ? 'stroke-dasharray="6 4"' : '';
      const label = (autoNum ? `${++num}. ` : '') + (it.label ?? '');
      const reversed = it.op === '<';
      const a = reversed ? it.to : it.from, b = reversed ? it.from : it.to;
      const xa = xOf.get(a) ?? 0, xb = xOf.get(b) ?? 0;
      if (a === b) {
        const x = edgeX(a, xa + 1);
        parts += `<path d="M${n(x)} ${n(y)}H${n(x + 34)}V${n(y + 20)}H${n(x + 2)}" fill="none" stroke="${esc(stroke)}" stroke-width="1.3" ${dash}/>` + arrowHead({ x: x + 1, y: y + 20 }, { x: x + 20, y: y + 20 }, stroke, 8);
        if (label) parts += svgText([label], x + 42, y + 10, 12, c.p.fg, 'start');
        y += STEP + 14;
        continue;
      }
      const x1 = edgeX(a, xb), x2 = edgeX(b, xa);
      parts += `<path d="M${n(x1)} ${n(y)}H${n(x2)}" stroke="${esc(stroke)}" stroke-width="1.3" ${dash}/>`;
      if (it.op !== '-' && it.op !== '--') parts += arrowHead({ x: x2, y }, { x: x1, y }, stroke, 8);
      if (it.op === '<>') parts += arrowHead({ x: x1, y }, { x: x2, y }, stroke, 8);
      if (label) {
        const mx = (x1 + x2) / 2, w = textWidth(label, 12) + 8;
        parts += `<rect x="${n(mx - w / 2)}" y="${n(y - 21)}" width="${n(w)}" height="17" fill="${esc(c.p.bg)}" opacity="0.85"/>` + svgText([label], mx, y - 12, 12, c.p.fg);
      }
      y += STEP;
    }
  };
  walk(d.sequence, 0);
  for (const [id, stack] of active) for (const y0 of stack) bars.push(`<rect x="${n(xOf.get(id)! - barW / 2)}" y="${n(y0)}" width="${barW}" height="${n(y - 14 - y0)}" fill="${esc(c.p.surface)}" stroke="${esc(c.p.line)}"/>`);
  const end = y + 6;
  let heads = '';
  for (const p of ps) {
    const x = xOf.get(p.id)!;
    const col = color(p.props.color, c.preset) ?? c.p.line;
    const label = p.props.label ?? p.id;
    const w = Math.min(colW - 16, Math.max(90, textWidth(label, 13) + (iconPath(p.props.icon) ? 40 : 22)));
    const hasIcon = !!iconPath(p.props.icon);
    heads += `<path d="M${n(x)} ${HEAD_H}V${n(end)}" stroke="${esc(c.p.muted)}" stroke-opacity="0.55" stroke-dasharray="4 4"/>`;
    heads += `<g data-node="${esc(p.id)}" ${shadowAttr(c)}><rect x="${n(x - w / 2)}" y="12" width="${n(w)}" height="${HEAD_H - 12}" rx="6" fill="${esc(p.props.color ? `${col}22` : c.p.surface)}" stroke="${esc(col)}" stroke-width="1.3"/>` +
      (hasIcon ? iconSvg(p.props.icon, x - w / 2 + 8, 24, 18, col) : '') + svgText([label], x + (hasIcon ? 10 : 0), 12 + (HEAD_H - 12) / 2, 13, c.p.fg) + '</g>';
  }
  return { body: frames.join('') + heads + bars.join('') + parts, width: PAD * 2 + Math.max(1, ps.length) * colW, height: end + 16 };
}

// ---- BPMN ----

function renderBpmn(d: ParsedDiagram, c: Ctx) {
  // Lanes are leaf groups; a group holding other groups is a pool.
  const groups = d.nodes.filter((x) => x.isGroup);
  const hasChildGroup = (id: string) => groups.some((g) => g.parent === id);
  const lanes = groups.filter((g) => !hasChildGroup(g.id));
  const tasks = d.nodes.filter((x) => !x.isGroup);
  const laneOf = (t: { parent?: string }) => (t.parent && lanes.find((l) => l.id === t.parent) ? t.parent : '');
  const laneList: { id: string; props: Props; pool?: string }[] = lanes.map((l) => ({ id: l.id, props: l.props, pool: l.parent }));
  if (tasks.some((t) => !laneOf(t))) laneList.push({ id: '', props: {} });

  // Column = longest path from a source; back edges are ignored so loops still terminate.
  const col = new Map<string, number>(tasks.map((t) => [t.id, 0]));
  const taskIds = new Set(tasks.map((t) => t.id));
  const adj = new Map<string, string[]>();
  for (const e of d.edges) {
    if (!taskIds.has(e.from) || !taskIds.has(e.to)) continue;
    const [a, b] = e.op === '<' ? [e.to, e.from] : [e.from, e.to];
    adj.set(a, [...(adj.get(a) ?? []), b]);
  }
  const state = new Map<string, number>();
  const order: string[] = [];
  const back = new Set<string>();
  const dfs = (u: string) => {
    state.set(u, 1);
    for (const v of adj.get(u) ?? []) {
      if (state.get(v) === 1) back.add(`${u}\0${v}`);
      else if (!state.get(v)) dfs(v);
    }
    state.set(u, 2);
    order.push(u);
  };
  tasks.forEach((t) => { if (!state.get(t.id)) dfs(t.id); });
  for (const u of order.reverse()) for (const v of adj.get(u) ?? []) if (!back.has(`${u}\0${v}`)) col.set(v, Math.max(col.get(v)!, col.get(u)! + 1));

  const CW = 170, RH = 96, LANE_HEAD = 34, POOL_HEAD = 30, TOP = 16;
  const hasPools = laneList.some((l) => l.pool);
  const headW = (hasPools ? POOL_HEAD : 0) + LANE_HEAD;
  const pos = new Map<string, Box>();
  let y = TOP;
  const laneBoxes: { id: string; y: number; h: number; props: Props; pool?: string }[] = [];
  for (const l of laneList) {
    const inLane = tasks.filter((t) => laneOf(t) === l.id);
    const rows = new Map<number, number>();
    for (const t of inLane) {
      const cx = col.get(t.id)!;
      const row = rows.get(cx) ?? 0;
      rows.set(cx, row + 1);
      const kind = t.props.type ?? 'activity';
      const size = kind === 'event' ? { w: 38, h: 38 } : kind === 'gateway' ? { w: 52, h: 52 } : { w: 124, h: 58 };
      pos.set(t.id, {
        x: 16 + headW + cx * CW + (CW - size.w) / 2 - 12,
        y: y + 18 + row * RH + (RH - 18 - size.h) / 2,
        ...size,
      });
    }
    const h = Math.max(1, ...rows.values()) * RH + 22;
    laneBoxes.push({ id: l.id, y, h, props: l.props, pool: l.pool });
    y += h;
  }
  const maxCol = Math.max(0, ...col.values());
  const width = 16 + headW + (maxCol + 1) * CW + 24;
  let out = '';
  for (const pool of groups.filter((g) => hasChildGroup(g.id))) {
    const mine = laneBoxes.filter((l) => l.pool === pool.id);
    if (!mine.length) continue;
    const y0 = mine[0].y, y1 = mine.at(-1)!.y + mine.at(-1)!.h;
    const pc = color(pool.props.color, c.preset) ?? c.p.line;
    out += `<rect x="16" y="${n(y0)}" width="${POOL_HEAD}" height="${n(y1 - y0)}" fill="${esc(`${pc}22`)}" stroke="${esc(pc)}"/>`;
    out += `<text transform="translate(${16 + POOL_HEAD / 2} ${n((y0 + y1) / 2)}) rotate(-90)" text-anchor="middle" dominant-baseline="central" font-size="13" font-weight="600" fill="${esc(c.p.fg)}">${esc(pool.props.label ?? pool.id)}</text>`;
  }
  for (const l of laneBoxes) {
    const lc = color(l.props.color, c.preset) ?? c.p.line;
    const x0 = 16 + (hasPools && l.pool ? POOL_HEAD : 0);
    const hw = hasPools && !l.pool ? headW : LANE_HEAD;
    out += `<g data-node="${esc(l.id)}"><rect x="${n(x0)}" y="${n(l.y)}" width="${n(width - 8 - x0)}" height="${n(l.h)}" fill="none" stroke="${esc(lc)}"/>`;
    out += `<rect x="${n(x0)}" y="${n(l.y)}" width="${n(hw)}" height="${n(l.h)}" fill="${esc(`${lc}22`)}" stroke="${esc(lc)}"/>`;
    if (l.id) out += `<text transform="translate(${n(x0 + hw / 2)} ${n(l.y + l.h / 2)}) rotate(-90)" text-anchor="middle" dominant-baseline="central" font-size="13" font-weight="600" fill="${esc(c.p.fg)}">${esc(l.props.label ?? l.id)}</text>`;
    out += '</g>';
  }
  for (const e of d.edges) {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) continue;
    const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    let pts: Point[];
    // A same-row edge that would cross another node arcs over the top of it instead.
    const blocked = [...pos.entries()].some(([id, o]) => id !== e.from && id !== e.to && o.x + o.w > Math.min(ca.x, cb.x) && o.x < Math.max(ca.x, cb.x) && o.y < ca.y && o.y + o.h > ca.y);
    if (Math.abs(ca.y - cb.y) < 2 && blocked) {
      const top = Math.min(a.y, b.y) - 12;
      pts = [{ x: ca.x, y: a.y }, { x: ca.x, y: top }, { x: cb.x, y: top }, { x: cb.x, y: b.y }];
    } else if (Math.abs(ca.y - cb.y) < 2) pts = [clipToBox(a, cb), clipToBox(b, ca)];
    else {
      const start = { x: a.x + a.w, y: ca.y };
      const midX = cb.x > start.x ? cb.x : start.x + 20;
      pts = cb.x > start.x
        ? [start, { x: midX, y: ca.y }, { x: midX, y: ca.y < cb.y ? b.y : b.y + b.h }]
        : [start, { x: midX, y: ca.y }, { x: midX, y: Math.min(a.y, b.y) - 14 }, { x: cb.x, y: Math.min(a.y, b.y) - 14 }, { x: cb.x, y: b.y }];
    }
    const stroke = color(e.props.color, c.preset) ?? c.p.line;
    const st = edgeStyle(e);
    const polyPoints = pts.map((p) => `${n(p.x)},${n(p.y)}`).join(' ');
    out += `<g data-edge="${d.edges.indexOf(e)}"><polyline points="${polyPoints}" fill="none" stroke="transparent" stroke-width="14"/><polyline points="${polyPoints}" fill="none" stroke="${esc(stroke)}" stroke-width="1.4" ${dashFor(st.style)}/>`;
    if (st.endHead) out += arrowHead(pts.at(-1)!, pts.at(-2)!, stroke, 8);
    if (e.label) {
      // Labels sit on the edge's longest run, so branches leaving one gateway don't collide.
      let best = 0, bestLen = -1;
      for (let i = 0; i < pts.length - 1; i++) {
        const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
        if (len > bestLen) { bestLen = len; best = i; }
      }
      const mx = (pts[best].x + pts[best + 1].x) / 2, my = (pts[best].y + pts[best + 1].y) / 2, w = textWidth(e.label, 11) + 8;
      out += `<rect x="${n(mx - w / 2)}" y="${n(my - 8)}" width="${n(w)}" height="16" rx="3" fill="${esc(c.p.bg)}"/>` + svgText([e.label], mx, my, 11, c.p.muted);
    }
    out += '</g>';
  }
  for (const t of tasks) {
    const b = pos.get(t.id);
    if (!b) continue;
    const kind = t.props.type ?? 'activity';
    const col2 = color(t.props.color, c.preset) ?? c.p.line;
    const fill = t.props.color ? `${col2}22` : c.p.surface;
    const attrs = `fill="${esc(fill)}" stroke="${esc(col2)}" stroke-width="1.5"`;
    const label = t.props.label ?? t.id;
    let g: string;
    if (kind === 'event') g = shapeMarkup('ellipse', b.x, b.y, b.w, b.h, attrs) + svgText(wrapText(label, 120, 11), b.x + b.w / 2, b.y + b.h + 16, 11, c.p.fg);
    else if (kind === 'gateway') g = shapeMarkup('diamond', b.x, b.y, b.w, b.h, attrs) + svgText(wrapText(label, 120, 11), b.x + b.w / 2, b.y + b.h + 14, 11, c.p.fg);
    else g = shapeMarkup('rounded', b.x, b.y, b.w, b.h, attrs) + svgText(wrapText(label, b.w - 16, 12), b.x + b.w / 2, b.y + b.h / 2, 12, c.p.fg);
    out += `<g data-node="${esc(t.id)}" ${shadowAttr(c)}>${g}</g>`;
  }
  return { body: out, width: width + 8, height: y + 16 };
}

// ---- entry points ----

export function renderDiagram(type: DiagramType, code: string, opts: RenderOpts = {}): RenderResult {
  const d = parseDiagram(type, code);
  const c = makeCtx(d, opts);
  const issues = [...d.issues, ...presetIssues(d, opts.preset)];
  let r: { body: string; width: number; height: number };
  try {
    r = type === 'sequence' ? renderSequence(d, c) : type === 'erd' ? renderErd(d, c) : type === 'bpmn' ? renderBpmn(d, c) : renderGraph(d, c);
  } catch (e) {
    issues.push({ line: 1, severity: 'error', message: `Layout failed: ${(e as Error).message}` });
    r = { body: '', width: 300, height: 80 };
  }
  let body = r.body;
  let height = r.height;
  if (d.directives.title) {
    body = `<text x="${n(r.width / 2)}" y="20" text-anchor="middle" font-size="16" font-weight="700" fill="${esc(c.p.fg)}">${esc(d.directives.title)}</text><g transform="translate(0 30)">${body}</g>`;
    height += 30;
  }
  return { svg: wrapSvg(body, r.width, height, c, opts.background ? c.p.bg : undefined), width: r.width, height, issues };
}

// ---- canvas ----

export interface CanvasRenderOpts {
  theme?: Theme;
  presets?: Record<string, PresetStyle>;
  /** Maps an element's src to a usable href; export uses this to inline assets. */
  resolveSrc?: (src: string) => string | undefined;
}

export function resolveArrowPoints(el: CanvasElement, byId: Map<string, CanvasElement>): Point[] {
  const abs = (el.points ?? [{ x: 0, y: 0 }, { x: el.w, y: el.h }]).map((p) => ({ x: p.x + el.x, y: p.y + el.y }));
  const A = el.startBind ? byId.get(el.startBind) : undefined;
  const B = el.endBind ? byId.get(el.endBind) : undefined;
  const centre = (e: CanvasElement) => ({ x: e.x + e.w / 2, y: e.y + e.h / 2 });
  if (A) abs[0] = centre(A);
  if (B) abs[abs.length - 1] = centre(B);
  if (A) abs[0] = clipToBox(A, abs[1] ?? abs[0]);
  if (B) abs[abs.length - 1] = clipToBox(B, abs[abs.length - 2] ?? abs.at(-1)!);
  if (el.routing === 'elbow' && abs.length === 2) {
    const midX = (abs[0].x + abs[1].x) / 2;
    return [abs[0], { x: midX, y: abs[0].y }, { x: midX, y: abs[1].y }, abs[1]];
  }
  if (el.routing === 'curve' && abs.length === 2) {
    const dx = abs[1].x - abs[0].x, dy = abs[1].y - abs[0].y;
    return [abs[0], { x: (abs[0].x + abs[1].x) / 2 - dy * 0.2, y: (abs[0].y + abs[1].y) / 2 + dx * 0.2 }, abs[1]];
  }
  return abs;
}

const KEYWORDS = /\b(function|const|let|var|return|if|else|for|while|class|def|import|from|export|async|await|new|public|private|static|void|int|string|bool|true|false|null|None|self|this|try|catch|select|where|insert|update|delete|create|table)\b/gi;
function highlightCode(line: string, p: Palette, dark: boolean) {
  const kw = dark ? '#c4a7ff' : '#7a3fd1', str = dark ? '#8fd99b' : '#1b7f3b', cm = p.muted, num = dark ? '#f0b070' : '#b4530a';
  const m = /(\/\/|#(?!\w*\{)).*$/.exec(line);
  const code = m ? line.slice(0, m.index) : line;
  let out = '';
  let i = 0;
  const re = new RegExp(`("[^"]*"|'[^']*'|\`[^\`]*\`)|(\\b\\d+(?:\\.\\d+)?\\b)|${KEYWORDS.source}`, 'gi');
  for (const t of code.matchAll(re)) {
    out += esc(code.slice(i, t.index));
    const fill = t[1] ? str : t[2] ? num : kw;
    out += `<tspan fill="${fill}">${esc(t[0])}</tspan>`;
    i = t.index + t[0].length;
  }
  out += esc(code.slice(i));
  if (m) out += `<tspan fill="${esc(cm)}">${esc(m[0])}</tspan>`;
  return out;
}

export function renderElement(el: CanvasElement, byId: Map<string, CanvasElement>, opts: CanvasRenderOpts = {}): string {
  const theme = opts.theme ?? 'light';
  const p = palette(theme);
  const { x, y, w, h } = el;
  const stroke = color(el.stroke) ?? p.fg;
  const fill = el.fill === 'none' || !el.fill ? 'none' : color(el.fill) ?? 'none';
  const sw = el.strokeWidth ?? 1.6;
  const attrs = `fill="${esc(fill === 'none' ? 'transparent' : fill)}" stroke="${esc(stroke)}" stroke-width="${n(sw)}" ${dashFor(el.strokeStyle)}`;
  const font = FONTS[el.font ?? 'clean'] ?? FONTS.clean;
  const fs = el.fontSize ?? 15;
  const textIn = (fillC: string, pad = 8) => {
    if (!el.text) return '';
    const lines = wrapText(el.text, Math.max(10, w - pad * 2), fs);
    const align = el.align ?? 'center';
    const tx = align === 'left' ? x + pad : align === 'right' ? x + w - pad : x + w / 2;
    const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
    return svgText(lines, tx, y + h / 2, fs, fillC, anchor, `font-family="${esc(font)}"`);
  };
  let body = '';
  switch (el.type) {
    case 'shape': body = shapeMarkup(el.shape ?? 'rect', x, y, w, h, attrs) + textIn(fill === 'none' ? p.fg : textOn(fill, p)); break;
    case 'sticky':
      body = `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="3" fill="${esc(color(el.fill) ?? p.note)}" style="filter:drop-shadow(0 2px 5px #0002)"/>` + textIn(textOn(color(el.fill) ?? p.note, p), 12);
      break;
    case 'text': {
      const lines = wrapText(el.text ?? '', Math.max(10, w), fs);
      const align = el.align ?? 'left';
      const tx = align === 'center' ? x + w / 2 : align === 'right' ? x + w : x;
      const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
      body = `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="transparent"/>` +
        svgText(lines, tx, y + (lines.length * fs * 1.25) / 2, fs, color(el.stroke) ?? p.fg, anchor, `font-family="${esc(font)}"`);
      break;
    }
    case 'arrow': {
      const pts = resolveArrowPoints(el, byId);
      const c = color(el.stroke) ?? p.line;
      const d = el.routing === 'curve' ? smooth(pts) : pts.map((q, i) => `${i ? 'L' : 'M'}${n(q.x)} ${n(q.y)}`).join('');
      // A wide invisible stroke keeps thin arrows easy to click.
      body = `<path d="${d}" fill="none" stroke="transparent" stroke-width="14"/><path d="${d}" fill="none" stroke="${esc(c)}" stroke-width="${n(sw)}" ${dashFor(el.strokeStyle)}/>`;
      if (el.endHead !== false && pts.length > 1) body += arrowHead(pts.at(-1)!, pts.at(-2)!, c, 8 + sw);
      if (el.startHead && pts.length > 1) body += arrowHead(pts[0], pts[1], c, 8 + sw);
      if (el.text) {
        const m = pts[Math.floor(pts.length / 2 - 0.5)], m2 = pts[Math.ceil(pts.length / 2 - 0.5)];
        const mx = (m.x + m2.x) / 2, my = (m.y + m2.y) / 2, tw = textWidth(el.text, 12) + 10;
        body += `<rect x="${n(mx - tw / 2)}" y="${n(my - 10)}" width="${n(tw)}" height="20" rx="3" fill="${esc(p.bg)}"/>` + svgText([el.text], mx, my, 12, p.fg);
      }
      break;
    }
    case 'pen': {
      const pts = (el.points ?? []).map((q) => ({ x: q.x + x, y: q.y + y }));
      const d = smooth(pts);
      body = `<path d="${d}" fill="none" stroke="transparent" stroke-width="12"/><path d="${d}" fill="none" stroke="${esc(stroke)}" stroke-width="${n(sw)}" stroke-linecap="round" stroke-linejoin="round"/>`;
      break;
    }
    case 'image': {
      const href = el.src ? (opts.resolveSrc ? opts.resolveSrc(el.src) : el.src) : undefined;
      const safe = href && /^(\/api\/assets\/|data:image\/(png|jpeg|webp|gif);)/.test(href);
      body = safe
        ? `<image href="${esc(href)}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" preserveAspectRatio="xMidYMid meet"/>`
        : `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${esc(p.group)}" stroke="${esc(p.muted)}" stroke-dasharray="4 4"/>`;
      break;
    }
    case 'icon': {
      const size = Math.min(w, h);
      body = `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="transparent"/>` + iconSvg(el.icon, x + (w - size) / 2, y + (h - size) / 2, size, stroke);
      break;
    }
    case 'code': {
      const pad = 12, size = el.fontSize ?? 13, lh = size * 1.45;
      const codeBg = theme === 'dark' ? '#0e1014' : '#f5f6f8';
      const lines = (el.text ?? '').split('\n').slice(0, Math.max(1, Math.floor((h - pad * 2) / lh)));
      const maxChars = Math.max(1, Math.floor((w - pad * 2) / (size * 0.62)));
      body = `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="6" fill="${codeBg}" stroke="${esc(p.muted)}" stroke-opacity="0.4"/>` +
        `<text font-family="${esc(FONTS.mono)}" font-size="${size}" fill="${esc(p.fg)}" xml:space="preserve">` +
        lines.map((l, i) => `<tspan x="${n(x + pad)}" y="${n(y + pad + (i + 0.8) * lh)}">${highlightCode(l.slice(0, maxChars), p, theme === 'dark')}</tspan>`).join('') + '</text>';
      break;
    }
    case 'device': {
      const a = `fill="transparent" stroke="${esc(stroke)}" stroke-width="${n(sw)}"`;
      if (el.device === 'browser') {
        body = `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="8" ${a}/><path d="M${n(x)} ${n(y + 30)}H${n(x + w)}" ${a}/>` +
          [12, 26, 40].map((d) => `<circle cx="${n(x + d)}" cy="${n(y + 15)}" r="4" ${a}/>`).join('') +
          `<rect x="${n(x + 56)}" y="${n(y + 7)}" width="${n(Math.max(10, w - 72))}" height="16" rx="8" ${a}/>`;
      } else if (el.device === 'laptop') {
        const sh = h * 0.86;
        body = `<rect x="${n(x + w * 0.09)}" y="${n(y)}" width="${n(w * 0.82)}" height="${n(sh)}" rx="8" ${a}/><path d="M${n(x)} ${n(y + h)}H${n(x + w)}L${n(x + w * 0.91)} ${n(y + sh)}H${n(x + w * 0.09)}Z" ${a}/>`;
      } else {
        const r = el.device === 'tablet' ? 14 : 22;
        body = `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${r}" ${a}/><rect x="${n(x + w * 0.38)}" y="${n(y + 10)}" width="${n(w * 0.24)}" height="5" rx="2.5" ${a}/>`;
      }
      break;
    }
    case 'frame':
      body = `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="6" fill="${esc(fill === 'none' ? p.group : fill)}" stroke="${esc(color(el.stroke) ?? p.muted)}" stroke-opacity="0.8"/>` +
        svgText([el.title ?? 'Figure'], x + 4, y - 11, 12, p.muted, 'start', 'font-weight="600"');
      break;
    case 'diagram': {
      const preset = el.presetId ? opts.presets?.[el.presetId] : undefined;
      const r = renderDiagram(el.diagramType ?? 'architecture', el.code ?? '', { theme, preset, nodeOffsets: el.nodeOffsets });
      const inner = r.svg.replace(/^<svg [^>]*>/, '').replace(/<\/svg>$/, '');
      const scale = Math.min(w / r.width, h / r.height) || 1;
      body = `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="transparent"/>` +
        `<g transform="translate(${n(x)} ${n(y)}) scale(${scale.toFixed(4)})" font-family="${esc(font)}">${inner}</g>`;
      break;
    }
  }
  const op = el.opacity !== undefined && el.opacity < 1 ? `opacity="${n(el.opacity)}"` : '';
  const rot = el.rot ? `transform="rotate(${n(el.rot)} ${n(x + w / 2)} ${n(y + h / 2)})"` : '';
  if (el.link && safeLink(el.link)) body = `<a href="${esc(el.link)}" target="_blank" rel="noopener noreferrer">${body}</a>`;
  return `<g ${op} ${rot}>${body}</g>`;
}

/** Keeps a diagram element's box in step with its rendered content. */
export function diagramSize(el: Pick<CanvasElement, 'diagramType' | 'code' | 'nodeOffsets'>) {
  const r = renderDiagram(el.diagramType ?? 'architecture', el.code ?? '', { nodeOffsets: el.nodeOffsets });
  return { w: r.width, h: r.height };
}

export function elementBounds(els: CanvasElement[], byId?: Map<string, CanvasElement>): Box | null {
  if (!els.length) return null;
  const map = byId ?? new Map(els.map((e) => [e.id, e]));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of els) {
    if (e.type === 'arrow') for (const p of resolveArrowPoints(e, map)) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    else { x0 = Math.min(x0, e.x); y0 = Math.min(y0, e.y - (e.type === 'frame' ? 22 : 0)); x1 = Math.max(x1, e.x + e.w); y1 = Math.max(y1, e.y + e.h); }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const insideFrame = (e: CanvasElement, f: CanvasElement) =>
  e.id !== f.id && e.x >= f.x && e.y >= f.y && e.x + e.w <= f.x + f.w && e.y + e.h <= f.y + f.h;

/** Renders the whole canvas, or a subset by id; a frame id brings along the elements inside it. */
export function renderCanvasSvg(elements: CanvasElement[], opts: CanvasRenderOpts & { only?: string; background?: boolean; padding?: number } = {}): { svg: string; width: number; height: number } {
  const theme = opts.theme ?? 'light';
  const byId = new Map(elements.map((e) => [e.id, e]));
  let subset = [...elements];
  if (opts.only) {
    const root = byId.get(opts.only);
    subset = !root ? [] : root.type === 'frame' ? elements.filter((e) => e.id === root.id || insideFrame(e, root)) : [root];
  }
  subset.sort((a, b) => a.z - b.z);
  const pad = opts.padding ?? 24;
  const b = elementBounds(subset, byId) ?? { x: 0, y: 0, w: 320, h: 160 };
  const vb = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
  const bg = opts.background === false ? '' : `<rect x="${n(vb.x)}" y="${n(vb.y)}" width="${n(vb.w)}" height="${n(vb.h)}" fill="${palette(theme).bg}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(vb.x)} ${n(vb.y)} ${n(vb.w)} ${n(vb.h)}" width="${n(vb.w)}" height="${n(vb.h)}" font-family="${esc(FONTS.clean)}">${bg}${subset.map((e) => renderElement(e, byId, opts)).join('')}</svg>`;
  return { svg, width: vb.w, height: vb.h };
}
