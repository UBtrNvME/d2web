import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { goEnv, goRun, root } from '../../../tests/examples.mjs';
import { normalizeCompileRequest } from '../../d2web/src/request.ts';
import { capabilities, setOps } from '../src/capabilities.ts';

const table = JSON.parse(readFileSync(join(root, 'packages/d2editor/src/keywords.json'), 'utf8'));
const output = join(root, 'artifacts/d2editor-capabilities');
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
const icon = shape => (shape === 'image' ? '\nicon: https://example.com/i.svg' : '');
function context(source, engine = 'tala') {
  const result = compile(source, engine);
  assert.equal(result.error, undefined, result.error?.message);
  return { board: result.boards[0].association, engine: result.echo.layout };
}
const sample = ({ domain }) => ({ number: String(domain.min ?? 1), boolean: 'true', color: 'red', text: 'sample', enum: domain.values?.[1] })[domain.kind];
const property = name => name.replace(/-(\w)/g, (_, c) => c.toUpperCase());

test('every advertised style field changes a real compile; every unavailable one is refused with a reason', () => {
  for (const shape of table.shapes) {
    const base = `x: { shape: ${shape}${icon(shape)} }\n`, ctx = context(base);
    const fields = capabilities(ctx.board.objects.find(o => o.id === 'x'), ctx).fields.filter(f => f.path.includes('.style.'));
    assert.ok(fields.length > 10, `${shape}: ${fields.length} style fields`);
    for (const field of fields) {
      const result = compile(`x: { shape: ${shape}${icon(shape)}\n${field.path.replace(/^x\./, '')}: ${sample(field)} }\n`);
      if (field.available) {
        assert.equal(result.error, undefined, `${shape} ${field.path}: ${result.error?.message}`);
        const o = result.boards[0].association.objects.find(o => o.id === 'x');
        assert.ok(o.properties[property(field.keyword)], `${shape} ${field.path} left no property`);
      } else {
        assert.ok(result.error, `${shape} ${field.path} is marked unavailable but D2 accepts it`);
        assert.ok(field.reason, `${shape} ${field.path} has no reason`);
      }
    }
  }
});

test('a declared value shows its value and its source; an undeclared one shows neither', () => {
  const ctx = context('x: { style.opacity: 0.5 }\n');
  const fields = capabilities(ctx.board.objects.find(o => o.id === 'x'), ctx).fields;
  const opacity = fields.find(f => f.keyword === 'opacity'), width = fields.find(f => f.keyword === 'stroke-width');
  assert.equal(opacity.value, '0.5');
  assert.equal(opacity.source.start.line, 0);
  assert.equal(width.value, undefined);
  assert.equal(width.path, 'x.style.stroke-width');
  assert.deepEqual(width.domain, { kind: 'number', min: 0, max: 15 });
});

test('connections and shapes get different style fields; label and shape are fields too', () => {
  const ctx = context('a -> b\n');
  const connection = ctx.board.objects.find(o => o.kind === 'connection');
  const names = o => capabilities(o, ctx).fields.map(f => f.keyword);
  assert.ok(names(connection).includes('animated'));
  assert.ok(!names(connection).includes('shadow'));
  const a = ctx.board.objects.find(o => o.id === 'a');
  assert.ok(names(a).includes('shadow') && names(a).includes('shape') && names(a).includes('label'));
  assert.ok(!names(a).includes('filled'));
});

test('actions: add-child follows the container trait and says why not', () => {
  for (const [source, available] of [['x\n', true], ['x: { shape: image\nicon: https://example.com/i.svg }\n', false], ['x: { shape: sql_table }\n', false]]) {
    const ctx = context(source), actions = capabilities(ctx.board.objects.find(o => o.id === 'x'), ctx).actions;
    for (const id of ['rename', 'delete']) assert.equal(actions.find(a => a.id === id).available, true);
    const child = actions.find(a => a.id === 'add-child');
    assert.equal(child.available, available, source);
    assert.equal(Boolean(child.reason), !available);
  }
});

test('every advertised connection field changes a real compile', () => {
  const ctx = context('a -> b\n'), connection = ctx.board.objects.find(o => o.kind === 'connection');
  for (const field of capabilities(connection, ctx).fields.filter(f => f.path.includes('.style.') && !f.keyword.includes('arrowhead'))) {
    assert.ok(field.available, field.path);
    const result = compile(`a -> b\n${field.path}: ${sample(field)}\n`);
    assert.equal(result.error, undefined, `${field.path}: ${result.error?.message}`);
    assert.ok(result.boards[0].association.objects.find(o => o.kind === 'connection').properties[property(field.keyword)], `${field.path} left no property`);
  }
});

const layoutSample = f => (f.keyword === 'link' ? 'https://example.com' : { number: String(Math.max(f.domain.min ?? 1, 1)), boolean: 'true', color: 'red', text: 'sample', enum: f.domain.values?.[0] }[f.domain.kind]);
const layout = (source, id = 'x', engine = 'tala') => {
  const ctx = context(source, engine);
  return capabilities(ctx.board.objects.find(o => o.id === id), ctx).fields.filter(f => !f.path.includes('.style.') && !['label', 'shape'].includes(f.keyword));
};

