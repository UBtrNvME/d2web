import assert from 'node:assert/strict';
import { test } from 'node:test';
import { patches } from './upstream-patches.mjs';

test('every upstream patch applies to, or is already applied on, the pinned D2 checkout', () => {
  const list = patches();
  assert.ok(list.length > 0);
  for (const p of list) assert.notEqual(p.state, 'conflict', `${p.file} no longer matches imports/d2`);
});
