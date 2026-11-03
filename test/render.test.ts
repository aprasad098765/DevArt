import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDiagram, SYNTAX_REFERENCE } from '../shared/dsl.ts';
import { renderDiagram, renderCanvasSvg, esc } from '../shared/render.ts';
import { DIAGRAM_TYPES } from '../shared/types.ts';

for (const t of DIAGRAM_TYPES) {
  test(`${t}: the syntax reference sample renders without issues`, () => {
    const r = renderDiagram(t, SYNTAX_REFERENCE[t]);
    assert.deepEqual(r.issues, []);
    assert.match(r.svg, /^<svg /);
    assert.ok(r.width > 100 && r.height > 50);
  });
}

test('parses fan-out, chains, groups, and hyphenated names', () => {
  const d = parseDiagram('architecture', 'G {\n web-app\n}\nweb-app > a, b > c: hi');
  assert.equal(d.nodes.find((n) => n.id === 'web-app')?.parent, 'G');
  assert.equal(d.edges.length, 4);
  assert.equal(d.edges[0].label, 'hi');
});

test('a URL in a property is not treated as a comment', () => {
  const d = parseDiagram('architecture', 'A [link: "https://x.dev/a"] // real comment');
  assert.equal(d.nodes[0].props.link, 'https://x.dev/a');
});

test('reports unbalanced blocks with a line number', () => {
  const d = parseDiagram('architecture', 'A {\n B');
  assert.equal(d.issues[0].severity, 'error');
  assert.equal(d.issues[0].line, 1);
});

test('edges to groups and into empty groups do not crash layout', () => {
  const r = renderDiagram('architecture', 'G {\n H {\n a\n }\n}\nEmpty {\n}\nb > G\nb > Empty\na > G');
  assert.deepEqual(r.issues, []);
});

test('sequence alt/else closes properly', () => {
  const d = parseDiagram('sequence', 'alt [label: x] {\n A > B: 1\n}\nelse [label: y] {\n B > A: 2\n}\nA > B: after');
  assert.deepEqual(d.issues, []);
  assert.equal(d.sequence.length, 2);
  const block = d.sequence[0];
  assert.ok(block.kind === 'block' && block.sections.length === 2);
});

test('hostile labels and links are escaped or dropped', () => {
  const r = renderDiagram('architecture', 'x [label: "<script>alert(1)</script>", link: "javascript:alert(1)"]');
  assert.ok(!r.svg.includes('<script>'));
  assert.ok(!r.svg.includes('javascript:'));
  assert.equal(esc('"<'), '&quot;&lt;');
});

test('invalid colours never reach the output', () => {
  const r = renderDiagram('flowchart', 'x [color: "red\\" onload=\\"evil"]');
  assert.ok(!r.svg.includes('onload='));
});

test('presets flag rule violations', () => {
  const r = renderDiagram('architecture', 'bad name [color: red]', { preset: { nameRegex: '^[a-z]+$', allowedColors: ['blue'], requireIcons: true } });
  assert.equal(r.issues.length, 3);
});

test('an empty diagram renders, so a new canvas can start from nothing', () => {
  const r = renderDiagram('architecture', '');
  assert.deepEqual(r.issues, []);
  assert.match(r.svg, /^<svg /);
});

test('a component description appears under its name, and hostile text stays inert', () => {
  const r = renderDiagram('architecture', 'A [icon: server, description: "Handles <b>orders</b>"]');
  assert.match(r.svg, /Handles/);
  assert.ok(!r.svg.includes('<b>'));
  const plain = renderDiagram('architecture', 'A');
  const withNote = renderDiagram('architecture', 'A [description: "Some longer words here"]');
  assert.ok(withNote.height > plain.height, 'the node makes room');
});

test('a resized component keeps its size, within limits', () => {
  assert.ok(renderDiagram('architecture', 'A [w: 400, h: 300]').width >= 400);
  assert.ok(renderDiagram('architecture', 'A [w: 99999]').width < 800, 'absurd sizes are clamped');
  assert.deepEqual(renderDiagram('architecture', 'A [w: nonsense]').issues, []);
});

test('dragging a node moves its box and keeps the group around it', () => {
  const r = renderDiagram('architecture', 'G {\n a\n}\na > b', { nodeOffsets: { a: { x: 0, y: 500 } } });
  assert.ok(r.height > 500);
});

test('canvas: only unsafe image sources are dropped', () => {
  const base = { type: 'image', x: 0, y: 0, w: 10, h: 10, z: 0 } as const;
  const { svg } = renderCanvasSvg([
    { ...base, id: 'a', src: '/api/assets/ok' },
    { ...base, id: 'b', src: 'https://evil.test/x.png' },
    { ...base, id: 'c', src: 'data:image/svg+xml;base64,AA' },
  ]);
  assert.equal(svg.match(/<image /g)?.length, 1);
});

test('canvas: a frame export includes its contents only', () => {
  const { svg } = renderCanvasSvg([
    { id: 'f', type: 'frame', x: 0, y: 0, w: 100, h: 100, z: 0, title: 'Fig' },
    { id: 'in', type: 'text', x: 10, y: 10, w: 80, h: 20, z: 1, text: 'inside' },
    { id: 'out', type: 'text', x: 500, y: 10, w: 80, h: 20, z: 1, text: 'outside' },
  ], { only: 'f' });
  assert.ok(svg.includes('inside') && !svg.includes('outside'));
});

test('canvas: text stays readable on a pale fill in dark mode', () => {
  const { svg } = renderCanvasSvg([{ id: 's', type: 'shape', x: 0, y: 0, w: 200, h: 80, z: 0, fill: '#dbeafe', text: 'Hello' }], { theme: 'dark' });
  assert.match(svg, /fill="#1b1e24"[^>]*><tspan[^>]*>Hello/);
});

test('flow chart edges touch a diamond rather than its bounding box', () => {
  const { svg } = renderDiagram('flowchart', 'A [shape: diamond]\nB\nA > B', { background: false });
  const edgeStartY = Number(/<path d="M[\d.]+ ([\d.]+)/.exec(svg)![1]);
  const polygons = [...svg.matchAll(/<polygon points="([^"]+)"/g)].map((m) => m[1].split(' ').map((p) => p.split(',').map(Number)));
  const diamond = polygons.find((p) => p.length === 4)!;
  assert.equal(edgeStartY, Math.max(...diamond.map((p) => p[1])));
});

