// Pure SVG rendering for diagrams and canvas elements. Runs in both the browser and Node so that
// on-screen output, REST exports and MCP renders all match. Every interpolated value is escaped.
import dagre from '@dagrejs/dagre';
import { iconPath } from './icons.ts';
import { parseDiagram, type GraphEdge, type ParsedDiagram, type Props, type SeqItem } from './dsl.ts';
import { placeLabels, routeEdges, routeEnds, routePath, translateRoute, trimRoute, type Direction, type Outline, type Route, type RouteNode, type Routing } from './route.ts';
import { BORDER_STYLES, BORDER_WIDTHS, TEXT_ALIGNS, TEXT_VALIGNS } from './types.ts';
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

/** `radius` overrides the corner rounding of `rect` and `rounded`; other shapes ignore it. */
export function shapeMarkup(kind: ShapeKind | string, x: number, y: number, w: number, h: number, attrs: string, radius?: number): string {
  if (radius !== undefined && (kind === 'rect' || kind === 'rounded' || !kind)) {
    return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(Math.min(Math.max(0, radius), w / 2, h / 2))}" ${attrs}/>`;
  }
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

/** Connector end markers chosen by an edge's `head` property. */
export type HeadKind = 'arrow' | 'open' | 'diamond' | 'none';
const headKind = (v?: string): HeadKind => (v === 'open' || v === 'diamond' || v === 'none' ? v : 'arrow');
/** How far a line should stop short of the tip so it does not poke through the marker. */
const headInset = (kind: HeadKind, size: number) => (kind === 'arrow' ? size * 0.6 : kind === 'diamond' ? size * 1.2 : 0);
function headMarkup(kind: HeadKind, tip: Point, from: Point, stroke: string, size: number, width: number) {
  if (kind === 'none') return '';
  if (kind === 'arrow') return arrowHead(tip, from, stroke, size);
  const a = Math.atan2(tip.y - from.y, tip.x - from.x);
  const at = (d: number, off: number) => `${n(tip.x - d * Math.cos(a) - off * Math.sin(a))},${n(tip.y - d * Math.sin(a) + off * Math.cos(a))}`;
  if (kind === 'open') return `<path d="M${at(size, size * 0.5)}L${n(tip.x)},${n(tip.y)}L${at(size, -size * 0.5)}" fill="none" stroke="${esc(stroke)}" stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<polygon points="${n(tip.x)},${n(tip.y)} ${at(size * 0.9, size * 0.45)} ${at(size * 1.8, 0)} ${at(size * 0.9, -size * 0.45)}" fill="${esc(stroke)}"/>`;
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
  const size = { w: sizeProp(props.w, auto.w), h: sizeProp(props.h, auto.h) };
  if (props.shape !== 'circle') return size;
  // A circle stays round: the larger side wins, so a resize in either direction still takes effect.
  const side = props.w && !props.h ? size.w : props.h && !props.w ? size.h : Math.max(size.w, size.h);
  return { w: side, h: side };
}

/** How much wider than its text a shape must be, because its outline cuts into the corners. */
const SHAPE_SCALE: Record<string, number> = { diamond: 1.7, triangle: 1.7, hexagon: 1.3, parallelogram: 1.3, cloud: 1.3, oval: 1.15, ellipse: 1.15, circle: 1.15 };

function autoNodeSize(id: string, props: Props, type: DiagramType): { w: number; h: number } {
  const label = props.label ?? id;
  const fs = fontSizeOf(props);
  const lh = (fs * 17) / 13;
  const shape = props.shape ?? 'rect';
  const scale = SHAPE_SCALE[shape] ?? 1;
  if (type === 'flowchart') {
    const lines = wrapText(label, 180, fs);
    const w = Math.max(...lines.map((l) => textWidth(l, fs)), 70) + 34;
    return { w: Math.max(120, w * scale), h: Math.max(shape === 'diamond' || shape === 'triangle' ? 90 : 56, lines.length * lh + 26 * scale) };
  }
  const lines = wrapText(label, 130, fs);
  const notes = props.description ? wrapText(props.description, 150, 11) : [];
  const w = Math.max(...lines.map((l) => textWidth(l, fs)), ...notes.map((l) => textWidth(l, 11)), 40) + 28;
  const h = (iconPath(props.icon) ? 46 : 14) + lines.length * lh + notes.length * 14 + 14;
  return { w: Math.max(96, w * scale), h: scale > 1.5 ? Math.max(90, h * 1.4) : h };
}

// ---- node style properties ----

