import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { goEnv, goRun, root } from '../../../tests/examples.mjs';
import { normalizeCompileRequest } from '../../d2web/src/request.ts';

// Spec 0001 on the worker side: native and Node/WASM builds of cmd/d2web answer the same compile requests.
const module = join(root, 'packages/d2web-wasm');
const output = join(root, 'artifacts/d2web-wasm');
mkdirSync(output, { recursive: true });
const env = { ...goEnv, GOFLAGS: '-mod=readonly' };
const opts = { cwd: module, env };
goRun('go', ['build', '-o', join(output, 'd2web'), './cmd/d2web'], opts);
goRun('go', ['build', '-o', join(output, 'd2web.wasm'), './cmd/d2web'], { cwd: module, env: { ...env, GOOS: 'js', GOARCH: 'wasm' } });
const goRoot = goRun('go', ['env', 'GOROOT'], opts).trim();

const render = { themeId: 0, sketch: false, pad: 0, scale: 1, center: false };
const request = (source, patch = {}) => JSON.stringify(normalizeCompileRequest({ v: 1, type: 'compile', id: 1, revision: 3, files: { 'main.d2': source }, entry: 'main.d2', render, ...patch }));
const native = json => JSON.parse(goRun(join(output, 'd2web'), [json], opts));
const wasm = json => {
  for (let attempt = 1; ; attempt++) {
    try { return JSON.parse(goRun(join(goRoot, 'lib/wasm/go_js_wasm_exec'), [join(output, 'd2web.wasm'), json], { ...opts, timeout: 60_000 })); }
    catch (error) { if (attempt === 3 || error.actual?.code !== 'ETIMEDOUT') throw error; } // known 1-in-20-50 Go/WASM hang under load
  }
};
const stable = r => ({ ...r, millis: 0 });

const simple = 'a: Service {shape: cylinder}\nb: Client\na -> b: calls\n';
const layers = 'x\nlayers: { one: { y -> z } }\nscenarios: { two: { x: changed } }\n';

test('success: one root board, echo, revision, fonts beside the scene', () => {
  const r = native(request(simple));
  assert.equal(r.type, 'result'); assert.equal(r.id, 1); assert.equal(r.revision, 3);
  assert.deepEqual(r.available, ['']);
  assert.equal(r.boards.length, 1);
  assert.equal(r.boards[0].path, '');
  assert.equal(r.boards[0].scene.$, 'Document');
  assert.equal(r.error, undefined);
  assert.equal(r.echo.layout, 'tala'); assert.deepEqual(r.echo.render, render);
  assert(Object.keys(r.fonts).length > 0, 'font bytes are returned');
  assert(!JSON.stringify(r.boards[0].scene).includes('"Data":"'), 'font bytes are not inside the scene');
});

test('native and Node/WASM agree: tala, sketch, dark theme, dagre, elk, all boards', { timeout: 300_000 }, () => {
  for (const json of [
    request(simple), request(simple, { render: { ...render, sketch: true } }), request(simple, { render: { ...render, themeId: 200 } }),
    request(simple, { layout: 'dagre' }), request(simple, { layout: 'elk' }), request(layers, { boards: 'all' }),
  ]) assert.deepEqual(stable(wasm(json)), stable(native(json)), json.slice(0, 160));
});

test('boards: root by default, all or listed on request, unknown is an error', () => {
  assert.deepEqual(native(request(layers)).boards.map(b => b.path), ['']);
  const all = native(request(layers, { boards: 'all' }));
  assert.deepEqual(all.available, ['', '/layers/one', '/scenarios/two']);
  assert.deepEqual(all.boards.map(b => b.path), all.available);
  assert.deepEqual(native(request(layers, { boards: ['/layers/one'] })).boards.map(b => b.path), ['/layers/one']);
  const bad = native(request(layers, { boards: ['/layers/missing'] }));
  assert.equal(bad.error.code, 'compile'); assert.equal(bad.boards, undefined);
});

