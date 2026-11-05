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

test('flow chart edges start a small, fixed gap from a diamond rather than its bounding box', () => {
  const { svg } = renderDiagram('flowchart', 'A [shape: diamond]\nB\nA > B', { background: false });
  const edgeStartY = Number(/<path d="M[\d.]+ ([\d.]+)/.exec(svg)![1]);
  const polygons = [...svg.matchAll(/<polygon points="([^"]+)"/g)].map((m) => m[1].split(' ').map((p) => p.split(',').map(Number)));
  const diamond = polygons.find((p) => p.length === 4)!;
  assert.equal(edgeStartY, Math.max(...diamond.map((p) => p[1])) + 3);
});

// ---- connectors ----

const edgePaths = (svg: string) => [...svg.matchAll(/<g data-edge="(\d+)"><path d="([^"]+)"/g)].map((m) => ({ index: Number(m[1]), d: m[2] }));

test('connectors are orthogonal with rounded corners by default', () => {
  const { svg } = renderDiagram('architecture', 'A\nB [w: 96, h: 200]\nC\nA > C\nB > C', { background: false });
  const paths = edgePaths(svg);
  assert.equal(paths.length, 2);
  for (const { d } of paths) {
    assert.match(d, /^M[\d.]+ [\d.]+(L[\d.]+ [\d.]+|Q[\d.]+ [\d.]+ [\d.]+ [\d.]+)*$/, 'only straight runs and rounded corners');
    assert.doesNotMatch(d, /C/, 'no free-form curves');
  }
});

test('routing and head props: straight, curved, and each end marker', () => {
  const straight = edgePaths(renderDiagram('architecture', 'A\nB\nA > B [routing: straight]').svg)[0].d;
  assert.match(straight, /^M[\d.]+ [\d.]+L[\d.]+ [\d.]+$/);
  const curved = edgePaths(renderDiagram('architecture', 'A\nB\nA > B [routing: curved]').svg)[0].d;
  assert.match(curved, /C/);
  const marker = (head: string) => /<g data-edge="0">(.*?)<\/g>/.exec(renderDiagram('architecture', `A > B [head: ${head}]`).svg)![1];
  assert.match(marker('arrow'), /<polygon points="[^"]+"/);
  assert.equal(marker('diamond').match(/<polygon points="([^"]+)"/)![1].split(' ').length, 4);
  assert.match(marker('open'), /<path d="M[^"]+" fill="none"[^>]*stroke-linecap="round"/);
  assert.doesNotMatch(marker('none'), /<polygon/);
  const d = parseDiagram('architecture', 'A > B [routing: curved, head: open]');
  assert.deepEqual(d.edges[0].props, { routing: 'curved', head: 'open' });
  assert.deepEqual(d.nodes[1].props, {}, 'connection props stay off the node');
});

test('edge labels get a background box and do not overlap each other', () => {
  const { svg } = renderDiagram('architecture', 'A > B, C, D: calls', { background: false });
  const edgeMarkup = [...svg.matchAll(/<g data-edge="\d+">(.*?)<\/g>/g)].map((m) => m[1]).join('');
  const boxes = [...edgeMarkup.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="4" fill="#ffffff"/g)]
    .map((m) => m.slice(1, 5).map(Number));
  assert.equal(boxes.length, 3);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const [a, b] = [boxes[i], boxes[j]];
    assert.ok(a[0] >= b[0] + b[2] || b[0] >= a[0] + a[2] || a[1] >= b[1] + b[3] || b[1] >= a[1] + a[3], 'labels overlap');
  }
});

test('connectors re-route from dragged positions', () => {
  const code = 'A\nB\nA > B';
  const before = edgePaths(renderDiagram('architecture', code).svg)[0].d;
  const after = edgePaths(renderDiagram('architecture', code, { nodeOffsets: { B: { x: 0, y: 300 } } }).svg)[0].d;
  assert.notEqual(before, after);
  assert.match(after, /Q/, 'the moved connector bends at right angles');
});

test('BPMN flows are routed around tasks in the way', () => {
  const { svg, issues } = renderDiagram('bpmn', SYNTAX_REFERENCE.bpmn, { background: false });
  assert.deepEqual(issues, []);
  assert.equal(edgePaths(svg).length, 5);
});


// ---- node style properties ----

const nodeSvg = (type: 'architecture' | 'flowchart', code: string, id = 'A') => {
  const { svg, issues } = renderDiagram(type, code, { background: false });
  assert.deepEqual(issues, [], `no issues for ${code}`);
  const m = new RegExp(`<g data-node="${id}"[^>]*>(.*?)</g>`).exec(svg);
  assert.ok(m, `node ${id} is drawn`);
  return { svg, open: m[0].slice(0, m[0].indexOf('>') + 1), body: m[1] };
};

test('style: border width, style and colour reach the outline', () => {
  for (const type of ['architecture', 'flowchart'] as const) {
    const { body } = nodeSvg(type, 'A [border: thick, borderStyle: dashed, borderColor: red]');
    assert.match(body, /stroke="#e5484d" stroke-width="3.5" stroke-dasharray="7 5"/);
    assert.match(nodeSvg(type, 'A [border: thin, borderStyle: dotted]').body, /stroke-width="1" stroke-dasharray="1.5 5"/);
    assert.match(nodeSvg(type, 'A [border: 6]').body, /stroke-width="6"/);
    assert.match(nodeSvg(type, 'A [border: none]').body, /stroke="none"/);
  }
  assert.match(nodeSvg('architecture', 'A [border: 999]').body, /stroke-width="20"/, 'widths are clamped');
});