const truthy = (v?: string) => v === 'true';
const numProp = (v: string | undefined, min: number, max: number) => {
  const x = v === undefined || v.trim() === '' ? NaN : Number(v);
  return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : undefined;
};
const fontSizeOf = (props: Props) => numProp(props.fontSize, 6, 72) ?? 13;

/** Stroke width for a `border:` value: none | thin | medium | thick, or pixels from 0 to 20. */
export function borderWidth(v: string | undefined, fallback: number): number {
  if (v && Object.hasOwn(BORDER_WIDTHS, v)) return BORDER_WIDTHS[v as keyof typeof BORDER_WIDTHS];
  return numProp(v, 0, 20) ?? fallback;
}

/** Opacity for an `opacity:` value, 0 to 1 or a percentage (`50%`, or any number above 1). */
export function opacityOf(v: string | undefined): number | undefined {
  const m = v && /^(\d*\.?\d+)(%?)$/.exec(v.trim());
  if (!m) return undefined;
  const x = Number(m[1]);
  return Math.min(1, Math.max(0, m[2] || x > 1 ? x / 100 : x));
}

interface NodeStyle {
  /** fill, stroke, width and dash attributes for the outline */
  attrs: string;
  stroke: string;
  /** colour for an icon: the node colour, else the border */
  accent: string;
  textColor: string;
  fontSize: number;
  /** font-weight and font-style attributes for the label */
  font: string;
  align: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  radius?: number;
  opacity?: number;
  /** whether any outline property was written, so an icon node should draw its outline */
  outlined: boolean;
}

function nodeStyle(props: Props, c: Ctx, strokeWidth: number): NodeStyle {
  const col = color(props.color, c.preset) ?? color(c.preset?.defaultNodeColor, c.preset);
  // Unstyled components and shapes get a carbon-black outline in light mode and a light-gray one in dark mode.
  const ink = c.opts.theme === 'dark' ? '#c9ced6' : '#20232a';
  const stroke = color(props.borderColor, c.preset) ?? col ?? ink;
  const noFill = !!props.fill && /^(none|transparent)$/i.test(props.fill);
  const fill = color(props.fill, c.preset);
  const sw = borderWidth(props.border, strokeWidth);
  const dash = BORDER_STYLES.includes(props.borderStyle as never) ? dashFor(props.borderStyle) : '';
  const fillAttr = noFill ? 'transparent' : fill ?? (col ? `${col}22` : c.p.surface);
  const strokeAttr = sw > 0 ? `stroke="${esc(stroke)}" stroke-width="${n(sw)}" ${dash}` : 'stroke="none"';
  const align = TEXT_ALIGNS.includes(props.align as never) ? (props.align as NodeStyle['align']) : 'center';
  const valign = TEXT_VALIGNS.includes(props.valign as never) ? (props.valign as NodeStyle['valign']) : undefined;
  return {
    attrs: `fill="${esc(fillAttr)}" ${strokeAttr}`.trim(),
    stroke,
    accent: col ?? stroke,
    textColor: color(props.textColor, c.preset) ?? (fill ? textOn(fill, c.p) : c.p.fg),
    fontSize: fontSizeOf(props),
    font: `${truthy(props.bold) ? 'font-weight="700" ' : ''}${truthy(props.italic) ? 'font-style="italic"' : ''}`.trim(),
    align, valign,
    radius: numProp(props.radius, 0, 320),
    opacity: opacityOf(props.opacity),
    outlined: true,
  };
}

/** Horizontal inset that keeps aligned text inside a shape's outline. */
const shapeInset = (shape: string, w: number) =>
  shape === 'diamond' || shape === 'triangle' ? w * 0.25 : shape === 'hexagon' || shape === 'parallelogram' || shape === 'cloud' ? Math.min(w / 5, 24) + 8 : shape === 'circle' || shape === 'oval' || shape === 'ellipse' ? w * 0.15 + 8 : 13;

/** Where a block of text of height `blockH` sits in a box: x and anchor from `align`, the centre y from `valign`. */
function placeBlock(b: Box, s: NodeStyle, blockH: number, inset: number, padY = 10) {
  const x = s.align === 'left' ? b.x + inset : s.align === 'right' ? b.x + b.w - inset : b.x + b.w / 2;
  const anchor = s.align === 'left' ? 'start' : s.align === 'right' ? 'end' : 'middle';
  const top = s.valign === 'top' ? b.y + padY : s.valign === 'bottom' ? b.y + b.h - padY - blockH : b.y + (b.h - blockH) / 2;
  return { x, anchor, top };
}

