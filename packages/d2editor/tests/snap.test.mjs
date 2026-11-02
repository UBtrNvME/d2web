import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pairBoxes } from '../src/snap.ts';

const object = (id, x) => ({ id, nodes: [id], box: { X: x, Y: 0, Width: 100, Height: 50 } });
test('boxes follow rename deltas, preserve survivors, fade creations and omit deletions or missing boxes', () => {
  const before = { objects: [object('a', 1), object('a.child', 2), object('(a -> b)[0]', 3), object('b', 4), object('gone', 5)] };
  const after = { objects: [object('c', 10), object('c.child', 20), object('(c -> b)[0]', 30), object('b', 40), object('new', 50), { id: 'no-box' }] };
  const pairs = pairBoxes(before, after, { a: 'c', 'a.child': 'c.child', '(a -> b)[0]': '(c -> b)[0]' });
  assert.deepEqual(pairs.map(p => [p.object.id, p.before?.X]), [['c', 1], ['c.child', 2], ['(c -> b)[0]', 3], ['b', 4], ['new', undefined]]);
  assert.deepEqual(pairBoxes({ objects: [] }, after).map(p => p.before), Array(5).fill(undefined));
});
