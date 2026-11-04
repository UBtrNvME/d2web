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
  sequence: ['x: { shape: sequence_diagram\n  a -> b\n}\n'],
  grid: ['x: {\n  grid-columns: 2\n  a\n  b\n}\n'],
  table: ['x: {\n  shape: sql_table\n  id: int {constraint: primary_key}\n  name: varchar\n}\n'],
  class: ['x: {\n  shape: class\n  +name: string\n  "+run(x int)": bool\n}\n'],
  text: ['x: |md\n  # Title\n\n  body\n|\n', 'x: |python\n  print(1)\n  print(2)\n|\n', 'x: |latex\n  x^2\n|\n', 'x: |md\n  hi\n| { style.fill: red }\n'],
};
const others = ['x: { shape: hierarchy }\n'];

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
    assert.deepEqual(after.rows, before.rows, `${source} rows`);
    const values = o => Object.fromEntries(Object.entries(o.properties).map(([k, v]) => [k, v.value]));
    assert.deepEqual(values(after), values(before), source);
  }
});

test('every ordered pair of node kinds converts: D2 accepts it, name and style survive, the kind changes, and the loss names what disappeared', () => {
  const noChildren = id => ['image', 'table', 'class'].includes(id), plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  for (const from of kinds) for (const to of kinds) for (const source of nodes[from.id]) {
    // Images, tables and classes cannot have children, so a source of those kinds is converted bare.
    const text = noChildren(from.id) ? source : `${source}x.child\n`, association0 = compile(text), before = find(association0, 'x');
    const { ops, loss } = convert(before, to, association0);
    const association = compile(edit(text, ops)), after = find(association, 'x');
    assert.equal(kindOf(after)?.id, to.id, `${from.id} to ${to.id}: ${source}`);
    const children = association0.objects.filter(o => o.parent === 'x').length, rows = before.rows ?? [];
    const expected = [
      ...(!to.rows && rows.length ? [`${rows.length} ${from.id === 'class' ? 'members' : 'columns'}`] : []),
      ...(noChildren(to.id) && children ? [plural(children, 'child shape', 'child shapes')] : []),
      ...(['table', 'class'].includes(to.id) && before.label.includes('\n') ? ['the text after its first line'] : []),
      ...(to.id === 'class' && rows.some(r => r.constraint?.length) ? ["the columns' constraints"] : []),
    ];
    assert.deepEqual(loss, expected, `${from.id} to ${to.id} names what it removes`);
    if (noChildren(to.id)) assert.equal(association.objects.filter(o => o.parent === 'x').length, 0, `${from.id} to ${to.id} leaves no child shapes`);
    else if (children) assert.ok(find(association, 'x.child'), `${from.id} to ${to.id} keeps its child`);
    if (to.rows && from.rows) assert.deepEqual((after.rows ?? []).map(r => [r.name, r.type]), rows.map(r => [r.name, r.type]), `${from.id} to ${to.id} keeps the rows`);
    if (!to.rows) assert.equal(after.rows, undefined, `${from.id} to ${to.id} leaves no rows behind`);
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
  assert.deepEqual(ids(object(nodes.grid[0])), ['element', 'node', 'grid']);
  assert.deepEqual(ids(object(nodes.table[0])), ['element', 'node', 'table']);
  assert.deepEqual(ids(object(nodes.class[0])), ['element', 'node', 'class']);
  assert.deepEqual(ids(object('x: |md\n  hi\n|\n')), ['element', 'node', 'text']);
  assert.deepEqual(ids(object(others[0])), ['element', 'node']);
  assert.deepEqual(ids(find(compile('x -> y\n'), '(x -> y)[0]')), ['element', 'edge']);
  // Position, size, near, grid, fonts and link stay in the source pane (spec 0018 §3.6).
  const listed = new Set(['x: Hi\n', 'x: |md\n  hi\n|\n', 'x -> y\n'].flatMap(s => sectionsOf(s.includes('->') ? find(compile(s), '(x -> y)[0]') : object(s)).flatMap(sec => sec.controls.map(c => c.keyword))));
  for (const gone of ['top', 'left', 'width', 'height', 'near', 'direction', 'link', 'tooltip', 'font', 'vars', 'grid-rows']) assert.ok(!listed.has(gone), gone);
});
