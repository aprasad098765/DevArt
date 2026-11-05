// Visual edits to diagram code. Each function takes code and returns new code, leaving untouched lines
// (and their comments) exactly as written, so manual and code edits stay interchangeable.
import { parseDiagram, splitCommas, splitLabel, splitNameProps, splitOps, stripComment, CONNECTION_PROPS, type ParsedDiagram, type Props } from './dsl.ts';
import { diagramSize, graphLayout } from './render.ts';
import type { CanvasElement, DiagramType, Point } from './types.ts';

/** Diagram types that share the node-and-connection grammar these edits understand. */
export const VISUAL_TYPES: DiagramType[] = ['architecture', 'flowchart', 'bpmn'];
/** Types whose automatic layout honours dragged positions. */
export const DRAGGABLE_TYPES: DiagramType[] = ['architecture', 'flowchart'];

export const EDGE_OPS = ['>', '<>', '-->', '-'] as const;

const clean = (s: string) => s.replace(/"/g, "'").replace(/\s*\n\s*/g, ' ').trim();
const quoteName = (s: string) => (/^[\w?.][\w ?.-]*$/.test(s) && !/\s-{1,2}\s/.test(s) ? s : `"${clean(s)}"`);
const quoteValue = (s: string) => (/^[\w#.-]+$/.test(s) ? s : `"${clean(s)}"`);
const formatProps = (p: Props) => {
  const entries = Object.entries(p).filter(([, v]) => v !== undefined && v !== '');
  return entries.length ? ` [${entries.map(([k, v]) => `${k}: ${quoteValue(v)}`).join(', ')}]` : '';
};
const formatNode = (id: string, p: Props) => `${quoteName(id)}${formatProps(p)}`;
const formatEdge = (e: { from: string; to: string; op: string; label?: string; props: Props }) =>
  `${quoteName(e.from)} ${e.op} ${quoteName(e.to)}${formatProps(e.props)}${e.label ? `: "${clean(e.label)}"` : ''}`;
const indentOf = (line: string) => /^\s*/.exec(line)![0];
const edgeLines = (d: ParsedDiagram) => new Set(d.edges.map((e) => e.line));

/** Line index just past the block opened at `start`. */
function blockEnd(lines: string[], start: number) {
  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    const s = stripComment(lines[i]).trim();
    if (s.endsWith('{')) depth++;
    if (s === '}' && --depth === 0) return i + 1;
  }
  return lines.length;
}

/** Rewrites a connection line, keeping any node properties written inline and any node only mentioned there. */
function rewriteConnection(raw: string, kept: ParsedDiagram['edges'], removed: Set<string>) {
  const indent = indentOf(raw);
  const out: string[] = [];
  const named = new Set(kept.flatMap((e) => [e.from, e.to]));
  const seen = new Set<string>();
  for (const part of splitOps(splitLabel(stripComment(raw).trim())[0]).parts) {
    for (const item of splitCommas(part)) {
      const { name, props } = splitNameProps(item);
      if (removed.has(name) || seen.has(name)) continue;
      seen.add(name);
      const nodeProps = Object.fromEntries(Object.entries(props).filter(([k]) => !CONNECTION_PROPS.has(k)));
      if (Object.keys(nodeProps).length || !named.has(name)) out.push(indent + formatNode(name, nodeProps));
    }
  }
  for (const e of kept) out.push(indent + formatEdge(e));
  return out;
}

function descendants(d: ParsedDiagram, id: string) {
  const out = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const n of d.nodes) if (n.parent && out.has(n.parent) && !out.has(n.id)) { out.add(n.id); grew = true; }
  }
  return out;
}

/** A value for one property in a patch: empty, undefined, null or false removes the key; true writes `true`. */
export type PropValue = string | number | boolean | null | undefined;

/** The string a patch value is written as, or undefined when it removes the property. */
export function propText(v: PropValue): string | undefined {
  if (v === undefined || v === null || v === false) return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : undefined;
  // Not trimmed, so a label being typed keeps its trailing space.
  return String(v) || undefined;
}

