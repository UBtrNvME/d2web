import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseGeometryScene } from '../research/geometry/geometry-scene.ts';

const fixture = JSON.parse(readFileSync(new URL('../artifacts/scene-probe/geometry.json', import.meta.url), 'utf8'));
test('tagged native geometry is accepted without converting D2 values', () => {
  assert.equal(parseGeometryScene(fixture), fixture);
  const emptyLists = structuredClone(fixture);
  emptyLists.Links = []; emptyLists.Root.Filters = []; emptyLists.Root.Animations = [];
  assert.equal(parseGeometryScene(emptyLists), emptyLists);
});
test('malformed and unsupported wire data fail instead of becoming a partial diagram', () => {
  const edits = [
    scene => { scene.Root.Kind = 'text'; },
    scene => { scene.Root.Children[1].Children[0].Primitive.Box.Width = -1; },
    scene => { scene.Root.Children[1].Children[0].Primitive.Fill.Color.R = 256; },
    scene => { scene.Root.Transform.A = Infinity; },
    scene => { scene.ViewBox.Width = 0; },
    scene => { scene.Root.Mask = {}; },
    scene => { scene.Root.Children[3].Children[0].Primitive.Commands[0].Kind = 3; },
    scene => { scene.Root.Children[3].Children[0].Primitive.Commands[0].Kind = 1; },
    scene => { scene.Root.Children[1].Children[0].Primitive.Fill = { Stops: [] }; },
  ];
  for (const edit of edits) {
    const scene = structuredClone(fixture);
    edit(scene);
    assert.throws(() => parseGeometryScene(scene), /Invalid geometry scene/);
  }
});
