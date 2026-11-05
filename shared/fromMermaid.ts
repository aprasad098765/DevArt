// Converts the common subset of Mermaid (flowchart/graph, sequenceDiagram, erDiagram) to DevArt diagram code.
// It is the reverse of toMermaid in ./mermaid.ts. Styling Mermaid can't express in DevArt, and the reverse, is dropped.
import type { DiagramType } from './types.ts';

export interface FromMermaidOptions {
  /** DevArt type to use for a Mermaid flowchart. Defaults to `flowchart`; `architecture` opens in the visual editor. */
  graphAs?: 'flowchart' | 'architecture';
}

// ---- shared helpers ----

/** Decodes Mermaid's entity codes, `<br>` breaks, and markdown-string backticks into plain text. */
function cleanText(s: string) {
  let t = s.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1);
  if (t.length >= 2 && t.startsWith('`') && t.endsWith('`')) t = t.slice(1, -1);
  return t
    .replace(/#quot;/g, '"').replace(/#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim();
}

const DIRECTIVE_WORDS = /^(title|direction|colorMode|styleMode|typeface|autoNumber|activate|deactivate)\s/;

/** A name as DevArt code: brackets and double quotes are swapped for safe characters, and it is quoted when needed. */
function dName(s: string) {
  const t = s.replace(/"/g, "'").replace(/[[{]/g, '(').replace(/[\]}]/g, ')').trim() || '_';
  const risky = /[<>:,]|\/\/|(^|\s)--?(\s|$)/.test(t) || DIRECTIVE_WORDS.test(t) || /^(else|and|end)$/i.test(t);
  return risky ? `"${t}"` : t;
}

/** A label after `:` or a property value; quoted unless it's a plain word. */
const dValue = (s: string) => (/^[\w.#-]+$/.test(s) ? s : `"${s.replace(/"/g, "'")}"`);
const dLabel = (s: string) => (/\/\/|^["\s]|[\s]$/.test(s) ? `"${s.replace(/"/g, "'")}"` : s);
const propList = (p: Record<string, string>) => {
  const e = Object.entries(p);
  return e.length ? ` [${e.map(([k, v]) => `${k}: ${dValue(v)}`).join(', ')}]` : '';
};

/** Removes `%%` comments and returns the YAML front matter title, if there is one. */
function preprocess(text: string): { lines: string[]; title?: string } {
  let lines = text.replace(/\r\n?/g, '\n').split('\n');
  let title: string | undefined;
  const first = lines.findIndex((l) => l.trim());
  if (first >= 0 && lines[first].trim() === '---') {
    const close = lines.findIndex((l, i) => i > first && l.trim() === '---');
    if (close > 0) {
      for (const l of lines.slice(first + 1, close)) {
        const m = /^\s*title:\s*(.+)$/.exec(l);
        if (m) title = cleanText(m[1]);
      }
      lines = lines.slice(close + 1);
    }
  }
  return { lines: lines.map((l) => (/^\s*%%/.test(l) ? '' : l.replace(/\s%%(?!\{).*$/, '')).trim()), title };
}

/** Splits a line on `;` outside quotes and brackets. */
function statements(line: string) {
  const out: string[] = [];
  let cur = '', quoted = false, depth = 0;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && '([{'.includes(c)) depth++;
    else if (!quoted && ')]}'.includes(c)) depth = Math.max(0, depth - 1);
    if (c === ';' && !quoted && depth === 0) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Picks a DevArt name for each Mermaid id: its label when that's unique, otherwise the id. */
function nameIds(entries: { id: string; label: string }[]) {
  const count = new Map<string, number>();
  for (const e of entries) count.set(e.label, (count.get(e.label) ?? 0) + 1);
  const used = new Set<string>();
  const names = new Map<string, string>();
  for (const e of entries) {
    let n = e.label && count.get(e.label) === 1 ? e.label : e.id;
    if (used.has(n)) n = e.id;
    for (let i = 2; used.has(n); i++) n = `${e.id}_${i}`;
    used.add(n);
    names.set(e.id, n);
  }
  return names;
}

// ---- flowchart / graph ----

const DIRECTION: Record<string, string> = { LR: 'right', TD: 'down', TB: 'down', RL: 'left', BT: 'up' };

const OPENERS: [open: string, close: string[], shape?: string][] = [
  ['(((', [')))'], 'circle'], ['([', ['])'], 'oval'], ['((', ['))'], 'circle'], ['[(', [')]'], 'cylinder'],
  ['[[', [']]']], ['[/', ['/]', '\\]'], 'parallelogram'], ['[\\', ['\\]', '/]'], 'parallelogram'], ['{{', ['}}'], 'hexagon'],
  ['(', [')'], 'rounded'], ['[', [']']], ['{', ['}'], 'diamond'], ['>', [']']],
];
const NEW_SHAPES: Record<string, string> = {
  rect: 'rect', rounded: 'rounded', stadium: 'oval', circle: 'circle', diamond: 'diamond', hex: 'hexagon', hexagon: 'hexagon',
  cyl: 'cylinder', cylinder: 'cylinder', db: 'cylinder', database: 'cylinder', lean_r: 'parallelogram', lean_l: 'parallelogram',
  doc: 'document', document: 'document', cloud: 'cloud', tri: 'triangle', triangle: 'triangle',
};

interface FNode { id: string; label?: string; shape?: string; parent?: string; isGroup: boolean; classes: string[]; style: Record<string, string> }
interface FEdge { from: string; to: string; left: boolean; right: boolean; dotted: boolean; thick: boolean; hidden: boolean; label?: string }

const ID = /^[\w$À-￿]+(?:-(?![-.>xo]\s)(?![-.>])[\w$À-￿]+)*/;

/** Maps Mermaid style properties (`fill:#f9f,stroke:#333,color:#fff`) to DevArt node properties. */
function styleProps(s: string) {
  const out: Record<string, string> = {};
  for (const part of s.split(',')) {
    const [k, ...v] = part.split(':');
    const val = v.join(':').trim();
    if (!val) continue;
    const key = k.trim();
    if (key === 'fill') out.fill = val;
    else if (key === 'stroke') out.borderColor = val;
    else if (key === 'color') out.textColor = val;
    else if (key === 'stroke-dasharray') out.borderStyle = 'dashed';
    else if (key === 'stroke-width' && /^\d+(\.\d+)?(px)?$/.test(val)) out.border = String(parseFloat(val));
  }
  return out;
}

function fromFlowchart(lines: string[], header: string, title: string | undefined, type: DiagramType) {
  const nodes = new Map<string, FNode>();
  const order: string[] = [];
  const edges: FEdge[] = [];
  const classDefs = new Map<string, Record<string, string>>();
  const stack: string[] = [];
  const direction = DIRECTION[(/^(?:graph|flowchart)\s+(\w+)/.exec(header)?.[1] ?? 'TD').toUpperCase()] ?? 'down';

  const touch = (id: string, isGroup = false) => {
    let n = nodes.get(id);
    if (!n) {
      n = { id, isGroup, parent: stack.at(-1), classes: [], style: {} };
      nodes.set(id, n);
      order.push(id);
    }
    if (isGroup) n.isGroup = true;
    // As in Mermaid, a node mentioned inside a subgraph moves into it, unless that would put a group inside itself.
    const here = stack.at(-1);
    if (here && n.parent !== here && !stack.includes(id) && (!n.parent || stack.includes(n.parent))) n.parent = here;
    return n;
  };

  /** Reads one node reference, with an optional shape, label, and `:::class`, at the start of `s`. */
  const readNode = (s: string): { id: string; rest: string } | null => {
    const m = ID.exec(s);
    if (!m) return null;
    const id = m[0];
    let rest = s.slice(id.length);
    const n = touch(id);
    if (rest.startsWith('@{')) {
      const close = rest.indexOf('}');
      if (close < 0) return null;
      const body = rest.slice(2, close);
      const label = /label:\s*("[^"]*"|[^,]+)/.exec(body)?.[1];
      const shape = /shape:\s*(\w+)/.exec(body)?.[1];
      if (label) n.label = cleanText(label);
      if (shape && NEW_SHAPES[shape]) n.shape = NEW_SHAPES[shape];
      rest = rest.slice(close + 1);
    } else {
      const opener = OPENERS.find(([o]) => rest.startsWith(o));
      if (opener) {
        const [open, closers, shape] = opener;
        let body = rest.slice(open.length);
        let start = 0;
        const lead = body.length - body.trimStart().length;
        if (body.trimStart().startsWith('"')) {
          const endQuote = body.indexOf('"', lead + 1);
          if (endQuote < 0) return null;
          start = endQuote + 1;
        }
        const hits = closers.map((c) => body.indexOf(c, start)).filter((i) => i >= 0);
        if (!hits.length) return null;
        const at = Math.min(...hits);
        const closer = closers.find((c) => body.indexOf(c, start) === at)!;
        n.label = cleanText(body.slice(0, at));
        n.shape = shape;
        rest = body.slice(at + closer.length);
      }
    }
    const cls = /^:::([\w-]+)/.exec(rest);
    if (cls) { n.classes.push(cls[1]); rest = rest.slice(cls[0].length); }
    return { id, rest };
  };

  const readGroup = (s: string): { ids: string[]; rest: string } | null => {
    const ids: string[] = [];
    let rest = s;
    for (;;) {
      const r = readNode(rest.trimStart());
      if (!r) return null;
      ids.push(r.id);
      rest = r.rest;
      const amp = /^\s*&\s*/.exec(rest);
      if (!amp) return { ids, rest };
      rest = rest.slice(amp[0].length);
    }
  };

  const readLink = (s: string): { edge: Omit<FEdge, 'from' | 'to'>; rest: string } | null => {
    let rest = s.trimStart();
    const m = /^([<xo]?)(-{2,}|={2,}|-\.+-|~{3,})([>xo]?)/.exec(rest);
    if (!m) return null;
    let [all, lh, body, rh] = m;
    if ('xo'.includes(rh) && rh && /^[\w$]/.test(rest.slice(all.length))) { all = all.slice(0, -1); rh = ''; }
    rest = rest.slice(all.length);
    let label: string | undefined;
    let closeHead = rh;
    // The `A -- text --> B` form puts the label inside the link.
    if (!rh && /^(--|==|-\.)$/.test(body) && /^\s/.test(rest)) {
      const close = body === '-.' ? /^\s*(.+?)\s*(\.-+)([>xo]?)(?=\s|$|[\w"])/ : body === '--' ? /^\s*(.+?)\s*(-{2,})([>xo]?)(?=\s|$|[\w"])/ : /^\s*(.+?)\s*(={2,})([>xo]?)(?=\s|$|[\w"])/;
      const t = close.exec(rest);
      if (t && (t[3] || t[2].length >= 3 || body === '-.')) {
        label = cleanText(t[1]);
        closeHead = t[3];
        rest = rest.slice(t[0].length);
      }
    }
    const pipe = /^\s*\|([^|]*)\|/.exec(rest);
    if (pipe) { label = cleanText(pipe[1]); rest = rest.slice(pipe[0].length); }
    return {
      edge: { left: !!lh, right: !!closeHead, dotted: body.includes('.'), thick: body.startsWith('='), hidden: body.startsWith('~'), label: label || undefined },
      rest,
    };
  };

  for (const raw of lines) {
    for (const s of statements(raw)) {
      const sub = /^subgraph\s+(.+)$/.exec(s);
      if (sub) {
        const spec = sub[1].trim();
        const withLabel = /^([\w$-]+)\s*\[(.*)\]$/.exec(spec);
        const id = withLabel ? withLabel[1] : /^[\w$-]+$/.test(spec) ? spec : cleanText(spec);
        const g = touch(id, true);
        if (withLabel) g.label = cleanText(withLabel[2]);
        else if (!/^[\w$-]+$/.test(spec)) g.label = cleanText(spec);
        stack.push(id);
        continue;
      }
      if (s === 'end') { stack.pop(); continue; }
      if (/^(direction|click|linkStyle|accTitle|accDescr)\b/.test(s)) continue;
      const style = /^style\s+([\w$-]+)\s+(.+)$/.exec(s);
      if (style) { Object.assign(touch(style[1]).style, styleProps(style[2])); continue; }
      const classDef = /^classDef\s+([\w-,]+)\s+(.+)$/.exec(s);
      if (classDef) { for (const c of classDef[1].split(',')) classDefs.set(c, styleProps(classDef[2])); continue; }
      const cls = /^class\s+([\w$,\s-]+?)\s+([\w-]+)$/.exec(s);
      if (cls) { for (const id of cls[1].split(',')) touch(id.trim()).classes.push(cls[2]); continue; }

      let g = readGroup(s);
      if (!g) continue;
      for (;;) {
        const link = readLink(g.rest);
        if (!link) break;
        const next = readGroup(link.rest);
        if (!next) break;
        if (!link.edge.hidden) for (const from of g.ids) for (const to of next.ids) edges.push({ from, to, ...link.edge });
        g = next;
      }
    }
  }

  const names = nameIds(order.map((id) => ({ id, label: nodes.get(id)!.label ?? id })));
  const out: string[] = [];
  if (title) out.push(`title ${title}`);
  out.push(`direction ${direction}`);
  const emit = (parent: string | undefined, depth: number) => {
    const pad = '  '.repeat(depth);
    for (const id of order) {
      const n = nodes.get(id)!;
      if (n.parent !== parent) continue;
      const name = names.get(id)!;
      const props: Record<string, string> = {};
      if (n.label && n.label !== name) props.label = n.label;
      if (n.shape && !n.isGroup) props.shape = n.shape;
      for (const c of n.classes) Object.assign(props, classDefs.get(c));
      Object.assign(props, n.style);
      if (n.isGroup) {
        out.push(`${pad}${dName(name)}${propList(props)} {`);
        emit(id, depth + 1);
        out.push(`${pad}}`);
      } else out.push(`${pad}${dName(name)}${propList(props)}`);
    }
  };
  emit(undefined, 0);
  for (const e of edges) {
    let [a, b] = [e.from, e.to];
    let op: string;
    const props: Record<string, string> = {};
    if (e.left && e.right) { op = '<>'; if (e.dotted) props.style = 'dashed'; }
    else if (e.right) op = e.dotted ? '-->' : '>';
    else if (e.left) { [a, b] = [b, a]; op = e.dotted ? '-->' : '>'; }
    else op = e.dotted ? '--' : '-';
    if (e.thick) props.width = '3';
    out.push(`${dName(names.get(a)!)} ${op} ${dName(names.get(b)!)}${propList(props)}${e.label ? `: ${dLabel(e.label)}` : ''}`);
  }
  return { type, code: out.join('\n') };
}

// ---- sequence ----

const SEQ_ARROW = /^(.+?)\s*(<<-->>|<<->>|-->>|->>|-->|->|--x|-x|--\)|-\))\s*([+-]?)\s*(.+?)\s*:\s?(.*)$/;
const SEQ_ARROW_NOLABEL = /^(.+?)\s*(<<-->>|<<->>|-->>|->>|-->|->|--x|-x|--\)|-\))\s*([+-]?)\s*(.+?)\s*$/;
const SEQ_OP: Record<string, string> = {
  '->>': '>', '-x': '>', '-)': '>', '->': '-', '-->>': '-->', '--x': '-->', '--)': '-->', '-->': '--', '<<->>': '<>', '<<-->>': '<>',
};
const SEQ_BLOCK: Record<string, string> = { alt: 'alt', opt: 'opt', loop: 'loop', par: 'par', break: 'break', critical: 'alt' };
const SEQ_SECTION: Record<string, string> = { else: 'else', and: 'and', option: 'else' };

function fromSequence(lines: string[], title: string | undefined) {
  const people: { id: string; label: string; actor: boolean }[] = [];
  const body: { pad: number; text: string; refs?: string[] }[] = [];
  const stack: ('block' | 'rect')[] = [];
  let autoNumber = false;
  const person = (id: string, label?: string, actor = false) => {
    const p = people.find((x) => x.id === id);
    if (p) { if (label) p.label = label; if (actor) p.actor = true; return; }
    people.push({ id, label: label ?? id, actor });
  };
  const depth = () => stack.filter((k) => k === 'block').length;
  // Participant names are only known at the end, so lines hold placeholders ("\u0000<index>") filled in later.
  const ref = (id: string) => `\u0000${people.findIndex((p) => p.id === id)}\u0000`;

  for (const raw of lines) {
    for (const s of statements(raw)) {
      if (s === 'autonumber' || s.startsWith('autonumber ')) { autoNumber = true; continue; }
      const title2 = /^title\s*:?\s*(.+)$/.exec(s);
      if (title2) { title ??= cleanText(title2[1]); continue; }
      const decl = /^(?:create\s+)?(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/.exec(s);
      if (decl) { person(cleanText(decl[2]), decl[3] ? cleanText(decl[3]) : undefined, decl[1] === 'actor'); continue; }
      const act = /^(activate|deactivate)\s+(.+)$/.exec(s);
      if (act) { const who = cleanText(act[2]); person(who); body.push({ pad: depth(), text: `${act[1]} ${ref(who)}` }); continue; }
      if (/^(note|destroy|box|links?|properties|details)(\s|$)/i.test(s)) {
        if (/^box(\s|$)/i.test(s)) stack.push('rect');
        continue;
      }
      const block = /^(alt|opt|loop|par|break|critical|rect)\b\s*(.*)$/.exec(s);
      if (block) {
        if (block[1] === 'rect') { stack.push('rect'); continue; }
        const label = cleanText(block[2]);
        body.push({ pad: depth(), text: `${SEQ_BLOCK[block[1]]}${label ? ` [label: ${dValue(label)}]` : ''} {` });
        stack.push('block');
        continue;
      }
      const section = /^(else|and|option)\b\s*(.*)$/.exec(s);
      if (section && stack.at(-1) === 'block') {
        const label = cleanText(section[2]);
        const d = depth() - 1;
        body.push({ pad: d, text: '}' });
        body.push({ pad: d, text: `${SEQ_SECTION[section[1]]}${label ? ` [label: ${dValue(label)}]` : ''} {` });
        continue;
      }
      if (s === 'end') {
        if (stack.pop() === 'block') body.push({ pad: depth(), text: '}' });
        continue;
      }
      const m = SEQ_ARROW.exec(s) ?? SEQ_ARROW_NOLABEL.exec(s);
      if (!m) continue;
      const [, fromRaw, arrow, activation, toRaw, labelRaw] = m;
      const from = cleanText(fromRaw), to = cleanText(toRaw);
      person(from);
      person(to);
      const label = labelRaw ? cleanText(labelRaw) : '';
      body.push({ pad: depth(), text: `${ref(from)} ${SEQ_OP[arrow]} ${ref(to)}${label ? `: ${dLabel(label)}` : ''}` });
      if (activation === '+') body.push({ pad: depth(), text: `activate ${ref(to)}` });
      if (activation === '-') body.push({ pad: depth(), text: `deactivate ${ref(from)}` });
    }
  }
  while (stack.length) if (stack.pop() === 'block') body.push({ pad: depth(), text: '}' });

  const names = nameIds(people.map((p) => ({ id: p.id, label: p.label })));
  const nameAt = people.map((p) => dName(names.get(p.id)!));
  const out: string[] = [];
  if (title) out.push(`title ${title}`);
  if (autoNumber) out.push('autoNumber on');
  for (const p of people) {
    const name = names.get(p.id)!;
    const props: Record<string, string> = {};
    if (p.label !== name) props.label = p.label;
    if (p.actor) props.icon = 'user';
    out.push(`${dName(name)}${propList(props)}`);
  }
  if (body.length) out.push('');
  for (const l of body) out.push('  '.repeat(l.pad) + l.text.replace(/\u0000(\d+)\u0000/g, (_, i) => nameAt[Number(i)]));
  return { type: 'sequence' as const, code: out.join('\n') };
}

// ---- entity relationship ----

const ER_REL = /^("[^"]+"|[\w$-]+)\s+([|}][o|]|\|\||[|}]\|)(--|\.\.)([o|][|{]|\|\|)\s+("[^"]+"|[\w$-]+)\s*(?::\s*(.*))?$/;

function fromErd(lines: string[], title: string | undefined) {
  const tables: { name: string; columns: string[] }[] = [];
  const relations: string[] = [];
  const table = (name: string) => {
    let t = tables.find((x) => x.name === name);
    if (!t) { t = { name, columns: [] }; tables.push(t); }
    return t;
  };
  let open: ReturnType<typeof table> | null = null;
  const entity = (s: string) => cleanText(s.replace(/\[.*\]$/, '')).replace(/[\s.]+/g, '_');
  for (const raw of lines) {
    const s = raw.trim();
    if (!s) continue;
    if (open) {
      if (s === '}') { open = null; continue; }
      const col = /^([\w$()[\],-]+)\s+([\w$-]+)(?:\s+((?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*))?/i.exec(s);
      if (!col) continue;
      const attrs = (col[3] ?? '').split(',').map((k) => ({ pk: 'pk', fk: 'fk', uk: 'unique' } as Record<string, string>)[k.trim().toLowerCase()]).filter(Boolean);
      open.columns.push([col[2], col[1], ...attrs].join(' '));
      continue;
    }
    const block = /^("[^"]+"|[\w$-]+)(?:\s*\[[^\]]*\])?\s*\{\s*(\})?$/.exec(s);
    if (block) { const t = table(entity(block[1])); if (!block[2]) open = t; continue; }
    const rel = ER_REL.exec(s);
    if (rel) {
      const [, a, left, , right, b, labelRaw] = rel;
      const [from, to] = [entity(a), entity(b)];
      table(from); table(to);
      const manyL = left.startsWith('}'), manyR = right.endsWith('{');
      const op = manyL && manyR ? '<>' : manyL ? '>' : manyR ? '<' : '-';
      const label = labelRaw ? cleanText(labelRaw) : '';
      relations.push(`${dName(from)} ${op} ${dName(to)}${label ? `: ${dLabel(label)}` : ''}`);
      continue;
    }
    if (/^("[^"]+"|[\w$-]+)$/.test(s)) table(entity(s));
  }
  const out: string[] = [];
  if (title) out.push(`title ${title}`);
  for (const t of tables) {
    if (!t.columns.length) { out.push(dName(t.name)); continue; }
    out.push(`${dName(t.name)} {`, ...t.columns.map((c) => `  ${c}`), '}');
  }
  out.push(...relations);
  return { type: 'erd' as const, code: out.join('\n') };
}

/**
 * Converts Mermaid text to DevArt diagram code. Supports `flowchart`/`graph`, `sequenceDiagram`, and `erDiagram`.
 * Returns null for anything else, such as an empty string or another Mermaid diagram type.
 */
export function fromMermaid(text: string, opts: FromMermaidOptions = {}): { type: DiagramType; code: string } | null {
  const { lines, title } = preprocess(text);
  const at = lines.findIndex((l) => l && !/^%%\{.*\}%%$/.test(l));
  if (at < 0) return null;
  const header = lines[at];
  const rest = lines.slice(at + 1);
  if (/^(graph|flowchart)\b/i.test(header)) return fromFlowchart(rest, header, title, opts.graphAs ?? 'flowchart');
  if (/^sequenceDiagram\b/.test(header)) return fromSequence(rest, title);
  if (/^erDiagram\b/.test(header)) return fromErd(rest, title);
  return null;
}