test('the worker reports layout keywords with their sources', () => {
  const ctx = context('x: { top: 10\nleft: 20\nwidth: 100\ndirection: right\ngrid-rows: 2\ntooltip: hi }\n');
  const p = ctx.board.objects.find(o => o.id === 'x').properties;
  assert.equal(p.top.value, '10');
  assert.equal(p.left.value, '20');
  assert.equal(p.width.value, '100');
  assert.equal(p.direction.value, 'right');
  assert.equal(p['grid-rows'].value, '2');
  assert.equal(p.tooltip.value, 'hi');
  assert.equal(p.top.source.start.line, 0);
});

test('every advertised layout field compiles; the unavailable ones are refused or ignored for the reason given', () => {
  for (const [name, source, id] of [['shape', 'x\n', 'x'], ['container', 'x: { child }\n', 'x'], ['image', 'x: { shape: image\nicon: https://example.com/i.svg }\n', 'x'], ['sql_table', 'x: { shape: sql_table }\n', 'x']]) {
    const fields = layout(source, id);
    assert.ok(fields.some(f => f.keyword === 'width') && fields.some(f => f.keyword === 'grid-rows'), name);
    for (const f of fields.filter(f => f.available)) {
      const pair = f.keyword === 'top' ? '\nx.left: 0' : f.keyword === 'left' ? '\nx.top: 0' : '';
      const result = compile(`${source}${f.path}: ${layoutSample(f)}${pair}\n`);
      assert.equal(result.error, undefined, `${name} ${f.path}: ${result.error?.message}`);
      assert.ok(result.boards[0].association.objects.find(o => o.id === 'x').properties[f.keyword], `${name} ${f.path} left no property`);
    }
  }
});

test('near constants are for root shapes only; top and left need TALA; a connection offers link only', () => {
  const nested = layout('p: { x }\n', 'p.x'), near = nested.find(f => f.keyword === 'near');
  assert.equal(near.available, false);
  assert.match(near.reason, /root level shapes/);
  assert.equal(compile('p: { x: { near: top-center } }\n').error.message.includes('root level'), true);
  assert.equal(layout('x\n').find(f => f.keyword === 'near').available, true);
  for (const keyword of ['top', 'left']) {
    const f = layout('x\n', 'x', 'dagre').find(f => f.keyword === keyword);
    assert.equal(f.available, false);
    assert.match(f.reason, /TALA/);
    assert.equal(layout('x\n').find(f => f.keyword === keyword).available, true);
  }
  const ctx = context('a -> b\n');
  const connection = capabilities(ctx.board.objects.find(o => o.kind === 'connection'), ctx).fields.filter(f => !f.path.includes('.style.') && f.keyword !== 'label' && !f.keyword.includes('arrowhead'));
  assert.deepEqual(connection.map(f => f.keyword), ['link']);
  assert.ok(compile('a -> b: { tooltip: hi }\n').error, 'D2 refuses a connection tooltip');
});

test('top and left are written together, because D2 refuses one alone', () => {
  const ctx = context('x\n'), fields = capabilities(ctx.board.objects.find(o => o.id === 'x'), ctx).fields;
  const top = fields.find(f => f.keyword === 'top');
  assert.deepEqual(setOps(top, '12', fields), [{ op: 'set', key: 'x.top', value: '12' }, { op: 'set', key: 'x.left', value: '0' }]);
  assert.deepEqual(setOps(top, '', fields), [{ op: 'delete', key: 'x.top' }, { op: 'delete', key: 'x.left' }]);
  const both = context('x: { top: 1\nleft: 2 }\n'), declared = capabilities(both.board.objects.find(o => o.id === 'x'), both).fields;
  assert.deepEqual(setOps(declared.find(f => f.keyword === 'top'), '12', declared), [{ op: 'set', key: 'x.top', value: '12' }]);
  const width = fields.find(f => f.keyword === 'width');
  assert.deepEqual(setOps(width, '50', fields), [{ op: 'set', key: 'x.width', value: '50' }]);
  assert.equal(compile('x: { top: 1 }\n').error.message.includes('together'), true);
});

const edit = (source, ops) => JSON.parse(goRun(binary, [JSON.stringify({ v: 2, type: 'edit', id: 1, revision: 1, files: { 'main.d2': source }, entry: 'main.d2', ops })]));

test('a connection advertises its endpoints and both arrowheads; the worker reports them and each can be written', () => {
  const source = 'a -> b\n';
  const ctx = context(source), connection = ctx.board.objects.find(o => o.kind === 'connection');
  const caps = capabilities(connection, ctx);
  assert.deepEqual(caps.endpoints, { source: 'a', target: 'b' });
  const heads = caps.fields.filter(f => f.keyword.includes('arrowhead'));
  assert.deepEqual(heads.map(f => f.keyword), ['source-arrowhead', 'source-arrowhead.filled', 'target-arrowhead', 'target-arrowhead.filled']);
  assert.deepEqual(heads.find(f => f.keyword === 'target-arrowhead').domain.values, table.arrowheads);
  assert.equal(heads.find(f => f.keyword === 'target-arrowhead.filled').domain.kind, 'boolean');
  for (const f of heads) {
    const value = f.domain.kind === 'boolean' ? 'false' : 'diamond';
    const result = edit(source, [{ op: 'set', key: f.path, value }]);
    assert.equal(result.error, undefined, `${f.path}: ${result.error?.message}`);
    const after = context(result.patch.text).board.objects.find(o => o.kind === 'connection');
    assert.equal(after.properties[f.keyword]?.value, value, `${f.path} was not reported back`);
    assert.ok(after.properties[f.keyword].source, `${f.path} has no source`);
  }
});
