import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countObjects, getObject, objectsAt } from '../src/association.ts';

const src = (path, l1, c1, l2, c2) => ({ path, start: { line: l1, column: c1, offset: 0 }, end: { line: l2, column: c2, offset: 0 } });
const object = (id, references, properties = {}) => ({ id, kind: 'shape', label: id, nodes: [id], references, properties });
// main.d2:  line 0 `a: { b }`  line 1 `c -> a.b`  line 2 `*: { style.fill: red }` ; shared.d2 line 0 `a`
const association = { objects: [
  object('a', [src('main.d2', 0, 0, 0, 1), src('main.d2', 1, 5, 1, 6)]),
  object('a.b', [src('main.d2', 0, 5, 0, 6), src('main.d2', 1, 5, 1, 8)], { fill: { value: 'red', source: src('main.d2', 2, 4, 2, 19) } }),
  object('c', [src('main.d2', 1, 0, 1, 1)], { label: { value: 'c', source: null } }),
  object('s', [src('shared.d2', 0, 0, 0, 1)]),
] };

test('getObject finds by id', () => {
  assert.equal(getObject(association, 'a.b').id, 'a.b');
  assert.equal(getObject(association, 'nope'), undefined);
});

test('objectsAt: containing objects, smallest range first, ends included', () => {
  assert.deepEqual(objectsAt(association, { path: 'main.d2', line: 1, column: 6 }).map(o => o.id), ['a', 'a.b'], '`a` ends at 6 and `a.b` spans 5-8; the smaller range is first');
  assert.deepEqual(objectsAt(association, { path: 'main.d2', line: 0, column: 5 }).map(o => o.id), ['a.b']);
  assert.deepEqual(objectsAt(association, { path: 'main.d2', line: 0, column: 1 }).map(o => o.id), ['a'], 'a cursor at the end of a range counts');
});

test('objectsAt: property declarations count, other files and empty places do not', () => {
  assert.deepEqual(objectsAt(association, { path: 'main.d2', line: 2, column: 10 }).map(o => o.id), ['a.b'], 'the fill declaration (a glob or class in real use) owns the position');
  assert.deepEqual(objectsAt(association, { path: 'shared.d2', line: 0, column: 0 }).map(o => o.id), ['s']);
  assert.deepEqual(objectsAt(association, { path: 'main.d2', line: 5, column: 0 }), []);
  assert.deepEqual(objectsAt(association, { path: 'other.d2', line: 0, column: 0 }), []);
});

test('countObjects separates shapes from connections', () => {
  const association = { objects: [object('a', []), object('b', []), { ...object('(a -> b)[0]', []), kind: 'connection' }] };
  assert.deepEqual(countObjects(association), { shapes: 2, connections: 1 });
});
