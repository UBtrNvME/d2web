import assert from 'node:assert/strict';
import { test } from 'node:test';
import { place, step, attempt } from '../src/position.ts';

const shape = (id, X, Y, extra = {}) => ({ id, kind: 'shape', nodes: [id], properties: {}, box: { X, Y, Width: 50, Height: 60 }, ...extra });
const fixed = (top, left) => ({ properties: { top: { value: String(top) }, left: { value: String(left) } } });

test('a shape that has top/left moves by the drag distance, rounded', () => {
  const objects = [shape('a', 260, 170, fixed(100, 200))];
  assert.deepEqual(place(objects, 'a', 30.4, -20.6), { top: 79, left: 230, exact: true });
});

test("a sibling's top/left gives the container's origin", () => {
  const objects = [shape('c', 0, 200), shape('c.d', 460, 560, { parent: 'c', ...fixed(300, 400) }), shape('c.e', 60, 260, { parent: 'c' })];
  // origin = (460 - 400, 560 - 300) = (60, 260); e lands at its box + distance - origin.
  assert.deepEqual(place(objects, 'c.e', 10, 5), { top: 5, left: 10, exact: false });
});

test('top level without fixed shapes: origin (0, 0); never below 0', () => {
  const objects = [shape('a', 120, 40), shape('b', 300, 40)];
  assert.deepEqual(place(objects, 'a', 15, 10), { top: 50, left: 135, exact: true });
  assert.deepEqual(place(objects, 'a', -500, -500), { top: 0, left: 0, exact: true });
});

test("nested, first fixed shape: an estimate from the container's corner plus TALA's rectangle padding", () => {
  const objects = [shape('c', 0, 186), shape('c.d', 100, 276, { parent: 'c' })];
  assert.deepEqual(place(objects, 'c.d', 20, 0), { top: 30, left: 60, exact: false });
});

test('connections, unknown ids and shapes without a box are not placed', () => {
  assert.equal(place([{ id: 'x', kind: 'connection', nodes: [], properties: {} }], 'x', 1, 1), undefined);
  assert.equal(place([shape('a', 0, 0)], 'b', 1, 1), undefined);
  assert.equal(place([{ ...shape('a', 0, 0), box: undefined }], 'a', 1, 1), undefined);
});

test('a correction step uses the slope measured from the previous attempt, else moves by the miss', () => {
  // First attempt: no history, so move by the miss.
  assert.equal(step(100, 90, 120), 130);
  // painted = 2 x written: from (100 -> 90) and (130 -> 150), the secant lands the target exactly.
  assert.equal(step(130, 150, 120, { written: 100, painted: 90 }), 115);
  // A slope outside 0.2..5 (a layout jump) falls back to the miss; never below 0.
  assert.equal(step(10, 500, 20, { written: 9, painted: 0 }), 0);
  assert.equal(step(10, 20, 30, { written: 9, painted: 20 }), 20);
});

// A simulated container whose origin moves with both values (as a circle grows around a pinned child): painted = written * 1.2 + other * 0.3.
const circle = ({ top, left }) => ({ X: left * 1.2 + top * 0.3, Y: top * 1.2 + left * 0.3 });
test('correction attempts converge on a coupled container and never end worse than the best attempt', () => {
  let at = { top: 50, left: 50 }, aim = { X: 130, Y: 90, tries: 8 };
  for (let next; (next = attempt(at, circle(at), aim)); ) ({ at, aim } = { at: next, aim: next.aim });
  const p = circle(at);
  assert.ok(Math.max(Math.abs(p.X - 130), Math.abs(p.Y - 90)) <= 1, `landed at ${JSON.stringify(p)}`);
  // Out of tries: go back to the best attempt seen rather than stop on a worse one.
  const best = { top: 40, left: 90, miss: 3 };
  assert.deepEqual(attempt({ top: 70, left: 60 }, { X: 200, Y: 200 }, { X: 130, Y: 90, tries: 1, best }), { top: 40, left: 90, aim: { X: 130, Y: 90, tries: 0, best } });
  assert.equal(attempt({ top: 40, left: 90 }, { X: 131, Y: 90 }, { X: 130, Y: 90, tries: 3 }), undefined, 'within 1 px: done');
});
