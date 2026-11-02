import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareBoard } from '../src/render.ts';

const matrix = { A: 1, B: 0, C: 0, D: 1, E: 0, F: 0 };
const node = (ID, Primitive = null, Children = []) => ({ ID, Primitive, Children, Transform: matrix, Opacity: 1 });
const shape = node('a', null, [node('a:outline', { $: 'Rect', Box: { X: 5, Y: 3, Width: 100, Height: 40 } })]);
shape.Transform = { ...matrix, E: 10, F: 20 };
const result = {
  revision: 7, fonts: { 'font:test': 'Zm9udA==' },
  boards: [{ path: '/layers/one', scene: { Root: node('root', null, [shape]), ViewBox: { X: 0, Y: 0, Width: 200, Height: 100 }, LogicalWidth: 200, LogicalHeight: 100, Links: [{ Box: { X: 15, Y: 23, Width: 100, Height: 40 }, URL: 'https://example.test' }] },
    association: { objects: [{ id: 'a', kind: 'shape', label: 'Alpha', nodes: ['a', 'a:outline'], references: [], properties: {} }] } }],
};

test('prepareBoard is DOM-free and preserves the complete scene, source association and revision', () => {
  const input = structuredClone(result);
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } };
  freeze(input);
  const board = prepareBoard(input, '/layers/one');
  assert.equal(board.revision, 7);
  assert.equal(board.path, '/layers/one');
  assert.equal(board.scene, input.boards[0].scene);
  assert.equal(board.association, input.boards[0].association);
  assert.equal(board.fonts, input.fonts);
  assert.deepEqual(board.objects.map(o => [o.id, o.bounds]), [['a', { X: 15, Y: 23, Width: 100, Height: 40 }]]);
  assert.equal(board.links[0].objectId, 'a');
  assert.equal(board.links[0].region, input.boards[0].scene.Links[0]);
  assert.deepEqual(input, result);
});

test('prepareBoard rejects errored/missing boards and leaves the result untouched', () => {
  assert.throws(() => prepareBoard({ ...result, error: { message: 'syntax' } }), /syntax/);
  assert.throws(() => prepareBoard(result, '/missing'), /no board/);
  const invalid = { ...result, boards: [{ ...result.boards[0], scene: { Root: null } }] };
  assert.throws(() => prepareBoard(invalid, '/layers/one'), /Root and ViewBox/);
});