function edgeStyle(e: GraphEdge) {
  const dashed = e.op === '--' || e.op === '-->' || e.props.style === 'dashed';
  return {
    style: e.props.style ?? (dashed ? 'dashed' : 'solid'),
    endHead: e.op === '>' || e.op === '<>' || e.op === '-->',
    startHead: e.op === '<' || e.op === '<>',
  };
}

/** An edge's `routing` property: elbow (default), straight or curved. */
const routingOf = (v?: string): Routing => (v === 'straight' ? 'straight' : v === 'curved' || v === 'curve' ? 'curved' : 'elbow');
const EDGE_RADIUS = 6;
const labelLines = (label: string) => wrapText(label, 150, 11);
const labelSize = (label: string) => {
  const lines = labelLines(label);
  return { w: Math.max(...lines.map((l) => textWidth(l, 11))) + 12, h: lines.length * 14 + 6 };
};

/** Draws one routed connection: a wide invisible hit line, the line itself, its end markers and its label. */
function drawEdge(r: Route, e: GraphEdge, index: number, c: Ctx, label?: Box | null, base = { width: 1.5, head: 9 }) {
  const stroke = color(e.props.color, c.preset) ?? c.p.line;
  const st = edgeStyle(e);
  const width = /^\d+(\.\d+)?$/.test(e.props.width ?? '') ? Math.min(20, Number(e.props.width)) : base.width;
  const kind = headKind(e.props.head);
  const size = base.head + Math.max(0, width - 1.5) * 1.5;
  const startK: HeadKind = st.startHead ? kind : 'none', endK: HeadKind = st.endHead ? kind : 'none';
  const ends = routeEnds(r);
  // The visible line stops at the base of a solid marker so its end does not poke through the tip.
  const line = routePath(trimRoute(r, headInset(startK, size), headInset(endK, size)), EDGE_RADIUS);
  let out = `<g data-edge="${index}"><path d="${routePath(r, EDGE_RADIUS)}" fill="none" stroke="transparent" stroke-width="14"/>` +
    `<path d="${line}" fill="none" stroke="${esc(stroke)}" stroke-width="${n(width)}" stroke-linejoin="round" ${dashFor(st.style)}/>` +
    headMarkup(endK, ends.end[0], ends.end[1], stroke, size, width) + headMarkup(startK, ends.start[0], ends.start[1], stroke, size, width);
  if (e.label && label) {
    const cx = label.x + label.w / 2, cy = label.y + label.h / 2;
    out += `<rect x="${n(label.x)}" y="${n(label.y)}" width="${n(label.w)}" height="${n(label.h)}" rx="4" fill="${esc(c.p.bg)}" stroke="${esc(c.p.line)}" stroke-opacity="0.25"/>` +
      svgText(labelLines(e.label), cx, cy, 11, c.p.muted);
  }
  return out + '</g>';
}

/** The outline a connector attaches to, from a node's shape. */
const outlineOf = (shape?: string): Outline => (shape === 'diamond' ? 'diamond' : shape === 'oval' || shape === 'ellipse' || shape === 'circle' ? 'ellipse' : 'rect');

