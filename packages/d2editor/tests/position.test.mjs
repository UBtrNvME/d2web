import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leaves, place, placeShifting } from '../src/position.ts';

const shape = (id, X, Y, extra = {}) => ({ id, kind: 'shape', nodes: [id], properties: {}, box: { X, Y, Width: 50, Height: 60 }, ...extra });
const fixed = (top, left) => ({ properties: { top: { value: String(top) }, left: { value: String(left) } } });

test('a shape that has top/left moves by the drag distance, rounded', () => {
  const objects = [shape('a', 260, 170, fixed(100, 200))];
  assert.deepEqual(place(objects, 'a', 30.4, -20.6), { top: 79, left: 230 });
});

test("a sibling's top/left gives the container's origin", () => {
  const objects = [shape('c', 0, 200), shape('c.d', 460, 560, { parent: 'c', ...fixed(300, 400) }), shape('c.e', 60, 260, { parent: 'c' })];
  // origin = (460 - 400, 560 - 300) = (60, 260); e lands at its box + distance - origin.
  assert.deepEqual(place(objects, 'c.e', 10, 5), { top: 5, left: 10 });
});

test('top level without fixed shapes: origin (0, 0); never below 0', () => {
  const objects = [shape('a', 120, 40), shape('b', 300, 40)];
  assert.deepEqual(place(objects, 'a', 15, 10), { top: 50, left: 135 });
  assert.deepEqual(place(objects, 'a', -500, -500), { top: 0, left: 0 });
});

test("nested, first fixed shape: the container's corner plus TALA's padding", () => {
  const objects = [shape('c', 0, 186), shape('c.d', 100, 276, { parent: 'c' })];
  assert.deepEqual(place(objects, 'c.d', 20, 0), { top: 30, left: 60 });
});

test('connections, unknown ids and shapes without a box are not placed', () => {
  assert.equal(place([{ id: 'x', kind: 'connection', nodes: [], properties: {} }], 'x', 1, 1), undefined);
  assert.equal(place([shape('a', 0, 0)], 'b', 1, 1), undefined);
  assert.equal(place([{ ...shape('a', 0, 0), box: undefined }], 'a', 1, 1), undefined);
});

test('a drop past the origin sits at 0 and moves the container\'s other pinned shapes by the overshoot (spec 0015)', () => {
  const objects = [shape('a', 100, 50, fixed(50, 100)), shape('b', 300, 50, fixed(50, 300)), shape('c', 500, 50), shape('k', 0, 0), shape('k.d', 200, 200, { parent: 'k', ...fixed(10, 10) })];
  assert.deepEqual(placeShifting(objects, 'a', -130, -20), { top: 30, left: 0, ox: 30, oy: 0, siblings: [{ id: 'b', top: 50, left: 330 }, { id: 'c', top: 50, left: 530 }, { id: 'k', top: 0, left: 30 }] });
  // Nothing overshoots: no shifts, same as place().
  assert.deepEqual(placeShifting(objects, 'a', 10, 10), { top: 60, left: 110, ox: 0, oy: 0, siblings: [] });
});

test('a vertical overshoot shifts siblings down; a child is not a sibling of its container\'s sibling', () => {
  const objects = [shape('a', 100, 50, fixed(50, 100)), shape('b', 100, 200, fixed(200, 100))];
  assert.deepEqual(placeShifting(objects, 'a', 0, -80), { top: 0, left: 100, ox: 0, oy: 30, siblings: [{ id: 'b', top: 230, left: 100 }] });
});

test('nested: the overshoot is against the container\'s origin and only that container\'s shapes shift', () => {
  const objects = [shape('c', 0, 0), shape('c.d', 160, 100, { parent: 'c', ...fixed(40, 60) }), shape('c.e', 300, 140, { parent: 'c' }), shape('x', 600, 0, fixed(5, 5))];
  // origin = (160 - 60, 100 - 40) = (100, 60); e at 300 - 250 = 50 -> left -50.
  assert.deepEqual(placeShifting(objects, 'c.e', -250, 0), { top: 80, left: 0, ox: 50, oy: 0, siblings: [{ id: 'c.d', top: 40, left: 110 }] });
});

test('a drop is a reparent only when it no longer overlaps the container at all; the padding band is inside', () => {
  const box = { X: 100, Y: 100, Width: 50, Height: 40 }, parent = { X: 80, Y: 80, Width: 200, Height: 200 };
  assert.equal(leaves(box, parent, -60, 0), false); // overlapping by 10 px
  assert.equal(leaves(box, parent, -20, 0), false); // inside the padding band, left of the origin
  assert.equal(leaves(box, parent, -70, 0), true);  // right edge exactly at the container's left edge
  assert.equal(leaves(box, parent, 0, 300), true);
});
