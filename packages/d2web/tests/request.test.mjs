import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_BUDGETS, ProtocolError, ROOT_BOARD, normalizeCompileRequest } from '../src/request.ts';

const request = (patch = {}) => ({
  v: 1, type: 'compile', id: 1, revision: 7, files: { 'main.d2': 'a -> b' }, entry: 'main.d2',
  render: { themeId: 0, sketch: false, pad: 0, scale: 1, center: false }, ...patch,
});
const rejects = (patch, pattern) => assert.throws(() => normalizeCompileRequest(request(patch)), error => error instanceof ProtocolError && pattern.test(error.message));

test('defaults: tala, root board only, worker budgets; revision and render untouched', () => {
  const n = normalizeCompileRequest(request());
  assert.equal(n.layout, 'tala');
  assert.deepEqual(n.boards, [ROOT_BOARD]);
  assert.deepEqual(n.budgets, DEFAULT_BUDGETS);
  assert.equal(n.revision, 7);
  assert.deepEqual(n.render, request().render);
});

test('budgets: a request lowers or raises single numbers, the rest keep defaults', () => {
  const n = normalizeCompileRequest(request({ budgets: { maxNodes: 50, sketch: { maxOperations: 9 } } }));
  assert.equal(n.budgets.maxNodes, 50);
  assert.equal(n.budgets.sketch.maxOperations, 9);
  assert.equal(n.budgets.sketch.maxOperationSets, DEFAULT_BUDGETS.sketch.maxOperationSets);
  assert.equal(DEFAULT_BUDGETS.maxNodes, 100_000, 'defaults are not mutated');
});

test('budgets: zero, fractions, unknown keys and wrong types are rejected', () => {
  rejects({ budgets: { maxNodes: 0 } }, /maxNodes/);
  rejects({ budgets: { maxNodes: 1.5 } }, /maxNodes/);
  rejects({ budgets: { sketch: { nope: 1 } } }, /unknown budget budgets\.sketch\.nope/);
  rejects({ budgets: 'big' }, /budgets must be an object/);
});

test('boards: all, explicit list (deduplicated); empty or non-string lists rejected', () => {
  assert.equal(normalizeCompileRequest(request({ boards: 'all' })).boards, 'all');
  assert.deepEqual(normalizeCompileRequest(request({ boards: ['layers.x', 'layers.x', ''] })).boards, ['layers.x', '']);
  rejects({ boards: [] }, /boards/);
  rejects({ boards: [1] }, /boards/);
  rejects({ boards: 'some' }, /boards/);
});

test('envelope: version, type, ids, files and entry', () => {
  rejects({ v: 2 }, /protocol version/);
  rejects({ type: 'cancel' }, /message type/);
  rejects({ id: -1 }, /id/);
  rejects({ revision: 1.2 }, /revision/);
  rejects({ files: { 'main.d2': 3 } }, /files/);
  rejects({ entry: 'other.d2' }, /entry/);
  rejects({ layout: 'dot' }, /layout engine/);
  assert.throws(() => normalizeCompileRequest(null), ProtocolError);
  assert.equal(normalizeCompileRequest(request({ layout: 'elk' })).layout, 'elk');
});

test('render options: required, typed, theme overrides optional', () => {
  rejects({ render: undefined }, /render must be an object/);
  rejects({ render: { ...request().render, sketch: 'yes' } }, /sketch/);
  rejects({ render: { ...request().render, scale: 0 } }, /scale/);
  rejects({ render: { ...request().render, pad: -1 } }, /pad/);
  rejects({ render: { ...request().render, themeOverrides: { b1: 3 } } }, /themeOverrides/);
  const n = normalizeCompileRequest(request({ render: { ...request().render, themeId: 200, themeOverrides: { b1: '#fff' } } }));
  assert.equal(n.render.themeId, 200);
  assert.deepEqual(n.render.themeOverrides, { b1: '#fff' });
});