/** Sets or clears node properties, style ones included (`{ border: 'thick', bold: true, fontSize: 14, fill: undefined }`). */
export function setNodeProps(type: DiagramType, code: string, id: string, patch: Record<string, PropValue>) {
  const d = parseDiagram(type, code);
  const node = d.nodes.find((n) => n.id === id);
  if (!node) return code;
  const props: Props = { ...node.props };
  for (const [k, raw] of Object.entries(patch)) { const v = propText(raw); if (v !== undefined) props[k] = v; else delete props[k]; }

  const lines = code.split(/\r?\n/);
  const onEdges = edgeLines(d);
  if (node.isGroup) {
    const i = lines.findIndex((l) => { const s = stripComment(l).trim(); return s.endsWith('{') && splitNameProps(s.slice(0, -1)).name === id; });
    if (i >= 0) lines[i] = `${indentOf(lines[i])}${formatNode(id, props)} {`;
    return lines.join('\n');
  }
  // One declaration ends up holding all the properties, so nothing written elsewhere can override or restore them.
  let last = -1, declared = false;
  lines.forEach((l, i) => {
    const s = stripComment(l).trim();
    if (!s || s === '}' || s.endsWith('{')) return;
    if (onEdges.has(i + 1)) {
      for (const part of splitOps(splitLabel(s)[0]).parts) {
        for (const item of splitCommas(part)) {
          const parsed = splitNameProps(item);
          if (parsed.name !== id) continue;
          last = i;
          const kept = Object.fromEntries(Object.entries(parsed.props).filter(([k]) => CONNECTION_PROPS.has(k)));
          if (Object.keys(parsed.props).length) lines[i] = lines[i].replace(item, formatNode(id, kept));
        }
      }
    } else {
      const items = splitCommas(s);
      if (!items.some((x) => splitNameProps(x).name === id)) return;
      lines[i] = indentOf(l) + items.map((x) => {
        if (splitNameProps(x).name !== id) return x;
        const text = declared ? quoteName(id) : formatNode(id, props);
        declared = true;
        return text;
      }).join(', ');
      last = i;
    }
  });
  // A node only mentioned in connections gets a declaration after them, so it stays in the same group.
  if (!declared) lines.splice(last + 1, 0, indentOf(lines[Math.max(0, last)] ?? '') + formatNode(id, props));
  return lines.join('\n');
}

export function uniqueName(type: DiagramType, code: string, base: string) {
  const ids = new Set(parseDiagram(type, code).nodes.map((n) => n.id));
  if (!ids.has(base)) return base;
  for (let i = 2; ; i++) if (!ids.has(`${base} ${i}`)) return `${base} ${i}`;
}

/** Adds a node or empty group, at the end of `parent` or of the diagram. Returns the code and the new id. */
export function addNode(type: DiagramType, code: string, base: string, opts: { group?: boolean; parent?: string; props?: Props } = {}) {
  const id = uniqueName(type, code, base);
  const lines = code.split(/\r?\n/);
  while (lines.length && !lines.at(-1)!.trim()) lines.pop();
  const text = (indent: string) => (opts.group ? [`${indent}${formatNode(id, opts.props ?? {})} {`, `${indent}}`] : [indent + formatNode(id, opts.props ?? {})]);
  let at = lines.length, indent = '';
  if (opts.parent) {
    const i = lines.findIndex((l) => { const s = stripComment(l).trim(); return s.endsWith('{') && splitNameProps(s.slice(0, -1)).name === opts.parent; });
    if (i >= 0) { at = blockEnd(lines, i) - 1; indent = `${indentOf(lines[i])}  `; }
  }
  lines.splice(at, 0, ...text(indent));
  return { code: lines.join('\n'), id };
}

/** Deletes a node, or a group with everything in it, along with connections that touched them. */
export function removeNode(type: DiagramType, code: string, id: string) {
  const d = parseDiagram(type, code);
  const doomed = descendants(d, id);
  const lines = code.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const s = stripComment(lines[i]).trim();
    const onLine = d.edges.filter((e) => e.line === i + 1);
    if (s.endsWith('{') && doomed.has(splitNameProps(s.slice(0, -1)).name)) { i = blockEnd(lines, i) - 1; continue; }
    if (onLine.length) {
      const kept = onLine.filter((e) => !doomed.has(e.from) && !doomed.has(e.to));
      if (kept.length === onLine.length) out.push(lines[i]);
      else out.push(...rewriteConnection(lines[i], kept, doomed));
      continue;
    }
    if (!s || s === '}' || s.endsWith('{')) { out.push(lines[i]); continue; }
    const parts = splitCommas(s);
    const left = parts.filter((x) => !doomed.has(splitNameProps(x).name));
    if (left.length === parts.length) out.push(lines[i]);
    else if (left.length) out.push(indentOf(lines[i]) + left.join(', '));
  }
  return out.join('\n');
}

/** Moves a node into a group, or to the top level. Connections that name it move to the end, so they can't hold it in place. */
export function moveNode(type: DiagramType, code: string, id: string, parent: string | undefined) {
  const d = parseDiagram(type, code);
  const node = d.nodes.find((n) => n.id === id);
  if (!node || node.isGroup) return null;
  const touches = (e: ParsedDiagram['edges'][number]) => e.from === id || e.to === id;
  const kept: string[] = [];
  code.split(/\r?\n/).forEach((l, i) => {
    const onLine = d.edges.filter((e) => e.line === i + 1);
    if (onLine.length) {
      if (onLine.some(touches)) kept.push(...rewriteConnection(l, onLine.filter((e) => !touches(e)), new Set([id])));
      else kept.push(l);
      return;
    }
    const s = stripComment(l).trim();
    if (!s || s === '}' || s.endsWith('{')) { kept.push(l); return; }
    const parts = splitCommas(s);
    const left = parts.filter((x) => splitNameProps(x).name !== id);
    if (left.length === parts.length) kept.push(l);
    else if (left.length) kept.push(indentOf(l) + left.join(', '));
  });
  const decl = formatNode(id, node.props);
  if (parent) {
    const i = kept.findIndex((l) => { const s = stripComment(l).trim(); return s.endsWith('{') && splitNameProps(s.slice(0, -1)).name === parent; });
    if (i < 0) return null;
    kept.splice(i + 1, 0, `${indentOf(kept[i])}  ${decl}`);
  } else {
    kept.unshift(decl);
  }
  while (kept.length && !kept.at(-1)!.trim()) kept.pop();
  kept.push(...d.edges.filter(touches).map(formatEdge));
  const next = kept.join('\n');
  return parseDiagram(type, next).nodes.find((n) => n.id === id)?.parent === parent ? next : null;
}

