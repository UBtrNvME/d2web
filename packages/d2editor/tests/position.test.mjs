import assert from 'node:assert/strict';
import { test } from 'node:test';
import { place } from '../src/position.ts';

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
