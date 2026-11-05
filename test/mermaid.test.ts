import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDiagram, SYNTAX_REFERENCE } from '../shared/dsl.ts';
import { toMermaid } from '../shared/mermaid.ts';
import { fromMermaid } from '../shared/fromMermaid.ts';
import type { DiagramType } from '../shared/types.ts';

const errors = (type: DiagramType, code: string) => parseDiagram(type, code).issues.filter((i) => i.severity === 'error');

function imported(text: string, opts?: Parameters<typeof fromMermaid>[1]) {
  const r = fromMermaid(text, opts);
  assert.ok(r, 'expected Mermaid to convert');
  assert.deepEqual(errors(r.type, r.code), [], r.code);
  return { ...r, d: parseDiagram(r.type, r.code) };
}

const edgeList = (d: ReturnType<typeof parseDiagram>) => d.edges.map((e) => `${e.from} ${e.op} ${e.to}${e.label ? `: ${e.label}` : ''}`);

for (const type of ['architecture', 'flowchart', 'sequence', 'erd'] as const) {
  test(`round trip: the ${type} sample survives DevArt -> Mermaid -> DevArt -> Mermaid`, () => {
    const mermaid = toMermaid(type, SYNTAX_REFERENCE[type]);
    const back = imported(mermaid);
    assert.equal(back.type, type === 'architecture' ? 'flowchart' : type);
    assert.equal(toMermaid(back.type, back.code), mermaid);
  });
}

test('round trip keeps the architecture sample\'s names, groups, and connections', () => {
  const src = parseDiagram('architecture', SYNTAX_REFERENCE.architecture);
  const { d, type } = imported(toMermaid('architecture', SYNTAX_REFERENCE.architecture), { graphAs: 'architecture' });
  assert.equal(type, 'architecture');
  assert.equal(d.directives.title, 'Checkout system');
  assert.equal(d.directives.direction, 'right');
  // Mermaid keeps what a node shows, so a node named API with label "Public API" comes back named "Public API".
  const shown = (x: typeof src) => {
    const label = (id?: string) => id && (x.nodes.find((n) => n.id === id)!.props.label ?? id);
    return { nodes: x.nodes.map((n) => [label(n.id), label(n.parent), n.isGroup]), edges: x.edges.map((e) => [label(e.from), label(e.to), e.label]) };
  };
  assert.deepEqual(shown(d), shown(src));
});

test('round trip keeps the sequence sample\'s participants, messages, and blocks', () => {
  const src = parseDiagram('sequence', SYNTAX_REFERENCE.sequence);
  const { d } = imported(toMermaid('sequence', SYNTAX_REFERENCE.sequence));
  assert.equal(d.directives.autoNumber, 'on');
  assert.deepEqual(d.participants.map((p) => p.id), src.participants.map((p) => p.id));
  const shape = (items: typeof d.sequence): unknown => items.map((it) => it.kind === 'message' ? `${it.from}>${it.to}:${it.label ?? ''}` : it.kind === 'block' ? [it.block, it.sections.map((s) => [s.label, shape(s.items)])] : `${it.kind} ${it.who}`);
  assert.deepEqual(shape(d.sequence), shape(src.sequence));
});

test('round trip keeps the ERD sample\'s tables, columns, and relationships', () => {
  const src = parseDiagram('erd', SYNTAX_REFERENCE.erd);
  const { d } = imported(toMermaid('erd', SYNTAX_REFERENCE.erd));
  assert.deepEqual(d.tables.map((t) => [t.id, t.columns]), src.tables.map((t) => [t.id, t.columns]));
  assert.deepEqual(d.relations.map((r) => [r.from, r.op, r.to, r.label]), src.relations.map((r) => [r.from, r.op, r.to, r.label]));
});

