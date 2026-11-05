// Diagram-as-code parser. One line-oriented grammar with a mode for each diagram type.
import { BORDER_STYLES, BORDER_WIDTHS, NODE_SHAPES, TEXT_ALIGNS, TEXT_VALIGNS, type DiagramIssue, type DiagramType } from './types.ts';

export type Props = Record<string, string>;

export interface GraphNode { id: string; props: Props; parent?: string; isGroup: boolean; line: number }
export interface GraphEdge { from: string; to: string; op: string; label?: string; props: Props; line: number }
export interface ErdColumn { name: string; type: string; attrs: string[] }
export interface ErdTable { id: string; props: Props; columns: ErdColumn[]; line: number }
export interface ErdRelation { from: string; fromCol?: string; to: string; toCol?: string; op: string; label?: string; line: number }

export type SeqItem =
  | { kind: 'message'; from: string; to: string; op: string; label?: string; props: Props; line: number }
  | { kind: 'activate' | 'deactivate'; who: string; line: number }
  | { kind: 'block'; block: string; label?: string; sections: { label?: string; items: SeqItem[] }[]; line: number };

export interface ParsedDiagram {
  type: DiagramType;
  directives: Props;
  nodes: GraphNode[];
  edges: GraphEdge[];
  tables: ErdTable[];
  relations: ErdRelation[];
  participants: { id: string; props: Props }[];
  sequence: SeqItem[];
  issues: DiagramIssue[];
}

const DIRECTIVES = new Set(['title', 'direction', 'colorMode', 'styleMode', 'typeface', 'autoNumber']);
// routing: elbow (default) | straight | curved   head: arrow (default) | open | diamond | none
export const CONNECTION_PROPS = new Set(['color', 'style', 'width', 'wrap', 'routing', 'head']);
const SEQ_BLOCKS = new Set(['alt', 'opt', 'loop', 'par', 'break', 'else', 'and']);

function unquote(s: string) {
  const t = s.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).replace(/\\"/g, '"') : t;
}

/** Strips `// comments`, ignoring any inside quotes or URLs in brackets. */
export function stripComment(line: string) {
  let quoted = false;
  let depth = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === '[') depth++;
    else if (!quoted && c === ']') depth--;
    else if (!quoted && depth === 0 && c === '/' && line[i + 1] === '/') return line.slice(0, i);
  }
  return line;
}

export function parseProps(s: string): Props {
  const props: Props = {};
  let cur = '';
  let quoted = false;
  const flush = () => {
    const i = cur.indexOf(':');
    if (i > 0) props[cur.slice(0, i).trim()] = unquote(cur.slice(i + 1));
    cur = '';
  };
  for (const c of s) {
    if (c === '"') quoted = !quoted;
    if (c === ',' && !quoted) flush();
    else cur += c;
  }
  flush();
  return props;
}

/** Splits `Name [props]` into its parts; the bracket group must be trailing. */
export function splitNameProps(s: string): { name: string; props: Props; bad?: boolean } {
  const t = s.trim();
  if (t.endsWith(']')) {
    const open = t.indexOf('[');
    if (open === -1) return { name: t, props: {}, bad: true };
    return { name: unquote(t.slice(0, open)), props: parseProps(t.slice(open + 1, -1)) };
  }
  return { name: unquote(t), props: {} };
}

/** Finds the first `:` outside quotes and brackets, separating a statement from its label. */
export function splitLabel(s: string): [string, string | undefined] {
  let quoted = false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (c === '[') depth++;
    else if (c === ']') depth--;
    else if (c === ':' && depth === 0) return [s.slice(0, i), unquote(s.slice(i + 1))];
  }
  return [s, undefined];
}

/** Tokenises `A > B <> C` outside quotes/brackets. `-` and `--` need surrounding spaces, so `web-app` stays one name. */
export function splitOps(s: string): { parts: string[]; ops: string[] } {
  const parts: string[] = [];
  const ops: string[] = [];
  let cur = '';
  let quoted = false;
  let depth = 0;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"') quoted = !quoted;
    if (!quoted && c === '[') depth++;
    if (!quoted && c === ']') depth--;
    if (!quoted && depth === 0) {
      const rest = s.slice(i);
      const op = ['<>', '-->', '>', '<'].find((o) => rest.startsWith(o));
      const spaced = /^(--|-)(?=\s)/.exec(rest);
      if (op) { parts.push(cur); ops.push(op); cur = ''; i += op.length; continue; }
      if (spaced && (i === 0 || /\s/.test(s[i - 1]))) { parts.push(cur); ops.push(spaced[1]); cur = ''; i += spaced[1].length; continue; }
    }
    cur += c;
    i++;
  }
  parts.push(cur);
  return { parts: parts.map((p) => p.trim()), ops };
}

