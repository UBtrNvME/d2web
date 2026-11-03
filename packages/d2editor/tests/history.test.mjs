import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHistory } from '../src/history.ts';

test('undo and redo restore exact texts; a new text clears redo; reset forgets', () => {
  const h = createHistory('a');
  h.push('a'); // unchanged text is not a step
  h.push('b'); h.push('c');
  assert.equal(h.undo(), 'b'); assert.equal(h.undo(), 'a'); assert.equal(h.undo(), undefined);
  assert.equal(h.redo(), 'b'); assert.equal(h.current, 'b');
  h.push('d');
  assert.equal(h.redo(), undefined, 'a new text clears redo');
  assert.equal(h.undo(), 'b');
  h.reset('x');
  assert.equal(h.undo(), undefined); assert.equal(h.current, 'x');
  const small = createHistory('0', 2);
  for (const t of ['1', '2', '3']) small.push(t);
  assert.equal(small.undo(), '2'); assert.equal(small.undo(), '1'); assert.equal(small.undo(), undefined, 'oldest steps beyond the limit are dropped');
});
