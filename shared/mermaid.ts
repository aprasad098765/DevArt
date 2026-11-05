// Converts DevArt diagram code to Mermaid. Layout, icons, and colours have no Mermaid equivalent and are dropped.
import { parseDiagram, type GraphEdge, type SeqItem } from './dsl.ts';
import type { DiagramType } from './types.ts';

const quote = (s: string) => `"${s.replace(/"/g, '#quot;')}"`;
const word = (s: string) => s.replace(/\W+/g, '_') || '_';
const DIRECTION: Record<string, string> = { right: 'LR', down: 'TD', left: 'RL', up: 'BT' };

function node(id: string, label: string, shape?: string, kind?: string) {
  const l = quote(label);
  if (kind === 'event') return `${id}((${l}))`;
  if (kind === 'gateway') return `${id}{${l}}`;
  switch (shape) {
    case 'rounded': return `${id}(${l})`;
    case 'oval': return `${id}([${l}])`;
    case 'diamond': return `${id}{${l}}`;
    case 'cylinder': return `${id}[(${l})]`;
    case 'hexagon': return `${id}{{${l}}}`;
    case 'parallelogram': return `${id}[/${l}/]`;
    case 'cloud': return `${id}(${l})`;
    default: return kind === 'activity' ? `${id}(${l})` : `${id}[${l}]`;
  }
}

function edgeLine(e: GraphEdge, ids: Map<string, string>) {
  let [a, b] = [ids.get(e.from)!, ids.get(e.to)!];
  let op = e.op;
  if (op === '<') { [a, b] = [b, a]; op = '>'; }
  const dashed = e.props.style === 'dashed';
  const arrow = op === '<>' ? (dashed ? '<-.->' : '<-->') : op === '-' ? (dashed ? '-.-' : '---') : op === '--' ? '-.-' : op === '-->' || dashed ? '-.->' : '-->';
  return e.label ? `  ${a} ${arrow}|${quote(e.label)}| ${b}` : `  ${a} ${arrow} ${b}`;
}

function graph(type: DiagramType, code: string) {
  const d = parseDiagram(type, code);
  const ids = new Map(d.nodes.map((n, i) => [n.id, `${n.isGroup ? 'g' : 'n'}${i + 1}`]));
  const out = [`flowchart ${DIRECTION[d.directives.direction ?? (type === 'flowchart' ? 'down' : 'right')] ?? 'LR'}`];
  const emit = (parent: string | undefined, depth: number) => {
    const pad = '  '.repeat(depth + 1);
    for (const n of d.nodes) {
      if (n.parent !== parent) continue;
      const label = n.props.label ?? n.id;
      if (n.isGroup) {
        out.push(`${pad}subgraph ${ids.get(n.id)}[${quote(label)}]`);
        emit(n.id, depth + 1);
        out.push(`${pad}end`);
      } else out.push(pad + node(ids.get(n.id)!, label, n.props.shape, n.props.type));
    }
  };
  emit(undefined, 0);
  for (const e of d.edges) out.push(edgeLine(e, ids));
  return out;
}

function erd(code: string) {
  const d = parseDiagram('erd', code);
  const out = ['erDiagram'];
  const name = (id: string) => quote(id);
  for (const t of d.tables) {
    out.push(`  ${name(t.props.label ?? t.id)} {`);
    for (const c of t.columns) {
      const keys = c.attrs.map((a) => ({ pk: 'PK', fk: 'FK', unique: 'UK' } as Record<string, string>)[a.toLowerCase()]).filter(Boolean);
      out.push(`    ${word(c.type || 'string')} ${word(c.name)}${keys.length ? ` ${keys.join(',')}` : ''}`);
    }
    out.push('  }');
  }
  const label = (id: string) => name(d.tables.find((t) => t.id === id)?.props.label ?? id);
  for (const r of d.relations) {
    const card = r.op === '<' ? '||--o{' : r.op === '-' ? '||--||' : r.op === '<>' ? '}o--o{' : '}o--||';
    out.push(`  ${label(r.from)} ${card} ${label(r.to)} : ${quote(r.label ?? '')}`);
  }
  return out;
}

function sequence(code: string) {
  const d = parseDiagram('sequence', code);
  const ids = new Map(d.participants.map((p, i) => [p.id, `p${i + 1}`]));
  const out = ['sequenceDiagram'];
  if (d.directives.autoNumber === 'on') out.push('  autonumber');
  for (const p of d.participants) out.push(`  participant ${ids.get(p.id)} as ${p.props.label ?? p.id}`);
  const arrows: Record<string, string> = { '>': '->>', '<': '->>', '<>': '<<->>', '-': '->', '--': '-->>', '-->': '-->>' };
  const walk = (items: SeqItem[], depth: number) => {
    const pad = '  '.repeat(depth + 1);
    for (const it of items) {
      if (it.kind === 'activate' || it.kind === 'deactivate') out.push(`${pad}${it.kind} ${ids.get(it.who)}`);
      else if (it.kind === 'message') {
        const [from, to] = it.op === '<' ? [it.to, it.from] : [it.from, it.to];
        out.push(`${pad}${ids.get(from)}${arrows[it.op] ?? '->>'}${ids.get(to)}: ${it.label ?? ''}`);
      } else if (it.kind === 'block') {
        const alt = it.block === 'par' ? 'and' : 'else';
        it.sections.forEach((s, i) => {
          out.push(`${pad}${i === 0 ? it.block : alt}${s.label ? ` ${s.label}` : ''}`);
          walk(s.items, depth + 1);
        });
        out.push(`${pad}end`);
      }
    }
  };
  walk(d.sequence, 0);
  return out;
}

export function toMermaid(type: DiagramType, code: string): string {
  const lines = type === 'erd' ? erd(code) : type === 'sequence' ? sequence(code) : graph(type, code);
  const title = parseDiagram(type, code).directives.title;
  return (title ? `---\ntitle: ${quote(title)}\n---\n` : '') + lines.join('\n');
}
