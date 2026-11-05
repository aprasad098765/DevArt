import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDiagram } from '../shared/dsl.ts';
import { addEdge, addNode, moveNode, relayout, removeEdge, removeNode, reverseEdge, setNodeProps, updateEdge, withOffsets } from '../shared/dslEdit.ts';
import { diagramSize, graphLayout, renderDiagram } from '../shared/render.ts';

const T = 'architecture' as const;
const CODE = `// Payments
direction right
Users [icon: users]
Cloud [icon: cloud, color: blue] {
  API [icon: gateway] // entry point
  Orders [icon: server]
}
DB [icon: database]
Users > API: HTTPS
API > Orders, DB
Orders [label: "Order service"] > Queue`;
const parse = (c: string) => parseDiagram(T, c);
const node = (c: string, id: string) => parse(c).nodes.find((n) => n.id === id);

test('changing one node leaves every other line, including comments, untouched', () => {
  const next = setNodeProps(T, CODE, 'DB', { label: 'Main database', color: 'green' });
  assert.deepEqual(node(next, 'DB')!.props, { icon: 'database', label: 'Main database', color: 'green' });
  assert.deepEqual(parse(next).issues, []);
  assert.ok(next.includes('API [icon: gateway] // entry point'));
  assert.ok(next.startsWith('// Payments'));
  assert.equal(parse(next).edges.length, parse(CODE).edges.length);
});

test('editing a node updates its one declaration instead of adding another', () => {
  const next = setNodeProps(T, CODE, 'DB', { label: 'Ledger' });
  assert.equal(next.split('\n').filter((l) => /^DB\b/.test(l.trim())).length, 1);
  const inline = setNodeProps(T, CODE, 'Orders', { label: undefined });
  assert.equal(node(inline, 'Orders')!.props.label, undefined, 'a value written inline on a connection can be cleared too');
});

test('a property can be cleared', () => {
  assert.equal(node(setNodeProps(T, CODE, 'Users', { icon: undefined }), 'Users')!.props.icon, undefined);
});

test('nodes only mentioned in connections can be edited, and stay in their group', () => {
  const next = setNodeProps(T, 'G {\n  A > B\n}', 'B', { color: 'red' });
  assert.equal(node(next, 'B')!.props.color, 'red');
  assert.equal(node(next, 'B')!.parent, 'G');
});

test('new values beat properties written inline on a connection', () => {
  const next = setNodeProps(T, CODE, 'Orders', { label: 'Renamed' });
  assert.equal(node(next, 'Orders')!.props.label, 'Renamed');
  assert.equal(node(next, 'Orders')!.parent, 'Cloud');
});

test('group properties can be edited', () => {
  const next = setNodeProps(T, CODE, 'Cloud', { label: 'AWS' });
  assert.equal(node(next, 'Cloud')!.props.label, 'AWS');
  assert.equal(node(next, 'Cloud')!.isGroup, true);
  assert.equal(node(next, 'API')!.parent, 'Cloud');
});

test('awkward labels survive the round trip safely', () => {
  const next = setNodeProps(T, CODE, 'DB', { label: 'a > b, "c": [d] {e}' });
  assert.deepEqual(parse(next).issues, []);
  assert.equal(parse(next).edges.length, parse(CODE).edges.length);
  assert.equal(node(next, 'DB')!.props.label, "a > b, 'c': [d] {e}");
});

test('adding nodes and groups picks unused names and the right parent', () => {
  const a = addNode(T, CODE, 'DB');
  assert.equal(a.id, 'DB 2');
  const b = addNode(T, CODE, 'Cache', { parent: 'Cloud', props: { icon: 'cache' } });
  assert.equal(node(b.code, 'Cache')!.parent, 'Cloud');
  const c = addNode(T, CODE, 'Zone', { group: true, parent: 'Cloud' });
  assert.equal(node(c.code, 'Zone')!.isGroup, true);
  assert.equal(node(c.code, 'Zone')!.parent, 'Cloud');
  assert.deepEqual(parse(c.code).issues, []);
});

test('deleting a node removes its connections but not its neighbours', () => {
  const next = removeNode(T, CODE, 'DB');
  const d = parse(next);
  assert.equal(d.nodes.some((n) => n.id === 'DB'), false);
  assert.equal(d.edges.some((e) => e.to === 'DB'), false);
  assert.ok(d.edges.some((e) => e.from === 'API' && e.to === 'Orders'), 'fan-out sibling kept');
  const lone = parse(removeNode(T, 'A > B', 'B'));
  assert.deepEqual(lone.nodes.map((n) => n.id), ['A'], 'the other end survives even if only mentioned there');
});

test('deleting keeps inline properties of surviving nodes', () => {
  const next = removeNode(T, CODE, 'Queue');
  assert.equal(node(next, 'Orders')!.props.label, 'Order service');
});

