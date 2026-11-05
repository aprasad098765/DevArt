import test from 'node:test';
import assert from 'node:assert/strict';
import { pickSides, placeLabels, roundedPath, routeEdges, simplify, trimRoute, type Box, type Route, type RouteNode } from '../shared/route.ts';
import type { Point } from '../shared/types.ts';

const node = (id: string, x: number, y: number, w = 100, h = 50, extra: Partial<RouteNode> = {}): RouteNode => ({ id, box: { x, y, w, h }, ...extra });
const inside = (p: Point, b: Box) => p.x > b.x + 0.5 && p.x < b.x + b.w - 0.5 && p.y > b.y + 0.5 && p.y < b.y + b.h - 0.5;
/** Whether any part of a polyline passes through the box. */
const crosses = (pts: Point[], b: Box) => pts.slice(0, -1).some((p, i) => {
  const q = pts[i + 1];
  for (let k = 0; k <= 40; k++) if (inside({ x: p.x + ((q.x - p.x) * k) / 40, y: p.y + ((q.y - p.y) * k) / 40 }, b)) return true;
  return false;
});
const orthogonal = (pts: Point[]) => pts.slice(0, -1).every((p, i) => Math.abs(p.x - pts[i + 1].x) < 0.01 || Math.abs(p.y - pts[i + 1].y) < 0.01);

test('sides follow the flow direction when there is room, and face each other otherwise', () => {
  const a = { x: 0, y: 0, w: 100, h: 50 };
  assert.deepEqual(pickSides(a, { x: 300, y: 200, w: 100, h: 50 }, 'right'), ['right', 'left']);
  assert.deepEqual(pickSides(a, { x: 300, y: 200, w: 100, h: 50 }, 'down'), ['bottom', 'top']);
  assert.deepEqual(pickSides(a, { x: 0, y: 200, w: 100, h: 50 }, 'right'), ['bottom', 'top'], 'stacked nodes connect vertically');
  assert.deepEqual(pickSides({ x: 300, y: 0, w: 100, h: 50 }, a, 'right'), ['left', 'right'], 'a back edge leaves the near side');
});

test('an elbow route is orthogonal, keeps a gap from both shapes, and leaves straight out of the side', () => {
  const [r] = routeEdges([node('A', 0, 0), node('B', 300, 150)], [{ from: 'A', to: 'B' }], { direction: 'right', gap: 3 });
  assert.ok(r);
  assert.ok(orthogonal(r.points));
  assert.deepEqual(r.points[0], { x: 103, y: 25 });
  assert.deepEqual(r.points.at(-1), { x: 297, y: 175 });
  assert.equal(r.points.length, 4, 'one Z bend');
  assert.equal(r.points[1].x, r.points[2].x);
  assert.ok(Math.abs(r.points[1].x - 200) < 1, 'the bend sits midway between the shapes');
});

test('routes go around a shape in the way instead of through it', () => {
  const blocker = node('X', 200, -20, 80, 90);
  const [r] = routeEdges([node('A', 0, 0), blocker, node('B', 400, 0)], [{ from: 'A', to: 'B' }], { direction: 'right' });
  assert.ok(r && orthogonal(r.points));
  assert.ok(!crosses(r.points, blocker.box), JSON.stringify(r.points));
  assert.ok(r.points.length > 2, 'it bends to get round');
});

test('groups are avoided by outside edges but crossed by edges that end inside them', () => {
  const nodes = [node('A', 0, 0), node('G', 180, -60, 160, 170, { group: true }), node('In', 210, 0, 100, 50, { parent: 'G' }), node('B', 450, 0)];
  const [outside, into] = routeEdges(nodes, [{ from: 'A', to: 'B' }, { from: 'A', to: 'In' }], { direction: 'right' });
  assert.ok(!crosses(outside!.points, nodes[1].box), 'goes around the group');
  assert.equal(into!.points.length, 2, 'straight into the group member');
});

test('edges entering one side are spread out evenly, in order', () => {
  const nodes = [node('A', 0, 0), node('B', 0, 120), node('C', 0, 240), node('T', 300, 100, 100, 120)];
  const routes = routeEdges(nodes, ['A', 'B', 'C'].map((from) => ({ from, to: 'T' })), { direction: 'right' });
  const ends = routes.map((r) => r!.points.at(-1)!);
  assert.ok(ends.every((p) => p.x === 297), 'all on the left side');
  const ys = ends.map((p) => p.y);
  assert.ok(ys[0] < ys[1] && ys[1] < ys[2], 'top source enters highest');
  assert.ok(Math.abs((ys[1] - ys[0]) - (ys[2] - ys[1])) < 0.01, 'evenly spaced');
  assert.ok(ys[0] > 100 && ys[2] < 220, 'kept on the side');
});