test('hand-written flowcharts: shapes, link forms, chains, &, subgraphs, and styles', () => {
  const { d, code } = imported(`%% a comment
graph TD;
  A[Start] --> B{Is it?};
  B -- Yes --> C(Rounded)
  B -.->|No| D[(Database)]
  C & D ==> E((Done))
  E --- F>Flag] <--> G[/Lean/]
  subgraph cloud [Cloud services]
    direction LR
    H{{Hex}} -.- I([Pill])
  end
  I ~~~ A
  H:::hot
  classDef hot fill:#f96,stroke:#333
  style A fill:#bbf,color:#fff,stroke-dasharray: 5 5
  click A "https://example.com"`);
  assert.equal(d.directives.direction, 'down');
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  assert.equal(byId.get('Is it?')!.props.shape, 'diamond');
  assert.equal(byId.get('Rounded')!.props.shape, 'rounded');
  assert.equal(byId.get('Database')!.props.shape, 'cylinder');
  assert.equal(byId.get('Done')!.props.shape, 'circle');
  assert.equal(byId.get('Hex')!.props.shape, 'hexagon');
  assert.equal(byId.get('Hex')!.parent, 'Cloud services');
  assert.equal(byId.get('Hex')!.props.fill, '#f96');
  assert.equal(byId.get('Start')!.props.fill, '#bbf');
  assert.equal(byId.get('Start')!.props.textColor, '#fff');
  assert.equal(byId.get('Start')!.props.borderStyle, 'dashed');
  assert.ok(byId.get('Cloud services')!.isGroup);
  assert.deepEqual(edgeList(d), [
    'Start > Is it?', 'Is it? > Rounded: Yes', 'Is it? --> Database: No', 'Rounded > Done', 'Database > Done',
    'Done - Flag', 'Flag <> Lean', 'Hex -- Pill',
  ]);
  assert.equal(d.edges.find((e) => e.from === 'Rounded')!.props.width, '3');
  assert.match(code, /Cloud services/);
});

test('repeated labels keep their Mermaid ids so nodes stay distinct', () => {
  const { d } = imported('flowchart LR\n  a[Worker] --> b[Worker]\n  title1[title page] --> c["Has: colon, comma"]');
  assert.deepEqual(d.nodes.map((n) => [n.id, n.props.label]), [['a', 'Worker'], ['b', 'Worker'], ['title page', undefined], ['Has: colon, comma', undefined]]);
  assert.equal(d.edges.length, 2);
});

test('hand-written sequence diagrams: aliases, actors, activation shorthand, notes, and blocks', () => {
  const { d } = imported(`sequenceDiagram
  title Login
  actor U as User
  participant S as Server
  U->>+S: POST /login
  Note right of S: checks the password
  rect rgb(200, 220, 255)
    critical Verify
      S-->>U: token
    option Locked
      S--)U: 423
    end
  end
  S-->>-U: done
  loop Every minute
    U-xS: ping
  end`);
  assert.equal(d.directives.title, 'Login');
  assert.deepEqual(d.participants.map((p) => [p.id, p.props.icon]), [['User', 'user'], ['Server', undefined]]);
  const kinds = d.sequence.map((it) => it.kind === 'block' ? `${it.block}:${it.sections.map((s) => s.label).join('|')}` : it.kind === 'message' ? `${it.from}${it.op}${it.to}` : `${it.kind} ${it.who}`);
  assert.deepEqual(kinds, ['User>Server', 'activate Server', 'alt:Verify|Locked', 'Server-->User', 'deactivate Server', 'loop:Every minute']);
});

test('hand-written ERDs: cardinalities, keys, quoted labels, and empty entities', () => {
  const { d } = imported(`erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE-ITEM : "contains items"
  CUSTOMER }|..|{ DELIVERY-ADDRESS : uses
  PRODUCT ||--|| SKU : ""
  CUSTOMER {
    string name
    string id PK "the key"
    int address_id FK, UK
  }
  SKU {}`);
  assert.deepEqual(d.tables.map((t) => t.id), ['CUSTOMER', 'ORDER', 'LINE-ITEM', 'DELIVERY-ADDRESS', 'PRODUCT', 'SKU']);
  assert.deepEqual(d.tables[0].columns, [{ name: 'name', type: 'string', attrs: [] }, { name: 'id', type: 'string', attrs: ['pk'] }, { name: 'address_id', type: 'int', attrs: ['fk', 'unique'] }]);
  assert.deepEqual(d.relations.map((r) => [r.from, r.op, r.to, r.label]), [
    ['CUSTOMER', '<', 'ORDER', 'places'], ['ORDER', '<', 'LINE-ITEM', 'contains items'], ['CUSTOMER', '<>', 'DELIVERY-ADDRESS', 'uses'], ['PRODUCT', '-', 'SKU', undefined],
  ]);
});

test('unsupported or empty input returns null', () => {
  for (const t of ['', '   \n', 'pie title Pets\n "Dogs" : 386', 'gantt\n title A', 'not mermaid at all']) assert.equal(fromMermaid(t), null, t);
});
