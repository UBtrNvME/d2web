import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOutline } from '../src/outline.ts';

const shape = (id, parent, label = id) => ({ id, parent, label, kind: 'shape', references: [{ start: { offset: 12 } }], properties: {} });
const edge = { ...shape('(a -> b)[0]'), kind: 'connection', src: 'a', dst: 'b', label: 'requests' };
const build = objects => buildOutline({ objects, classes: [] });

test('outline nests shapes by parent and puts connections last at the root', () => {
  const rows = build([edge, shape('a'), shape('a.b', 'a'), shape('a.b.c', 'a.b'), shape('z')]);
  assert.deepEqual(rows.map(r => r.id), ['a', 'z', edge.id]);
  assert.equal(rows[0].children[0].children[0].id, 'a.b.c');
  assert.equal(rows[2].label, 'a -> b');
  assert.equal(rows[2].kind, 'connection');
  assert.equal(rows[0].offset, 12);
});

test('empty labels fall back to ids and absent references have no jump offset', () => {
  const rows = build([{ ...shape('a', undefined, ''), references: [] }]);
  assert.equal(rows[0].label, 'a');
  assert.equal(rows[0].offset, undefined);
  assert.deepEqual(build([]), []);
});

test('parent resolution is independent of input order while siblings keep association order', () => {
  const a = shape('a'), b = shape('a.b', 'a'), c = shape('a.c', 'a');
  assert.deepEqual(build([b, edge, c, a]), build([a, b, c, edge]));
  assert.deepEqual(build([c, b, a])[0].children.map(r => r.id), ['a.c', 'a.b']);
});