test('render options change the scene: light, dark theme and sketch', () => {
  const scene = r => JSON.stringify(r.boards[0].scene);
  const light = scene(native(request(simple)));
  assert.notEqual(scene(native(request(simple, { render: { ...render, themeId: 200 } }))), light);
  assert.notEqual(scene(native(request(simple, { render: { ...render, sketch: true } }))), light);
});

test('failures return an error and no boards', () => {
  const syntax = native(request('a -> {'));
  assert.equal(syntax.error.code, 'compile'); assert.equal(syntax.boards, undefined); assert.equal(syntax.fonts, undefined);
  assert(syntax.error.diagnostics.length > 0);
  assert.equal(syntax.error.diagnostics[0].file, 'main.d2');
  assert(Number.isInteger(syntax.error.diagnostics[0].range.start));
  assert.equal(syntax.revision, 3);
  const budget = native(request(simple, { budgets: { maxNodes: 1 } }));
  assert.equal(budget.error.code, 'budget'); assert.equal(budget.boards, undefined);
  const malformed = native('{"v":1,');
  assert.equal(malformed.error.code, 'internal');
  const unnormalized = native(JSON.stringify({ v: 1, type: 'compile', id: 2, revision: 0, files: { 'main.d2': 'a' }, entry: 'main.d2', layout: 'tala', render, boards: [''] }));
  assert.equal(unnormalized.error.code, 'internal', 'budgets are required');
});

// Spec 0010: the preflight lists image links without layout, and supplied bytes (base64 across the JSON boundary, as worker.js sends them)
// become real image assets; links that were not supplied stay placeholders with an image-unresolved warning.
const svgIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" fill="#00ADD8"/></svg>';
const withImages = 'a: { icon: "https://i.test/go.svg#frag" }\nb: { icon: https://i.test/none.svg }\n';
const images = { 'https://i.test/go.svg#frag': { type: 'image/svg+xml', data: Buffer.from(svgIcon).toString('base64') } };
const preflight = source => JSON.stringify({ v: 1, type: 'preflight', id: 4, files: { 'main.d2': source }, entry: 'main.d2' });
const assetsOf = r => Object.keys(r.boards[0].scene.Assets ?? {}).filter(id => id.startsWith('image:'));

test('images: preflight, supplied bytes and unresolved warnings; native and Node/WASM agree', { timeout: 300_000 }, () => {
  const compile = JSON.parse(request(withImages));
  compile.budgets.svgImport = { maxSourceBytes: 1 << 22, maxElements: 100000, maxAttributes: 500000, maxAttributeBytes: 1 << 22, maxPathCommands: 1000000, maxTransformFunctions: 100000, maxDeclaredResources: 10000, maxExpandedUseInstances: 10000 };
  const plain = JSON.stringify(compile), bundled = JSON.stringify({ ...compile, images });

  const found = native(preflight(withImages));
  assert.equal(found.type, 'images'); assert.equal(found.id, 4);
  assert.deepEqual(found.links.map(l => [l.board, l.id, l.kind, l.source]), [['', 'a', 'icon', 'https://i.test/go.svg#frag'], ['', 'b', 'icon', 'https://i.test/none.svg']]);
  assert.match(native(preflight('a: {')).error, /./);

  const without = native(plain);
  assert.deepEqual(assetsOf(without).filter(id => id !== 'image:unavailable'), []); assert.deepEqual(without.diagnostics, []); assert.equal(without.echo.images, undefined);
  const result = native(bundled);
  assert.equal(result.error, undefined); assert.equal(result.echo.images, 'bundle');
  assert(assetsOf(result).some(id => id !== 'image:unavailable'), 'the supplied link is a real asset');
  assert(assetsOf(result).includes('image:unavailable'), 'the other link is still the placeholder');
  assert.deepEqual(result.diagnostics.map(d => [d.severity, d.code, d.board ?? '']), [['warning', 'image-unresolved', '']]);
  assert.match(result.diagnostics[0].message, /none\.svg/);

  assert.deepEqual(stable(wasm(bundled)), stable(result));
  assert.deepEqual(JSON.parse(goRun(join(goRoot, 'lib/wasm/go_js_wasm_exec'), [join(output, 'd2web.wasm'), preflight(withImages)], { ...opts, timeout: 60_000 })), found);
});
