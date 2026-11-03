import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { goEnv, goRun, root } from '../../../tests/examples.mjs';
import { normalizeCompileRequest } from '../../d2web/src/request.ts';
import { capabilities } from '../src/capabilities.ts';

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
  for (const field of capabilities(connection, ctx).fields.filter(f => f.path.includes('.style.'))) {
    assert.ok(field.available, field.path);
    const result = compile(`a -> b\n${field.path}: ${sample(field)}\n`);
    assert.equal(result.error, undefined, `${field.path}: ${result.error?.message}`);
    assert.ok(result.boards[0].association.objects.find(o => o.kind === 'connection').properties[property(field.keyword)], `${field.path} left no property`);
  }
});