test('deleting a group removes what is inside it', () => {
  const d = parse(removeNode(T, CODE, 'Cloud'));
  assert.deepEqual(d.issues, []);
  for (const gone of ['Cloud', 'API', 'Orders']) assert.equal(d.nodes.some((n) => n.id === gone), false, gone);
  assert.ok(d.nodes.some((n) => n.id === 'Users'));
  assert.ok(d.nodes.some((n) => n.id === 'Queue'), 'the far end of a deleted connection stays');
});

test('nodes move into and out of groups, keeping properties', () => {
  const inside = moveNode(T, CODE, 'DB', 'Cloud')!;
  assert.equal(node(inside, 'DB')!.parent, 'Cloud');
  assert.equal(node(inside, 'DB')!.props.icon, 'database');
  const outside = moveNode(T, inside, 'DB', undefined)!;
  assert.equal(node(outside, 'DB')!.parent, undefined);
  const pinned = moveNode(T, 'G {\n  A > B\n}', 'A', undefined)!;
  assert.equal(node(pinned, 'A')!.parent, undefined, 'a connection written inside the group cannot hold it there');
  assert.equal(node(pinned, 'B')!.parent, 'G', 'and the other end stays');
  assert.equal(parse(pinned).edges.length, 1);
  const into = moveNode(T, 'A > B\nG {\n}', 'A', 'G')!;
  assert.equal(node(into, 'A')!.parent, 'G', 'a connection above the group cannot keep it out');
});

test('connections can be added, relabelled, restyled, and deleted', () => {
  const added = addEdge(CODE, 'Users', 'DB', 'reads');
  const d = parse(added);
  const i = d.edges.length - 1;
  assert.equal(d.edges[i].label, 'reads');
  const relabelled = parse(updateEdge(T, added, i, { label: 'writes', op: '<>' })).edges[i];
  assert.equal(relabelled.label, 'writes');
  assert.equal(relabelled.op, '<>');
  assert.equal(parse(removeEdge(T, added, i)).edges.length, i);
});

test('changing one branch of a fan-out leaves the other alone', () => {
  const d = parse(CODE);
  const i = d.edges.findIndex((e) => e.to === 'DB');
  const next = parse(updateEdge(T, CODE, i, { label: 'SQL' }));
  assert.equal(next.edges.find((e) => e.to === 'DB')!.label, 'SQL');
  assert.equal(next.edges.find((e) => e.to === 'Orders')!.label, undefined);
});

test('deleting a connection keeps both nodes and inline properties', () => {
  const i = parse(CODE).edges.findIndex((e) => e.to === 'Queue');
  const next = removeEdge(T, CODE, i);
  assert.ok(node(next, 'Queue'));
  assert.equal(node(next, 'Orders')!.props.label, 'Order service');
});

test('BPMN nodes are edited the same way', () => {
  const code = 'Sales {\n  Start [type: event]\n  Work [type: activity]\n}\nStart > Work';
  const next = setNodeProps('bpmn', code, 'Work', { label: 'Do work', type: 'gateway' });
  assert.equal(parseDiagram('bpmn', next).nodes.find((n) => n.id === 'Work')!.props.type, 'gateway');
  assert.deepEqual(renderDiagram('bpmn', next).issues, []);
});

test('the renderer marks connections for selection, and moving a group moves its contents', () => {
  const code = 'G {\n  A\n}\nB\nB > A';
  assert.match(renderDiagram(T, code).svg, /data-edge="0"/);
  const at = (svg: string) => Number(/data-node="A"[^>]*>.*?<rect x="([\d.]+)"/.exec(svg)![1]);
  const before = at(renderDiagram(T, code).svg);
  const after = at(renderDiagram(T, code, { nodeOffsets: { G: { x: 300, y: 0 } } }).svg);
  assert.equal(after, before + 300);
});

test('a connection can be reversed, keeping its label and look', () => {
  const code = 'A > B [color: red]: calls';
  const e = parse(reverseEdge(T, code, 0)).edges[0];
  assert.deepEqual([e.from, e.to, e.label, e.props.color], ['B', 'A', 'calls', 'red']);
});

test('connection line style can be set and cleared', () => {
  const dashed = updateEdge(T, 'A > B', 0, { props: { style: 'dashed' } });
  assert.equal(parse(dashed).edges[0].props.style, 'dashed');
  assert.equal(parse(updateEdge(T, dashed, 0, { props: {} })).edges[0].props.style, undefined);
});

const box = (code: string, nodeOffsets?: Record<string, { x: number; y: number }>) => ({ x: 100, y: 50, ...diagramSize({ diagramType: T, code, nodeOffsets }), w: diagramSize({ diagramType: T, code, nodeOffsets }).w, diagramType: T, code, nodeOffsets });
/** Where a node appears on the canvas. */
const onScreen = (el: any, id: string) => {
  const L = graphLayout(T, el.code, el.nodeOffsets);
  const b = L.boxes.get(id)!;
  const scale = el.w / diagramSize(el).w;
  return { x: Math.round(el.x + b.x * scale), y: Math.round(el.y + (b.y + L.titleY) * scale) };
};