export function splitCommas(s: string) {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  let depth = 0;
  for (const c of s) {
    if (c === '"') quoted = !quoted;
    if (!quoted && c === '[') depth++;
    if (!quoted && c === ']') depth--;
    if (c === ',' && !quoted && depth === 0) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

export function parseDiagram(type: DiagramType, code: string): ParsedDiagram {
  const d: ParsedDiagram = {
    type, directives: {}, nodes: [], edges: [], tables: [], relations: [], participants: [], sequence: [], issues: [],
  };
  const err = (line: number, message: string, severity: 'error' | 'warning' = 'error') =>
    d.issues.push({ line, message, severity });
  const lines = code.split(/\r?\n/);

  const nodeIndex = new Map<string, GraphNode>();
  const ensureNode = (id: string, line: number, parent?: string, isGroup = false, props: Props = {}) => {
    let n = nodeIndex.get(id);
    if (!n) {
      n = { id, props, parent, isGroup, line };
      nodeIndex.set(id, n);
      d.nodes.push(n);
    } else {
      Object.assign(n.props, props);
      if (isGroup) n.isGroup = true;
      if (parent && !n.parent) n.parent = parent;
    }
    return n;
  };

  const tableIndex = new Map<string, ErdTable>();
  const ensureTable = (id: string, line: number) => {
    let t = tableIndex.get(id);
    if (!t) { t = { id, props: {}, columns: [], line }; tableIndex.set(id, t); d.tables.push(t); }
    return t;
  };

  const participantIds = new Set<string>();
  const participant = (id: string, props: Props = {}) => {
    const existing = d.participants.find((p) => p.id === id);
    if (existing) Object.assign(existing.props, props);
    else { d.participants.push({ id, props }); participantIds.add(id); }
  };

  const groupStack: string[] = [];
  const openLines: number[] = [];
  let table: ErdTable | null = null;
  const seqStack: { label?: string; items: SeqItem[] }[][] = [];
  const seqItems = () => (seqStack.length ? seqStack[seqStack.length - 1].at(-1)!.items : d.sequence);

  lines.forEach((raw, idx) => {
    const line = idx + 1;
    let s = stripComment(raw).trim();
    if (!s) return;

    const dir = /^([A-Za-z]+)\s+(?!\[)(?![<>:{-])(.+)$/.exec(s);
    if (dir && DIRECTIVES.has(dir[1]) && !/[>{]/.test(dir[2])) {
      d.directives[dir[1]] = unquote(dir[2]);
      return;
    }

    if (type === 'erd') {
      if (table) {
        if (s === '}') { table = null; openLines.pop(); return; }
        const [name, ctype, ...attrs] = s.split(/\s+/);
        table.columns.push({ name: unquote(name), type: ctype ?? '', attrs });
        return;
      }
      if (s.endsWith('{')) {
        const { name, props } = splitNameProps(s.slice(0, -1));
        table = ensureTable(name, line);
        Object.assign(table.props, props);
        openLines.push(line);
        return;
      }
      if (s === '}') return err(line, 'Unexpected "}"');
      const [stmt, label] = splitLabel(s);
      const { parts, ops } = splitOps(stmt);
      if (!ops.length) {
        const { name, props } = splitNameProps(stmt);
        Object.assign(ensureTable(name, line).props, props);
        return;
      }
      for (let i = 0; i < ops.length; i++) {
        const [fromT, fromC] = parts[i].split('.');
        const [toT, toC] = (parts[i + 1] ?? '').split('.');
        if (!fromT || !toT) { err(line, 'Relationship needs an entity on both sides'); continue; }
        ensureTable(unquote(fromT), line);
        ensureTable(unquote(toT), line);
        d.relations.push({ from: unquote(fromT), fromCol: fromC, to: unquote(toT), toCol: toC, op: ops[i], label, line });
      }
      return;
    }

    if (type === 'sequence') {
      const closeOpen = /^\}\s*(else|and)\b(.*)\{$/.exec(s);
      if (closeOpen || s === '}') {
        if (!seqStack.length) return err(line, 'Unexpected "}"');
        if (s === '}') {
          // A closing brace may be followed by a sibling `else {`, so only pop when the next statement isn't one.
          const next = lines.slice(idx + 1).map((l) => stripComment(l).trim()).find(Boolean) ?? '';
          if (/^(else|and)\b.*\{$/.test(next)) return;
          seqStack.pop();
          openLines.pop();
          return;
        }
        const { props } = splitNameProps(closeOpen![2].trim() ? `x ${closeOpen![2].trim()}` : 'x');
        seqStack[seqStack.length - 1].push({ label: props.label, items: [] });
        return;
      }
      if (s.endsWith('{')) {
        const { name, props } = splitNameProps(s.slice(0, -1));
        const kw = name.trim().toLowerCase();
        if (!SEQ_BLOCKS.has(kw)) return err(line, `Unknown block "${name}". Use alt, else, opt, loop, par, and, or break`);
        if (kw === 'else' || kw === 'and') {
          if (!seqStack.length) return err(line, `"${kw}" must follow an alt or par block`);
          seqStack[seqStack.length - 1].push({ label: props.label, items: [] });
          return;
        }
        const sections = [{ label: props.label, items: [] as SeqItem[] }];
        seqItems().push({ kind: 'block', block: kw, label: props.label, sections, line });
        seqStack.push(sections);
        openLines.push(line);
        return;
      }
      const act = /^(activate|deactivate)\s+(.+)$/.exec(s);
      if (act) {
        const who = unquote(act[2]);
        participant(who);
        seqItems().push({ kind: act[1] as 'activate' | 'deactivate', who, line });
        return;
      }
      const [stmt, label] = splitLabel(s);
      const { parts, ops } = splitOps(stmt);
      if (!ops.length) {
        const { name, props } = splitNameProps(stmt);
        participant(name, props);
        return;
      }
      for (let i = 0; i < ops.length; i++) {
        const a = splitNameProps(parts[i]);
        const b = splitNameProps(parts[i + 1] ?? '');
        if (!a.name || !b.name) { err(line, 'Message needs a participant on both sides'); continue; }
        participant(a.name, Object.fromEntries(Object.entries(a.props).filter(([k]) => !CONNECTION_PROPS.has(k))));
        participant(b.name, Object.fromEntries(Object.entries(b.props).filter(([k]) => !CONNECTION_PROPS.has(k))));
        seqItems().push({ kind: 'message', from: a.name, to: b.name, op: ops[i], label, props: b.props, line });
      }
      return;
    }

    // architecture, flowchart, bpmn
    if (s === '}') {
      if (!groupStack.length) return err(line, 'Unexpected "}"');
      groupStack.pop();
      openLines.pop();
      return;
    }
    if (s.endsWith('{')) {
      const { name, props } = splitNameProps(s.slice(0, -1));
      if (!name) return err(line, 'Group needs a name');
      ensureNode(name, line, groupStack.at(-1), true, props);
      groupStack.push(name);
      openLines.push(line);
      return;
    }
    const [stmt, label] = splitLabel(s);
    const { parts, ops } = splitOps(stmt);
    if (!ops.length) {
      for (const part of splitCommas(stmt)) {
        const { name, props, bad } = splitNameProps(part);
        if (bad || !name) { err(line, `Could not parse "${part}"`); continue; }
        ensureNode(name, line, groupStack.at(-1), false, props);
      }
      return;
    }
    for (let i = 0; i < ops.length; i++) {
      const left = splitCommas(parts[i]);
      const right = splitCommas(parts[i + 1] ?? '');
      if (!left.length || !right.length) { err(line, 'Connection needs a node on both sides'); continue; }
      const edgeProps: Props = {};
      const touch = (part: string) => {
        const { name, props } = splitNameProps(part);
        const nodeProps: Props = {};
        for (const [k, v] of Object.entries(props)) (CONNECTION_PROPS.has(k) ? edgeProps : nodeProps)[k] = v;
        ensureNode(name, line, groupStack.at(-1), false, nodeProps);
        return name;
      };
      const from = left.map(touch);
      const to = right.map(touch);
      for (const a of from) for (const b of to) d.edges.push({ from: a, to: b, op: ops[i], label, props: { ...edgeProps }, line });
    }
  });

  if (openLines.length) err(openLines.at(-1)!, 'Block is never closed; missing "}"');
  if (d.directives.direction && !['right', 'down', 'left', 'up'].includes(d.directives.direction)) {
    err(1, `Unknown direction "${d.directives.direction}". Use right, down, left, or up`, 'warning');
  }
  if (type === 'bpmn') {
    const allowed = new Set(['activity', 'event', 'gateway']);
    for (const n of d.nodes) {
      if (!n.isGroup && n.props.type && !allowed.has(n.props.type)) err(n.line, `Unknown BPMN type "${n.props.type}"`, 'warning');
    }
  }
  if (type === 'architecture' || type === 'flowchart') for (const n of d.nodes) styleIssues(n, err);
  return d;
}

const isNum = (v: string) => v.trim() !== '' && Number.isFinite(Number(v));
const oneOf = (list: readonly string[]) => (v: string) => list.includes(v);
/** Checks for each node style property; a failing value is ignored by the renderer and reported as a warning. */
const STYLE_CHECKS: Record<string, [ok: (v: string) => boolean, hint: string]> = {
  shape: [oneOf(NODE_SHAPES), NODE_SHAPES.join(', ')],
  border: [(v) => Object.hasOwn(BORDER_WIDTHS, v) || isNum(v), `${Object.keys(BORDER_WIDTHS).join(', ')}, or a number`],
  borderStyle: [oneOf(BORDER_STYLES), BORDER_STYLES.join(', ')],
  align: [oneOf(TEXT_ALIGNS), TEXT_ALIGNS.join(', ')],
  valign: [oneOf(TEXT_VALIGNS), TEXT_VALIGNS.join(', ')],
  radius: [isNum, 'a number'],
  fontSize: [isNum, 'a number'],
  opacity: [(v) => /^\d*\.?\d+%?$/.test(v.trim()), 'a number from 0 to 1, or a percentage'],
  bold: [oneOf(['true', 'false']), 'true or false'],
  italic: [oneOf(['true', 'false']), 'true or false'],
};

function styleIssues(n: GraphNode, err: (line: number, message: string, severity: 'warning') => void) {
  for (const [key, [ok, hint]] of Object.entries(STYLE_CHECKS)) {
    const v = n.props[key];
    if (v !== undefined && !ok(v)) err(n.line, `Unknown ${key} "${v}" on "${n.id}". Use ${hint}`, 'warning');
  }
}

export const SYNTAX_REFERENCE: Record<DiagramType, string> = {
  architecture: `// Architecture diagram
direction right            // right | down | left | up
title Checkout system

Client [icon: laptop]
AWS [icon: cloud, color: orange] {
  VPC [icon: network] {
    API [icon: gateway, label: "Public API"]
    Orders [icon: server, color: blue, description: "Takes and tracks orders"]
  }
  DB [icon: database, color: green]
}
Client > API: HTTPS
API > Orders
Orders <> DB [color: green]: SQL
Cache [shape: cylinder, fill: "#fef3c7", border: thick, borderStyle: dashed, textColor: "#92400e", bold: true]
Orders > Cache [style: dashed]
// Operators: > < <> - -- -->   Fan-out: A > B, C   Chains: A > B > C
// Node properties: icon, color, label, description, link, w, h, plus the style properties below
// Style: shape: rect | rounded | circle | oval | diamond | hexagon | cylinder | parallelogram | triangle | document | cloud
//   border: none | thin | medium | thick | <px>   borderStyle: solid | dashed | dotted   borderColor: <colour>   radius: <px>
//   fill: <colour> | none   opacity: 0-1 or 50%   textColor: <colour>   fontSize: <px>   bold: true   italic: true
//   align: left | center | right   valign: top | middle | bottom
// Colours: blue, green, red, orange, purple, yellow, pink, gray, teal, black, white, or hex like "#ff0000"`,
  flowchart: `// Flow chart
direction down
Start [shape: oval, color: green]
Valid? [shape: diamond]
Save [shape: cylinder]
Report [shape: document]
Stop [shape: oval, color: red]
Start > Valid?
Valid? > Save: yes
Valid? > Stop: no
Retry [shape: circle, border: medium, borderStyle: dotted, fontSize: 12, italic: true]
Save > Report > Stop
Valid? > Retry: maybe
// Shapes: rect, rounded, circle, oval, diamond, cylinder, hexagon, parallelogram, triangle, document, cloud
// Style: border: none | thin | medium | thick | <px>   borderStyle: solid | dashed | dotted   borderColor: <colour>   radius: <px>
//   fill: <colour> | none   opacity: 0-1 or 50%   textColor: <colour>   fontSize: <px>   bold: true   italic: true
//   align: left | center | right   valign: top | middle | bottom   Colours: named (blue, red, ...) or hex like "#ff0000"`,
  erd: `// Entity relationship diagram
users [icon: user, color: blue] {
  id uuid pk
  email string unique
  team_id uuid fk
}
teams {
  id uuid pk
  name string
}
users.team_id > teams.id: belongs to
// > many-to-one   < one-to-many   - one-to-one   <> many-to-many`,
  sequence: `// Sequence diagram
autoNumber on
Browser [icon: globe]
API [icon: gateway, color: blue]
DB [icon: database, color: green]

Browser > API: POST /login
activate API
API > DB: find user
alt [label: found] {
  DB --> API: user
  API --> Browser: 200 OK
}
else [label: missing] {
  API --> Browser: 401
}
deactivate API
// Blocks: alt/else, opt, loop, par/and, break. Dashed return: --> or --`,
  bpmn: `// BPMN swimlane
direction right
Customer [color: blue] {
  Order placed [type: event]
  Pay [type: activity]
}
Warehouse [color: green] {
  In stock? [type: gateway]
  Ship [type: activity]
  Done [type: event]
}
Order placed > Pay > In stock?
In stock? > Ship: yes
In stock? > Done: no
Ship > Done
// Node types: activity, event, gateway. Nest lanes in a pool for multiple pools.`,
};
