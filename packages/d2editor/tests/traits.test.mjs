import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { goEnv, goRun, root } from '../../../tests/examples.mjs';
import { normalizeCompileRequest } from '../../d2web/src/request.ts';
import { container, connectable, movable, hasHandle, press } from '../src/traits.ts';

const output = join(root, 'artifacts/d2editor-traits');
mkdirSync(output, { recursive: true });
const binary = join(output, 'd2web');
goRun('go', ['build', '-buildvcs=false', '-mod=readonly', '-o', binary, './cmd/d2web'], { cwd: join(root, 'packages/d2web-wasm'), env: goEnv });
const cache = new Map();
function compile(source, engine = 'tala') {
  const key = JSON.stringify([source, engine]);
  if (!cache.has(key)) cache.set(key, JSON.parse(goRun(binary, [JSON.stringify(normalizeCompileRequest({
    v: 2, type: 'compile', id: 1, revision: 1, files: { 'main.d2': source }, entry: 'main.d2', layout: engine, seeds: [1], render: { themeId: 0, sketch: false, pad: 0, scale: 1, center: false },
  }))])));
  return cache.get(key);
}
function context(source, engine = 'tala') {
  const result = compile(source, engine);
  assert.equal(result.error, undefined, result.error?.message);
  return { board: result.boards[0].association, engine: result.echo.layout };
}
const object = ctx => ctx.board.objects.find(o => o.id === 'x');
const shapes = ['rectangle', 'square', 'page', 'parallelogram', 'document', 'cylinder', 'queue', 'package', 'step', 'callout', 'stored_data', 'person',
  'diamond', 'oval', 'circle', 'hexagon', 'cloud', 'text', 'code', 'class', 'sql_table', 'image', 'sequence_diagram', 'c4-person', 'hierarchy'];
const cases = [
  ...shapes.map(shape => [shape, `x: { shape: ${shape}${shape === 'image' ? '; icon: https://example.com/icon.svg' : ''} }\n`]),
  ['markdown', 'x: |md\n  # Original\n|\n'], ['code block', 'x: |go\n  original()\n|\n'], ['latex', 'x: |latex\n  x^2\n|\n'],
];

test('container protects D2 images, rows and content while ordinary children stay shapes', () => {
  for (const [name, source] of cases) {
    const ctx = context(source), before = object(ctx), changed = compile(`${source}x: { child }\n`);
    if (name === 'image') {
      assert.match(changed.error.message, /image shapes cannot have children/);
      assert.equal(container.applies(before, ctx), false, name);
      continue;
    }
    assert.equal(changed.error, undefined, changed.error?.message);
    const after = changed.boards[0].association, parent = after.objects.find(o => o.id === 'x');
    const child = after.objects.find(o => o.id === 'x.child');
    if (name === 'class' || name === 'sql_table') {
      assert.equal(child, undefined, `${name} turns its child into a row`);
      assert.equal(parent.content, name);
      const row = name === 'class' ? 'x:class-field:0:name' : 'x:table-row:0:name';
      assert(changed.boards[0].scene.Root.Children.find(n => n.ID === 'x').Children.some(n => n.ID === row), name);
      assert.equal(container.applies(before, ctx), false, name);
      continue;
    }
    if (['text', 'code', 'markdown', 'code block', 'latex'].includes(name)) {
      // The research note overstates content loss: v0.9.0 preserves it; the editor still excludes content elements as drop targets.
      assert(child, `${name} compiles a child shape`);
      assert.equal(parent.content, before.content, `${name} retains its content role`);
      assert.equal(parent.label, before.label, `${name} retains its content`);
      assert.equal(container.applies(before, ctx), false, name);
      continue;
    }
    const preservesContent = parent.content === before.content && parent.properties.shape?.value === before.properties.shape?.value && parent.label === before.label;
    assert.equal(container.applies(before, ctx), Boolean(child) && preservesContent, name);
  }
});

test('connectable agrees with the endpoints D2 compiles, including rich content and images', () => {
  for (const [name, source] of cases) {
    const ctx = context(`${source}y\nx -> y\n`), edge = ctx.board.objects.find(o => o.kind === 'connection');
    assert.equal(edge.src, 'x', name);
    assert.equal(edge.dst, 'y', name);
    assert.equal(connectable.applies(object(ctx), ctx), edge.src === 'x', name);
    assert.equal(connectable.applies(edge, ctx), false, 'connections are not D2 shape endpoints');
  }
});

test('movable agrees with D2 layout: only TALA honours top and left', () => {
  for (const engine of ['tala', 'dagre', 'elk']) {
    const ctx = context('x: {top: 100; left: 200}\ny: {top: 400; left: 500}\nx -> y\n', engine);
    const moved = context('x: {top: 170; left: 290}\ny: {top: 400; left: 500}\nx -> y\n', engine);
    const before = object(ctx), after = object(moved);
    const honoursPosition = after.box.X - before.box.X === 90 && after.box.Y - before.box.Y === 70;
    assert.equal(honoursPosition, engine === 'tala');
    if (engine !== 'tala') assert.deepEqual(after.box, before.box, engine);
    assert.equal(movable.applies(before, ctx), honoursPosition, engine);
    assert.equal(movable.applies(ctx.board.objects.find(o => o.kind === 'connection'), ctx), false);
  }
});

test('has-handle uses D2 shape endpoint boxes, never a connection route box', () => {
  for (const [name, source] of cases) {
    const ctx = context(`${source}y\nx -> y\n`), edge = ctx.board.objects.find(o => o.kind === 'connection');
    assert(object(ctx).box.Width > 0 && object(ctx).box.Height > 0, name);
    assert.equal(hasHandle.applies(object(ctx), ctx), edge.src === 'x' && Boolean(object(ctx).box), name);
    assert.equal(hasHandle.applies(edge, ctx), false, name);
    assert.equal(hasHandle.applies({ ...object(ctx), box: undefined }, ctx), false);
  }
});

test('press arbitrates handles, bodies and empty space; non-TALA bodies still reparent', () => {
  for (const engine of ['tala', 'dagre', 'elk']) {
    const ctx = context('x -> y\n', engine), shape = object(ctx), edge = ctx.board.objects.find(o => o.kind === 'connection');
    assert.equal(press(shape, ctx, 'handle'), 'connect');
    assert.equal(press(shape, ctx, 'body'), engine === 'tala' ? 'move' : 'reparent');
    for (const region of ['handle', 'body']) {
      assert.equal(press(edge, ctx, region), 'pan');
      assert.equal(press(undefined, ctx, region), 'pan');
    }
  }
});
