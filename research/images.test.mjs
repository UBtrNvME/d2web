import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { goProbe, root } from '../tests/examples.mjs';

// ADR 0011 evidence (no network): the D2 compiler can list a source's image links before layout, that list is exactly what the scene builder then asks its
// resolver for, and a consumer-supplied map of bytes reaches the builder through the resolver's HTTP client, so no patch to D2 is needed.
const output = join(root, 'artifacts/research-images');
mkdirSync(output, { recursive: true });
const probe = goProbe(join(root, 'research/images.go'), join(output, 'probe'));

const dataUri = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#00f"/></svg>').toString('base64')}`;
const circle = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#f00"/></svg>';
const files = {
  'lib.d2': 'shared: Shared {icon: https://i.test/imported.svg}\n',
  'main.d2': [
    'vars: {logo: https://i.test/var.svg}',
    'classes: {svc: {icon: https://i.test/class.svg}}',
    '...@lib',
    'v: V {icon: ${logo}}',
    'c: C {class: svc}',
    'pic: Pic {shape: image; icon: https://i.test/pic.svg}',
    'dup: Dup {icon: https://i.test/pic.svg}',
    'q: Q {icon: "https://i.test/quoted.svg"}',
    `d: D {icon: "${dataUri}"}`,
    'a -> b: link {icon: https://i.test/edge.svg}',
    'grp: Group {', '  *.icon: https://i.test/glob.svg', '  m1', '  m2', '}',
    'layers: {l1: {x: X {icon: https://i.test/layer.svg}}}',
    'scenarios: {s1: {y: Y {icon: https://i.test/scenario.svg}}}',
    'steps: {st1: {z: Z {icon: https://i.test/step.svg}}}', '',
  ].join('\n'),
};
const run = (extra, runner = probe.native) => JSON.parse(runner([JSON.stringify({ files, entry: 'main.d2', ...extra })]));
const links = images => [...new Set(images.map(i => i.source).filter(s => /^https?:/.test(s)))].sort();

test('the preflight lists every image link D2 will use, whichever way it arrives, and it is the set the scene builder requests', { timeout: 300_000 }, () => {
  const r = run({});
  assert.equal(r.error, undefined);
  const expected = ['class', 'edge', 'glob', 'imported', 'layer', 'pic', 'quoted', 'scenario', 'step', 'var'].map(n => `https://i.test/${n}.svg`);
  assert.deepEqual(links(r.images), expected, 'links from vars, classes, globs, imports, quoting, edges and boards are all found');
  assert.deepEqual(r.requested, expected, 'the builder asks its resolver for exactly these');
  const root = r.images.filter(i => i.board === '');
  assert.deepEqual(root.filter(i => i.source.endsWith('glob.svg')).map(i => i.id), ['grp.m1', 'grp.m2'], 'a glob reaches each object it matches');
  assert.equal(root.find(i => i.id === 'pic').kind, 'image', 'shape: image is told apart from an icon');
  assert.equal(root.find(i => i.id === '(a -> b)[0]').kind, 'edge-icon');
  assert.deepEqual([...new Set(r.images.map(i => i.board))].sort(), ['', 'layers.l1', 'scenarios.s1', 'steps.st1'], 'layers, scenarios and steps are separate boards');
  assert.ok(r.images.some(i => i.source === dataUri), 'a data: URI is listed too (the consumer skips it: it needs no fetch)');
  assert.ok(!r.requested.includes(dataUri), 'and the builder never requests it');
});

test('the preflight is much cheaper than a full compile and fails on bad D2 before layout', { timeout: 300_000 }, () => {
  const r = run({});
  assert.ok(r.preflightMs * 5 < r.fullMs, `preflight ${r.preflightMs} ms against a full build ${r.fullMs} ms`);
  const bad = JSON.parse(probe.native([JSON.stringify({ files: { 'main.d2': 'a: {icon: https://i.test/a.svg\n' }, entry: 'main.d2' })]));
  assert.match(bad.error, /main\.d2/);
  assert.equal(bad.fullMs, 0, 'no layout ran');
  const none = run({ files: { 'main.d2': 'a -> b\n' } });
  assert.deepEqual(none.images, null);
  assert.deepEqual(none.requested, null);
});

test('bytes the consumer supplies reach the scene builder through the resolver HTTP client, with no patch to D2', { timeout: 300_000 }, () => {
  const without = run({});
  const supplied = run({ serve: { 'https://i.test/pic.svg': circle } });
  assert.equal(supplied.error, undefined);
  assert.ok(without.assets.includes('image:unavailable'), 'unsupplied links paint D2 placeholder');
  assert.equal(supplied.assets.length, without.assets.length + 1, 'one more real asset once its bytes are supplied');
  assert.deepEqual(supplied.requested, without.requested, 'what is asked for does not depend on what is supplied');
  assert.ok(supplied.assets.includes('image:unavailable'), 'links the consumer did not supply still paint the placeholder');
});

test('the preflight and the supplied-bytes path give the same results in native and Node/WASM (the worker runs wasm)', { timeout: 300_000 }, () => {
  const native = run({ serve: { 'https://i.test/pic.svg': circle } });
  const wasm = run({ serve: { 'https://i.test/pic.svg': circle } }, probe.wasm);
  const strip = r => ({ images: r.images, requested: r.requested, assets: r.assets });
  assert.deepEqual(strip(wasm), strip(native));
});