test('a fan-out shares one port and a trunk before splitting', () => {
  const nodes = [node('S', 0, 100), node('A', 300, 0), node('B', 300, 100), node('C', 300, 200)];
  const routes = routeEdges(nodes, ['A', 'B', 'C'].map((to) => ({ from: 'S', to })), { direction: 'right' });
  const starts = routes.map((r) => r!.points[0]);
  assert.ok(starts.every((p) => p.x === starts[0].x && p.y === starts[0].y), 'one shared port');
  // The trunk: every branch runs along the same line out of the port before turning.
  const firstTurn = routes.filter((r) => r!.points.length > 2).map((r) => r!.points[1]);
  assert.ok(firstTurn.length >= 2);
  assert.ok(firstTurn.every((p) => Math.abs(p.x - firstTurn[0].x) < 0.01 && p.y === starts[0].y), 'they split at the same place');
  assert.ok(new Set(routes.map((r) => r!.bundle)).size === 1);
});

test('edges with a start arrowhead do not bundle', () => {
  const nodes = [node('S', 0, 100), node('A', 300, 0), node('B', 300, 200)];
  const routes = routeEdges(nodes, [{ from: 'S', to: 'A', bundle: false }, { from: 'S', to: 'B', bundle: false }], { direction: 'right' });
  assert.notDeepEqual(routes[0]!.points[0], routes[1]!.points[0]);
});

test('ports on a diamond or ellipse land on the outline', () => {
  const [r] = routeEdges([node('D', 0, 0, 100, 100, { shape: 'diamond' }), node('B', 0, 300)], [{ from: 'D', to: 'B' }], { direction: 'down', gap: 0 });
  assert.deepEqual(r!.points[0], { x: 50, y: 100 });
  const routes = routeEdges(
    [node('E', 0, 0, 100, 100, { shape: 'ellipse' }), node('X', 300, -100), node('Y', 300, 150)],
    [{ from: 'X', to: 'E' }, { from: 'Y', to: 'E' }], { direction: 'right', gap: 0 });
  for (const r2 of routes) {
    const p = r2!.points.at(-1)!;
    assert.ok(Math.abs(Math.hypot((p.x - 50) / 50, (p.y - 50) / 50) - 1) < 0.01, `${p.x},${p.y} on the ellipse`);
  }
});

test('straight and curved routes', () => {
  const nodes = [node('A', 0, 0), node('B', 300, 150)];
  const [s, c] = routeEdges(nodes, [{ from: 'A', to: 'B', routing: 'straight' }, { from: 'A', to: 'B', routing: 'curved' }]);
  assert.equal(s!.points.length, 2);
  assert.equal(s!.routing, 'straight');
  assert.ok(c!.curve && c!.points.length > 4);
});

test('missing ends and self loops are skipped', () => {
  assert.deepEqual(routeEdges([node('A', 0, 0)], [{ from: 'A', to: 'A' }, { from: 'A', to: 'Z' }]), [null, null]);
});

test('parallel runs of different edges are nudged apart', () => {
  // Two edges whose natural middle runs would share one vertical line.
  const nodes = [node('A', 0, 0), node('B', 0, 200), node('C', 300, 100), node('D', 300, 300)];
  const [r1, r2] = routeEdges(nodes, [{ from: 'A', to: 'D' }, { from: 'B', to: 'C' }], { direction: 'right' });
  const verticals = (r: Route) => r.points.slice(0, -1).flatMap((p, i) => (p.x === r.points[i + 1].x ? [{ x: p.x, lo: Math.min(p.y, r.points[i + 1].y), hi: Math.max(p.y, r.points[i + 1].y) }] : []));
  for (const a of verticals(r1!)) for (const b of verticals(r2!)) {
    assert.ok(Math.abs(a.x - b.x) > 1 || a.hi <= b.lo || b.hi <= a.lo, 'no shared vertical run');
  }
});

test('rounded paths, trimming and simplification', () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  assert.equal(roundedPath(pts, 6), 'M0 0L94 0Q100 0 100 6L100 100');
  assert.equal(roundedPath(pts, 0), 'M0 0L100 0L100 100');
  assert.deepEqual(simplify([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }]), [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  const t = trimRoute({ routing: 'elbow', points: pts }, 0, 10);
  assert.deepEqual(t.points.at(-1), { x: 100, y: 90 });
});

test('labels avoid each other and the shapes', () => {
  const routes: Route[] = [
    { routing: 'elbow', points: [{ x: 0, y: 0 }, { x: 200, y: 0 }] },
    { routing: 'elbow', points: [{ x: 0, y: 4 }, { x: 200, y: 4 }] },
  ];
  const [a, b] = placeLabels(routes, [{ w: 40, h: 16 }, { w: 40, h: 16 }], [{ x: 80, y: 30, w: 40, h: 40 }]);
  assert.ok(a && b);
  assert.ok(a.x >= b.x + b.w || b.x >= a.x + a.w, 'side by side rather than stacked');
  assert.equal(a.y + a.h / 2, 0, 'centred on its line');
});
