import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zoomAt, fit, MIN, MAX } from '../src/canvas.ts';

test('zoom keeps the pointer fixed and clamps the scale', () => {
  const v = zoomAt({ x: 10, y: 20, k: 1 }, 2, 110, 70);
  // The diagram point under the pointer, (100, 50), is still under it.
  assert.deepEqual([(110 - v.x) / v.k, (70 - v.y) / v.k], [100, 50]);
  assert.equal(zoomAt(v, 100, 0, 0).k, MAX);
  assert.equal(zoomAt(v, 0, 0, 0).k, MIN);
});

test('fit centres the diagram and enlarges a small one at most twice', () => {
  assert.deepEqual(fit(100, 50, 400, 300), { x: 100, y: 100, k: 2 });
  const big = fit(1000, 200, 564, 400);
  assert.equal(big.k, 0.5);
  assert.deepEqual([big.x, big.y], [32, 150]);
  assert.equal(fit(0, 0, 400, 300).k, 1);
});