test('style: fill, opacity and text colour; text stays readable on a dark fill', () => {
  const { open, body } = nodeSvg('architecture', 'A [fill: "#112233", opacity: 0.5]');
  assert.match(body, /fill="#112233"/);
  assert.match(open, /opacity="0.5"/);
  assert.match(body, /<text[^>]*fill="#f4f5f7"/, 'automatic light text on a dark fill');
  assert.match(nodeSvg('architecture', 'A [opacity: "40%"]').open, /opacity="0.4"/);
  assert.match(nodeSvg('flowchart', 'A [textColor: "#ff0000"]').body, /<text[^>]*fill="#ff0000"/);
  assert.match(nodeSvg('flowchart', 'A [fill: none]').body, /fill="transparent"/);
});

test('style: font size, bold and italic', () => {
  const { body } = nodeSvg('flowchart', 'A [fontSize: 20, bold: true, italic: true]');
  assert.match(body, /<text[^>]*font-size="20"[^>]*font-weight="700" font-style="italic"/);
  assert.ok(renderDiagram('architecture', 'Orders [fontSize: 30]').width > renderDiagram('architecture', 'Orders').width, 'bigger text makes room');
  assert.doesNotMatch(nodeSvg('architecture', 'A [bold: false]').body, /font-weight/);
});

test('style: align and valign move the label inside the component', () => {
  const box = (body: string) => /<(?:rect|polygon|ellipse|path) [^>]*/.exec(body)![0];
  const textAt = (body: string) => {
    const m = /<text x="([\d.]+)" y="([\d.]+)"[^>]*text-anchor="(\w+)"/.exec(body)!;
    return { x: Number(m[1]), y: Number(m[2]), anchor: m[3] };
  };
  for (const type of ['architecture', 'flowchart'] as const) {
    const base = 'A [w: 300, h: 200';
    const left = nodeSvg(type, `${base}, align: left, valign: top]`).body;
    const right = nodeSvg(type, `${base}, align: right, valign: bottom]`).body;
    const mid = nodeSvg(type, `${base}]`).body;
    const x0 = Number(/x="([\d.]+)"/.exec(box(mid))![1]), y0 = Number(/y="([\d.]+)"/.exec(box(mid))![1]);
    assert.equal(textAt(left).anchor, 'start');
    assert.equal(textAt(right).anchor, 'end');
    assert.equal(textAt(mid).anchor, 'middle');
    assert.ok(textAt(left).x < x0 + 40 && textAt(right).x > x0 + 260, `${type}: left and right sit near the edges`);
    assert.ok(textAt(left).y < y0 + 40 && textAt(right).y > y0 + 160, `${type}: top and bottom sit near the edges`);
    assert.ok(Math.abs(textAt(mid).y - (y0 + 100)) < 1, `${type}: default is centred`);
  }
});

test('style: every shape renders for architecture and flow chart nodes, and circles stay round', () => {
  for (const type of ['architecture', 'flowchart'] as const) {
    for (const shape of ['rect', 'rounded', 'circle', 'oval', 'diamond', 'hexagon', 'cylinder', 'parallelogram', 'triangle', 'document', 'cloud']) {
      const { body } = nodeSvg(type, `A [shape: ${shape}]\nB\nA > B`);
      assert.match(body, /<(rect|ellipse|polygon|path) /, `${type} ${shape}`);
    }
    const { body } = nodeSvg(type, 'A [shape: circle, label: "A rather long service name"]');
    const m = /<ellipse [^>]*rx="([\d.]+)" ry="([\d.]+)"/.exec(body)!;
    assert.equal(m[1], m[2], `${type}: a circle is round`);
  }
  assert.match(nodeSvg('architecture', 'A [shape: diamond]').body, /<polygon /, 'architecture honours shape');
  assert.match(nodeSvg('architecture', 'A [icon: server, shape: hexagon]').body, /<polygon /, 'a styled icon node draws its outline');
  assert.doesNotMatch(nodeSvg('architecture', 'A [icon: server]').body, /<polygon /);
});

test('style: radius rounds a rect, and a group takes style properties too', () => {
  assert.match(nodeSvg('architecture', 'A [radius: 12]').body, /rx="12"/);
  const { open, body } = nodeSvg('architecture', 'G [fill: "#eeeeee", border: medium, borderStyle: dotted, opacity: 0.7, textColor: blue] {\n  A\n}', 'G');
  assert.match(open, /opacity="0.7"/);
  assert.match(body, /fill="#eeeeee"[^>]*stroke-width="2"[^>]*stroke-dasharray="1.5 5"/);
  assert.match(body, /<text[^>]*fill="#3b82f6"/);
});

test('style: bad values are ignored with a warning, and never reach the output', () => {
  const r = renderDiagram('architecture', 'A [shape: blob, border: huge, borderStyle: wavy, align: middle, valign: center, fontSize: big, opacity: lots, textColor: "red\\" onload=\\"x", fill: "url(evil)"]');
  assert.equal(r.issues.filter((i) => i.severity === 'warning').length, 7);
  assert.ok(!r.svg.includes('onload') && !r.svg.includes('url(evil)'));
  assert.match(r.svg, /<rect [^>]*stroke-width="1.3"/, 'falls back to the defaults');
});

test('style: properties written on a connection stay on the node, not the arrow', () => {
  const d = parseDiagram('architecture', 'A [border: thick, fill: red, width: 3] > B');
  assert.deepEqual(d.nodes[0].props, { border: 'thick', fill: 'red' });
  assert.deepEqual(d.edges[0].props, { width: '3' });
});

test('mermaid export keeps the shape and ignores style properties', async () => {
  const { toMermaid } = await import('../shared/mermaid.ts');
  const out = toMermaid('flowchart', 'A [shape: circle, border: thick, fill: red, textColor: blue, align: left]\nA > B');
  assert.match(out, /n1\(\("A"\)\)/);
  assert.doesNotMatch(out, /thick|red|blue|left/);
});
