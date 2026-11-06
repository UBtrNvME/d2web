import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectTarget, dropTarget, freeKey } from '../src/targets.ts';

const shape = (id, X, Y, W, H, extra = {}) => ({ id, kind: 'shape', parent: id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : undefined, nodes: [id], properties: {}, box: { X, Y, Width: W, Height: H }, ...extra });
const context = (objects, classes = []) => ({ board: { objects, classes }, engine: 'tala' });

test('freeKey takes D2’s next free name under the parent, ignoring case', () => {
  const objects = [shape('note', 0, 0, 1, 1), shape('Note 2', 0, 0, 1, 1), shape('vpc', 0, 0, 1, 1), shape('vpc.zone', 0, 0, 1, 1)];
  assert.equal(freeKey(objects, '', 'note'), 'note 3');
  assert.equal(freeKey(objects, '', 'zone'), 'zone');
  assert.equal(freeKey(objects, 'vpc', 'zone'), 'vpc.zone 2');
  // `vpc.shape` would set vpc's shape: a keyword never names a shape.
  assert.equal(freeKey(objects, 'vpc', 'shape'), 'vpc.shape 2');
  assert.equal(freeKey(objects, '', 'Icon'), 'Icon 2');
});

test('dropTarget: deepest Container holding shapes, or a zone, under the point; never the dragged shape or its descendants', () => {
  const objects = [
    shape('vpc', 0, 0, 400, 400), shape('vpc.subnet', 50, 50, 200, 200), shape('vpc.subnet.a', 60, 60, 50, 50),
    shape('vpc.note', 300, 300, 80, 80, { content: 'markdown' }), shape('zone', 500, 0, 100, 100, { classes: ['zone'] }),
  ];
  // A leaf rectangle is not a target; its parent is.
  assert.equal(dropTarget(context(objects), 100, 100), 'vpc.subnet');
  assert.equal(dropTarget(context(objects), 100, 100, 'vpc.subnet.a'), 'vpc.subnet');
  assert.equal(dropTarget(context(objects), 100, 100, 'vpc.subnet'), 'vpc');
  // A markdown block is not a target; its parent is.
  assert.equal(dropTarget(context(objects), 320, 320), 'vpc');
  assert.equal(dropTarget(context(objects), 700, 700), '');
  // An empty zone receives.
  assert.equal(dropTarget(context(objects), 550, 50), 'zone');
});

test('connectTarget: the shape under the point, else the nearest within the slop', () => {
  const objects = [shape('vpc', 0, 0, 400, 400), shape('vpc.a', 60, 60, 50, 50), shape('b', 500, 0, 50, 50)];
  assert.equal(connectTarget(context(objects), 70, 70, 12), 'vpc.a');
  // Inside a zone's empty area there is no target: the release creates a shape there instead.
  assert.equal(connectTarget(context(objects), 200, 200, 12), '');
  assert.equal(connectTarget(context(objects), 490, 10, 12), 'b');
  assert.equal(connectTarget(context(objects), 470, 10, 12), '');
});