interface LaidEdge { e: GraphEdge; route: Route; label?: Box | null }
interface GraphLayout { boxes: Map<string, Box>; edges: LaidEdge[]; width: number; height: number; dx: number; dy: number }

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

  // Connectors are routed from the final boxes, so dragged nodes get fresh, tidy paths.
  const nodeById = new Map(d.nodes.map((x) => [x.id, x]));
  const routeNodes: RouteNode[] = [...boxes].map(([id, box]) => {
    const x = nodeById.get(id)!;
    return { id, box, parent: x.parent, group: x.isGroup, shape: x.isGroup ? 'rect' : outlineOf(x.props.shape) };
  });
  const kept = d.edges.filter((e) => boxes.has(e.from) && boxes.has(e.to) && e.from !== e.to && !isAncestor(e.from, e.to) && !isAncestor(e.to, e.from));
  const dirName = d.directives.direction ?? c.preset?.direction ?? defaultDir;
  const direction = (dirs[dirName] ? dirName : defaultDir) as Direction;
  const routes = routeEdges(routeNodes, kept.map((e) => ({ from: e.from, to: e.to, routing: routingOf(e.props.routing), bundle: !edgeStyle(e).startHead })), { direction });
  const labels = placeLabels(routes, kept.map((e) => (e.label ? labelSize(e.label) : null)), routeNodes.filter((r) => !r.group).map((r) => r.box));
  let edges: LaidEdge[] = kept.flatMap((e, i) => (routes[i] ? [{ e, route: routes[i]!, label: labels[i] }] : []));

  let maxX = 0, maxY = 0, minX = Infinity, minY = Infinity;
  const grow = (x0: number, y0: number, x1: number, y1: number) => { maxX = Math.max(maxX, x1); maxY = Math.max(maxY, y1); minX = Math.min(minX, x0); minY = Math.min(minY, y0); };
  for (const b of boxes.values()) grow(b.x, b.y, b.x + b.w, b.y + b.h);
  for (const { route, label } of edges) {
    for (const p of route.points) grow(p.x, p.y, p.x, p.y);
    if (label) grow(label.x, label.y, label.x + label.w, label.y + label.h);
  }
  // Moved nodes can leave the origin in either direction, so the content is kept tight against the margin.
  const anchored = movedSet.size > 0 && Number.isFinite(minX);
  const dx = anchored ? 28 - minX : 0, dy = anchored ? 28 - minY : 0;
  if (dx || dy) {
    for (const b of boxes.values()) { b.x += dx; b.y += dy; }
    edges = edges.map((ed) => ({ ...ed, route: translateRoute(ed.route, dx, dy), label: ed.label && { ...ed.label, x: ed.label.x + dx, y: ed.label.y + dy } }));
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

/** One architecture or flow chart node: its outline, icon, label and description, styled by its properties. */
function renderGraphNode(id: string, props: Props, b: Box, type: DiagramType, c: Ctx): string {
  const label = props.label ?? id;
  const flow = type === 'flowchart';
  const s = nodeStyle(props, c, flow ? 1.5 : 1.3);
  const shape = props.shape ?? 'rect';
  const hasIcon = !!iconPath(props.icon);
  // Text grows with the box too, unless a fontSize is set: a default-sized box keeps the default size.
  // Only boxes sized by hand (w or h set) scale; auto-sized boxes already fit their content.
  const sized = props.w !== undefined || props.h !== undefined;
  const grow = props.fontSize || !sized ? 1 : Math.min(2.5, Math.max(1, Math.min(b.w, b.h) / 110));
  const fs = s.fontSize * grow, lh = fs * 1.25, noteFs = 11 * grow;
  const inset = shapeInset(shape, b.w);
  // Icons grow with the box: the default size at a default-sized box, larger as the box is resized.
  const icon = !sized ? (flow ? 18 : 30) : flow ? Math.min(56, Math.max(18, Math.min(b.w, b.h) * 0.25)) : Math.min(120, Math.max(30, Math.min(b.w, b.h) * 0.32));
  const text = (lines: string[], x: number, y: number, anchor: string) => svgText(lines, x, y, fs, s.textColor, anchor, s.font);
  const outline = shapeMarkup(shape, b.x, b.y, b.w, b.h, s.attrs, s.radius);
  let body: string;
  if (flow) {
    // A flow chart icon sits to the left of the label.
    const iconInset = hasIcon && s.align === 'left' ? Math.max(inset, icon + 16) : inset;
    const lines = wrapText(label, s.align === 'center' ? b.w - 26 : b.w - iconInset - inset, fs);
    const p = placeBlock(b, s, lines.length * lh, iconInset);
    const y = p.top + (lines.length * lh) / 2;
    body = outline + (hasIcon ? iconSvg(props.icon, b.x + 10, y - icon / 2, icon, s.accent) : '') +
      text(lines, p.x + (hasIcon && s.align === 'center' ? 8 : 0), y, p.anchor);
  } else {
    const wrapW = s.align === 'center' ? b.w - 14 : b.w - inset * 2;
    const lines = wrapText(label, wrapW, fs);
    const notes = props.description ? wrapText(props.description, wrapW, noteFs) : [];
    const noteH = notes.length * noteFs * 1.25;
    const noteColor = props.textColor || props.fill ? s.textColor : c.p.muted;
    const iconH = hasIcon ? icon + 1 : 0;
    const blockH = iconH + lines.length * lh + (notes.length ? noteH + 2 : 0);
    // Content is centred vertically unless `valign` says otherwise, so a resized box keeps it in the middle.
    const p = placeBlock(b, s, blockH, inset, hasIcon ? 7 : 10);
    const top = p.top;
    const labelY = top + iconH + (lines.length * lh) / 2;
    const notesY = top + iconH + lines.length * lh + 2 + noteH / 2;
    const iconX = s.align === 'left' ? b.x + inset : s.align === 'right' ? b.x + b.w - inset - icon : b.x + b.w / 2 - icon / 2;
    // Icon nodes have no outline of their own unless one is styled; a transparent box keeps them clickable.
    body = (hasIcon && !s.outlined ? `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" fill="transparent"/>` : outline) +
      (hasIcon ? iconSvg(props.icon, iconX, top, icon, s.accent) : '') +
      text(lines, p.x, labelY, p.anchor) +
      (notes.length ? svgText(notes, p.x, notesY, noteFs, noteColor, p.anchor, noteColor === c.p.muted ? '' : 'opacity="0.8"') : '');
  }
  const op = s.opacity !== undefined && s.opacity < 1 ? ` opacity="${n(s.opacity)}"` : '';
  return `<g data-node="${esc(id)}"${op} ${shadowAttr(c)}>${linked(body, props)}</g>`;
}

function renderGraph(d: ParsedDiagram, c: Ctx): { body: string; width: number; height: number } {
  const L = layoutGraph(d, c, (id, props) => nodeSize(id, props, d.type));
  let out = '';
  const depth = (id: string): number => { const x = d.nodes.find((k) => k.id === id); return x?.parent ? 1 + depth(x.parent) : 0; };
  for (const x of d.nodes.filter((k) => k.isGroup).sort((a, b) => depth(a.id) - depth(b.id))) {
    const b = L.boxes.get(x.id);
    if (!b) continue;
    const gp = x.props;
    const col = color(gp.color, c.preset) ?? c.p.muted;
    const icon = iconSvg(gp.icon, b.x + 9, b.y + 7, 18, col);
    // Groups take the same style properties as nodes, on top of their own lighter defaults.
    const stroke = color(gp.borderColor, c.preset) ?? col;
    const sw = borderWidth(gp.border, 1);
    const dash = BORDER_STYLES.includes(gp.borderStyle as never) ? dashFor(gp.borderStyle) : `stroke-dasharray="${x.parent ? '5 4' : '0'}"`;
    const fill = gp.fill && /^(none|transparent)$/i.test(gp.fill) ? 'transparent' : color(gp.fill, c.preset) ?? (gp.color ? `${col}12` : c.p.group);
    const strokeAttr = sw > 0 ? `stroke="${esc(stroke)}" stroke-width="${n(sw)}" stroke-opacity="${gp.borderColor ? 1 : 0.65}" ${dash}` : 'stroke="none"';
    const font = `font-weight="${truthy(gp.bold) ? 700 : 600}"${truthy(gp.italic) ? ' font-style="italic"' : ''}`;
    const textColor = color(gp.textColor, c.preset) ?? (gp.color ? col : c.p.muted);
    const op = opacityOf(gp.opacity);
    out += `<g data-node="${esc(x.id)}"${op !== undefined && op < 1 ? ` opacity="${n(op)}"` : ''}>` + linked(
      `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" rx="${n(Math.min(numProp(gp.radius, 0, 320) ?? 8, b.w / 2, b.h / 2))}" fill="${esc(fill)}" ${strokeAttr}/>` +
      icon + svgText([gp.label ?? x.id], b.x + (icon ? 32 : 12), b.y + 16, numProp(gp.fontSize, 6, 24) ?? 12, textColor, 'start', font), gp) + '</g>';
  }
  for (const { e, route, label } of L.edges) out += drawEdge(route, e, d.edges.indexOf(e), c, label);
  for (const x of d.nodes.filter((k) => !k.isGroup)) {
    const b = L.boxes.get(x.id);
    if (!b) continue;
    out += renderGraphNode(x.id, x.props, b, d.type, c);
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
  // Events and gateways carry their caption underneath, so other connectors keep clear of it too.
  const routeNodes: RouteNode[] = tasks.flatMap((t) => {
    const b = pos.get(t.id);
    if (!b) return [];
    const kind = t.props.type ?? 'activity';
    const caption = kind === 'event' || kind === 'gateway' ? wrapText(t.props.label ?? t.id, 120, 11).length * 14 + 8 : 0;
    return [{ id: t.id, box: b, shape: kind === 'event' ? 'ellipse' : kind === 'gateway' ? 'diamond' : 'rect', keepOut: { ...b, h: b.h + caption } } satisfies RouteNode];
  });
  const flows = d.edges.filter((e) => pos.has(e.from) && pos.has(e.to) && e.from !== e.to);
  const routes = routeEdges(routeNodes, flows.map((e) => ({ from: e.from, to: e.to, routing: routingOf(e.props.routing), bundle: !edgeStyle(e).startHead })), { direction: 'right' });
  const labels = placeLabels(routes, flows.map((e) => (e.label ? labelSize(e.label) : null)), routeNodes.map((r) => r.keepOut ?? r.box));
  flows.forEach((e, i) => { if (routes[i]) out += drawEdge(routes[i]!, e, d.edges.indexOf(e), c, labels[i], { width: 1.4, head: 8 }); });
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