test('adding a connection leaves every component where it is on screen', () => {
  const el = box('A\nB\nC\nD');
  const next = { ...el, ...relayout(el, addEdge(el.code, 'A', 'D')) };
  for (const id of ['A', 'B', 'C', 'D']) assert.deepEqual(onScreen(next, id), onScreen(el, id), id);
  assert.equal(parse(next.code!).edges.length, 1);
});

test('a new component lands exactly where it was dropped, on an empty diagram or a full one', () => {
  const empty = box('');
  const first = addNode(T, '', 'Service');
  const a = { ...empty, ...relayout(empty, first.code, { id: first.id, x: 400, y: 300 }) };
  assert.deepEqual(onScreen(a, first.id), { x: 400, y: 300 });
  const second = addNode(T, a.code!, 'Database');
  const b = { ...a, ...relayout(a as any, second.code, { id: second.id, x: 40, y: 900 }) };
  assert.deepEqual(onScreen(b, second.id), { x: 40, y: 900 }, 'even left of and above everything else');
  assert.deepEqual(onScreen(b, first.id), { x: 400, y: 300 }, 'and the first one stays put');
});

test('dragging towards the origin keeps other components still on screen', () => {
  const el = box('A > B');
  const before = onScreen(el, 'B');
  const next = { ...el, ...withOffsets(el, el.code, { A: { x: -500, y: -300 } }) };
  assert.deepEqual(onScreen(next, 'B'), before);
  assert.ok(next.x! < el.x, 'the box grows to hold the moved component');
});

test('resizing a component keeps its corner in place and is stored in the code', () => {
  const el = box('A [icon: server]\nB');
  const code = setNodeProps(T, el.code, 'A', { w: '240', h: '160' });
  const next = { ...el, ...relayout(el, code) };
  assert.deepEqual(onScreen(next, 'A'), onScreen(el, 'A'));
  const b = graphLayout(T, next.code!, next.nodeOffsets).boxes.get('A')!;
  assert.deepEqual([b.w, b.h], [240, 160]);
});

test('edits that do not change the layout keep automatic arrow routing', () => {
  const el = box('A > B > C');
  const next = relayout(el, setNodeProps(T, el.code, 'A', { color: 'blue' }));
  assert.equal(next.nodeOffsets, undefined);
});

test('moving a component into a group survives with its position kept', () => {
  const el = box('G {\n  X\n}\nA\nA > X');
  const moved = moveNode(T, el.code, 'A', 'G')!;
  const next = { ...el, ...relayout(el, moved) };
  assert.equal(node(next.code!, 'A')!.parent, 'G');
  assert.deepEqual(onScreen(next, 'A'), onScreen(el, 'A'));
});

test('style properties round-trip through the code, and clear cleanly', () => {
  const style = { shape: 'circle', border: 'thick', borderStyle: 'dashed', borderColor: '#ff0000', radius: 6, fill: 'blue', opacity: 0.5, textColor: '#ff0000', fontSize: 14, bold: true, italic: true, align: 'left', valign: 'top' };
  const next = setNodeProps(T, CODE, 'DB', style);
  assert.deepEqual(node(next, 'DB')!.props, {
    icon: 'database', shape: 'circle', border: 'thick', borderStyle: 'dashed', borderColor: '#ff0000', radius: '6', fill: 'blue',
    opacity: '0.5', textColor: '#ff0000', fontSize: '14', bold: 'true', italic: 'true', align: 'left', valign: 'top',
  });
  assert.deepEqual(parse(next).issues, []);
  assert.ok(next.includes('DB [icon: database, shape: circle, border: thick, borderStyle: dashed, borderColor: #ff0000, radius: 6'));
  const cleared = setNodeProps(T, next, 'DB', Object.fromEntries(Object.keys(style).map((k) => [k, k === 'bold' ? false : undefined])));
  assert.deepEqual(node(cleared, 'DB')!.props, { icon: 'database' });
  assert.equal(cleared, CODE, 'clearing every style property restores the original code');
});

test('style properties on a node only named in a connection get a declaration, and zero is kept', () => {
  const next = setNodeProps(T, CODE, 'Queue', { border: 0, opacity: '0', fill: '' });
  assert.deepEqual(node(next, 'Queue')!.props, { border: '0', opacity: '0' });
  assert.equal(parse(next).edges.length, parse(CODE).edges.length);
  const grouped = setNodeProps(T, CODE, 'Cloud', { borderStyle: 'dotted', fill: '#eef' });
  assert.deepEqual(node(grouped, 'Cloud')!.props, { icon: 'cloud', color: 'blue', borderStyle: 'dotted', fill: '#eef' });
  assert.ok(grouped.includes('Cloud [icon: cloud, color: blue, borderStyle: dotted, fill: #eef] {'));
});