export function addEdge(code: string, from: string, to: string, label?: string) {
  const trimmed = code.replace(/\s+$/, '');
  return `${trimmed}${trimmed ? '\n' : ''}${formatEdge({ from, to, op: '>', label, props: {} })}`;
}

function changeEdge(type: DiagramType, code: string, index: number, change: (e: ParsedDiagram['edges'][number]) => ParsedDiagram['edges'][number] | null) {
  const d = parseDiagram(type, code);
  const edge = d.edges[index];
  if (!edge) return code;
  const lines = code.split(/\r?\n/);
  const kept = d.edges.filter((e) => e.line === edge.line).flatMap((e) => (e === edge ? change(e) ?? [] : [e]));
  lines.splice(edge.line - 1, 1, ...rewriteConnection(lines[edge.line - 1], kept, new Set()));
  return lines.join('\n');
}

export const updateEdge = (type: DiagramType, code: string, index: number, patch: { label?: string; op?: string; props?: Props }) =>
  changeEdge(type, code, index, (e) => ({ ...e, ...patch }));
/** Points a connection the other way, keeping its label and style. */
export const reverseEdge = (type: DiagramType, code: string, index: number) =>
  changeEdge(type, code, index, (e) => ({ ...e, from: e.to, to: e.from }));
export const removeEdge = (type: DiagramType, code: string, index: number) => changeEdge(type, code, index, () => null);

type LaidOut = Pick<CanvasElement, 'x' | 'y' | 'w' | 'h' | 'diagramType' | 'code' | 'nodeOffsets'>;
const scaleOf = (el: LaidOut) => el.w / (diagramSize(el).w || 1) || 1;

/** The fields to save for new offsets, with the box adjusted so nothing else appears to move on screen. */
export function withOffsets(el: LaidOut, code: string, offsets: Record<string, Point>): Partial<CanvasElement> {
  const type = el.diagramType ?? 'architecture';
  const scale = scaleOf(el);
  const before = graphLayout(type, el.code ?? '', el.nodeOffsets);
  const after = graphLayout(type, code, offsets);
  const nodeOffsets = Object.keys(offsets).length ? offsets : undefined;
  const size = diagramSize({ diagramType: type, code, nodeOffsets });
  return { code, nodeOffsets, x: el.x + scale * (before.dx - after.dx), y: el.y + scale * (before.dy - after.dy), w: size.w * scale, h: size.h * scale };
}

/**
 * Applies a visual edit to the code, leaving every part where it is on screen, because automatic layout would
 * otherwise rearrange the whole diagram for a small change. `place` puts one node at a canvas position.
 */
export function relayout(el: LaidOut, code: string, place?: { id: string } & Point): Partial<CanvasElement> {
  const type = el.diagramType ?? 'architecture';
  if (!DRAGGABLE_TYPES.includes(type)) {
    const scale = scaleOf(el);
    const size = diagramSize({ diagramType: type, code, nodeOffsets: el.nodeOffsets });
    return { code, w: size.w * scale, h: size.h * scale };
  }
  const scale = scaleOf(el);
  const before = graphLayout(type, el.code ?? '', el.nodeOffsets);
  const fresh = graphLayout(type, code);
  const d = parseDiagram(type, code);
  const offsets: Record<string, Point> = {};
  for (const n of d.nodes) {
    // A group with contents is drawn around them, so only its contents need a position.
    if (n.isGroup && d.nodes.some((k) => k.parent === n.id)) continue;
    const auto = fresh.boxes.get(n.id);
    if (!auto) continue;
    const had = before.boxes.get(n.id);
    const wanted = place?.id === n.id
      ? { x: (place.x - el.x) / scale - before.dx, y: (place.y - el.y) / scale - before.dy - before.titleY }
      : had && { x: had.x - before.dx, y: had.y - before.dy };
    if (!wanted) continue;
    const x = Math.round((wanted.x - auto.x) * 100) / 100, y = Math.round((wanted.y - auto.y) * 100) / 100;
    if (x || y) offsets[n.id] = { x, y };
  }
  return withOffsets(el, code, offsets);
}
