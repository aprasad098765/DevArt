import test from 'node:test';
import assert from 'node:assert/strict';
import { alignDeltas, distributeDeltas, guidesFor, snapToGuides, unionBox, type Box } from '../shared/align.ts';

const boxes = () => new Map<string, Box>([
  ['a', { x: 0, y: 0, w: 10, h: 10 }],
  ['b', { x: 50, y: 20, w: 20, h: 30 }],
  ['c', { x: 100, y: 5, w: 40, h: 10 }],
]);

test('unionBox covers every box', () => {
  assert.deepEqual(unionBox(boxes().values()), { x: 0, y: 0, w: 140, h: 50 });
  assert.equal(unionBox([]), null);
});

test('alignDeltas lines boxes up on each edge and centre', () => {
  const left = alignDeltas(boxes(), 'left');
  assert.deepEqual(left.get('b'), { x: -50, y: 0 });
  assert.deepEqual(left.get('a'), { x: 0, y: 0 });
  assert.deepEqual(alignDeltas(boxes(), 'right').get('a'), { x: 130, y: 0 });
  assert.deepEqual(alignDeltas(boxes(), 'center').get('c'), { x: -50, y: 0 });
  assert.deepEqual(alignDeltas(boxes(), 'bottom').get('c'), { x: 0, y: 35 });
  assert.deepEqual(alignDeltas(boxes(), 'middle').get('a'), { x: 0, y: 20 });
  assert.deepEqual(alignDeltas(boxes(), 'top').get('b'), { x: 0, y: -20 });
});

test('distributeDeltas evens the gaps and keeps the ends', () => {
  const d = distributeDeltas(boxes(), 'x');
  // Span 140, sizes 70, so each of the two gaps is 35: b starts at 10 + 35.
  assert.deepEqual(d.get('a'), { x: 0, y: 0 });
  assert.deepEqual(d.get('c'), { x: 0, y: 0 });
  assert.deepEqual(d.get('b'), { x: -5, y: 0 });
  assert.deepEqual(distributeDeltas(new Map([...boxes()].slice(0, 2)), 'y').get('b'), { x: 0, y: 0 });
});

test('snapToGuides finds the nearest edge or centre within the threshold', () => {
  const others = [{ x: 100, y: 100, w: 50, h: 50 }];
  assert.deepEqual(snapToGuides({ x: 103, y: 300, w: 30, h: 20 }, others, 6), { dx: -3, dy: undefined });
  // Centre 125 to centre 125 beats a farther edge.
  assert.deepEqual(snapToGuides({ x: 114, y: 148, w: 20, h: 20 }, others, 6).dx, 1);
  assert.deepEqual(snapToGuides({ x: 400, y: 400, w: 20, h: 20 }, others, 6), { dx: undefined, dy: undefined });
});

test('guidesFor reports aligned edges spanning both boxes', () => {
  const g = guidesFor({ x: 100, y: 300, w: 20, h: 20 }, [{ x: 100, y: 100, w: 50, h: 50 }]);
  assert.deepEqual(g, [{ axis: 'x', at: 100, from: 100, to: 320 }]);
});
