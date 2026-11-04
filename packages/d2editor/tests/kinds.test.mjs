import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { goEnv, goRun, root } from '../../../tests/examples.mjs';
import { normalizeCompileRequest } from '../../d2web/src/request.ts';
import { convert, describe, kindOf, kinds, sectionsOf } from '../src/kinds/index.ts';

const output = join(root, 'artifacts/d2editor-kinds');
mkdirSync(output, { recursive: true });
const binary = join(output, 'd2web');
goRun('go', ['build', '-buildvcs=false', '-mod=readonly', '-o', binary, './cmd/d2web'], { cwd: join(root, 'packages/d2web-wasm'), env: goEnv });
const files = source => ({ 'main.d2': source });
function compile(source) {
  const result = JSON.parse(goRun(binary, [JSON.stringify(normalizeCompileRequest({
    v: 2, type: 'compile', id: 1, revision: 1, files: files(source), entry: 'main.d2', layout: 'dagre', seeds: [1], render: { themeId: 0, sketch: false, pad: 0, scale: 1, center: false },
  }))]));
  assert.equal(result.error, undefined, result.error?.message);
  return result.boards[0].association;
}
function edit(source, ops) {
  const result = JSON.parse(goRun(binary, [JSON.stringify({ v: 2, type: 'edit', id: 1, revision: 1, files: files(source), entry: 'main.d2', ops })]));
  assert.equal(result.error, undefined, result.error?.message);
  return result.patch.text;
}
const find = (association, id) => association.objects.find(o => o.id === id);
const object = (source, id = 'x') => find(compile(source), id);

const nodes = {
  shape: ['x: Hi\n', 'x: Hi { style.fill: red }\n', 'x: { shape: cylinder }\n', 'x: Hi { y }\n'],
  image: ['x: { shape: image\n  icon: https://example.com/i.svg\n}\n'],
  text: ['x: |md\n  # Title\n\n  body\n|\n', 'x: |python\n  print(1)\n  print(2)\n|\n', 'x: |latex\n  x^2\n|\n', 'x: |md\n  hi\n| { style.fill: red }\n'],
};
const others = ['x: { shape: sql_table\n  id: int\n}\n', 'x: { shape: class\n  name: string\n}\n', 'x: { shape: sequence_diagram\n  a -> b\n}\n', 'x: { shape: hierarchy }\n'];

test('every selection resolves to a path from Element: node kinds, the fallback and edges', () => {
  for (const [id, sources] of Object.entries(nodes)) for (const source of sources) {
    assert.equal(kindOf(object(source))?.id, id, source);
    assert.deepEqual(describe(object(source)), { family: 'node', kind: id, path: ['element', 'node', id] }, source);
  }
  for (const source of others) {
    assert.equal(kindOf(object(source)), undefined, source);
    assert.deepEqual(describe(object(source)), { family: 'node', kind: undefined, path: ['element', 'node'] }, source);
  }
  const edge = find(compile('x -> y: go\n'), '(x -> y)[0]');
  assert.deepEqual(describe(edge), { family: 'edge', kind: undefined, path: ['element', 'edge'] });
});

test('read then write of the same kind leaves the object as it was', () => {
  for (const [id, sources] of Object.entries(nodes)) for (const source of sources) {
    const kind = kinds.find(k => k.id === id), before = object(source);
    const after = find(compile(edit(source, kind.write(kind.read(before), before))), 'x');
    for (const key of ['label', 'content', 'language', 'kind']) assert.equal(after[key], before[key], `${source} ${key}`);
    const values = o => Object.fromEntries(Object.entries(o.properties).map(([k, v]) => [k, v.value]));
    assert.deepEqual(values(after), values(before), source);
  }
});

test('every ordered pair of node kinds converts: D2 accepts it, name and style survive, children survive unless the target is an image, the kind changes', () => {
  for (const from of kinds) for (const to of kinds) for (const source of nodes[from.id]) {
    // An image cannot have children, so a source that is one is converted bare.
    const text = from.id === 'image' ? source : `${source}x.child\n`, association0 = compile(text), before = find(association0, 'x');
    const { ops, loss } = convert(before, to, association0);
    const association = compile(edit(text, ops)), after = find(association, 'x');
    assert.equal(kindOf(after)?.id, to.id, `${from.id} to ${to.id}: ${source}`);
    if (to.id === 'image') {
      const n = association0.objects.filter(o => o.parent === 'x').length;
      assert.deepEqual(loss, from.id === 'image' ? [] : [`${n} child ${n === 1 ? 'shape' : 'shapes'}`], `${from.id} to image names what it removes`);
      assert.equal(association.objects.filter(o => o.parent === 'x').length, 0, `${from.id} to image removes every child`);
    } else {
      assert.deepEqual(loss, [], `${from.id} to ${to.id} loses nothing`);
      if (from.id !== 'image') assert.ok(find(association, 'x.child'), `${from.id} to ${to.id} keeps its child`);
    }
    assert.equal(after.properties.fill?.value, before.properties.fill?.value, `${from.id} to ${to.id} keeps fill`);
  }
});

test('a text node keeps its words as the label and a label becomes markdown', () => {
  const toText = convert(object('x: Hello\n'), kinds.find(k => k.id === 'text'));
  assert.deepEqual(toText.ops, [{ op: 'set', key: 'x', value: 'Hello', tag: 'md' }]);
  const toShape = convert(object('x: |go\n  run()\n|\n'), kinds.find(k => k.id === 'shape'));
  assert.deepEqual(toShape.ops, [{ op: 'set', key: 'x', value: 'run()' }]);
});

test('sections follow the inheritance chain and list only curated keywords', () => {
  const ids = o => sectionsOf(o).map(s => s.id);
  assert.deepEqual(ids(object('x: Hi\n')), ['element', 'node', 'shape']);
  assert.deepEqual(ids(object(nodes.image[0])), ['element', 'node', 'image']);
  assert.deepEqual(ids(object('x: |md\n  hi\n|\n')), ['element', 'node', 'text']);
  assert.deepEqual(ids(object(others[0])), ['element', 'node']);
  assert.deepEqual(ids(find(compile('x -> y\n'), '(x -> y)[0]')), ['element', 'edge']);
  // Position, size, near, grid, fonts and link stay in the source pane (spec 0018 §3.6).
  const listed = new Set(['x: Hi\n', 'x: |md\n  hi\n|\n', 'x -> y\n'].flatMap(s => sectionsOf(s.includes('->') ? find(compile(s), '(x -> y)[0]') : object(s)).flatMap(sec => sec.controls.map(c => c.keyword))));
  for (const gone of ['top', 'left', 'width', 'height', 'near', 'direction', 'link', 'tooltip', 'font', 'vars', 'grid-rows']) assert.ok(!listed.has(gone), gone);
});
