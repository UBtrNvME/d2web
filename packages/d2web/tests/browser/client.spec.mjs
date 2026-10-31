import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { goEnv, goRun, root } from '../../../../tests/examples.mjs';

// Spec 0001 host client against the real worker and the real wasm in Chromium: ready, compile, latest-wins, respawn, silent timeout.
const module = join(root, 'packages/d2web-wasm');
const output = join(root, 'artifacts/d2web-client');
mkdirSync(output, { recursive: true });
goRun('go', ['build', '-mod=readonly', '-o', join(output, 'd2web.wasm'), './cmd/d2web'], { cwd: module, env: { ...goEnv, GOOS: 'js', GOARCH: 'wasm' } });
const goRoot = goRun('go', ['env', 'GOROOT'], { cwd: module, env: goEnv }).trim();
const bundle = (await build({ entryPoints: [join(root, 'packages/d2web/src/client.ts')], bundle: true, format: 'iife', globalName: 'd2web', write: false })).outputFiles[0].text;
// Same shape as the research sizing-loop board: TALA takes about 2.7 s at 50 nodes and 18-24 s at 100 in Chromium WASM.
const big = n => {
  const l = ['direction: right'];
  for (let i = 0; i < n; i++) l.push(`n${i}.label: ""`, `n${i}.width: 80`, `n${i}.height: 40`);
  for (let i = 1; i < n; i++) l.push(`n${Math.floor((i - 1) / 3)} -> n${i}`);
  for (let i = 5; i < n; i += 5) l.push(`n${i} -> n${(i * 7) % i}`);
  return l.join('\n') + '\n';
};

test.beforeEach(async ({ page }) => {
  await page.route('https://host.test/**', route => {
    const url = new URL(route.request().url());
    const file = url.pathname.slice(1);
    const type = file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
    if (file === '') return route.fulfill({ body: '<!doctype html><title>client</title>', contentType: 'text/html' });
    if (file === 'client.js') return route.fulfill({ body: bundle, contentType: type });
    if (file === 'worker.js') return route.fulfill({ body: readFileSync(join(root, 'packages/d2web/src/worker.js')), contentType: type });
    if (file === 'wasm_exec.js') return route.fulfill({ body: readFileSync(join(goRoot, 'lib/wasm/wasm_exec.js')), contentType: type });
    return route.fulfill({ body: readFileSync(join(output, file)), contentType: type });
  });
  await page.goto('https://host.test/');
  await page.addScriptTag({ url: '/client.js' });
  await page.evaluate(() => {
    const render = { themeId: 0, sketch: false, pad: 0, scale: 1, center: false };
    window.render = render;
    window.spawned = 0;
    window.make = options => d2web.createClient({ spawn: () => { window.spawned++; return new Worker('/worker.js?exec=/wasm_exec.js&wasm=/d2web.wasm'); }, ...options });
    window.input = (revision, source) => ({ revision, files: { 'main.d2': source }, entry: 'main.d2', render });
  });
});

test('compile through the real worker: ready, a painted-ready scene, errors as results', async ({ page }) => {
  const out = await page.evaluate(async () => {
    const client = make();
    const ok = await client.compile(input(1, 'a -> b: hi\n'));
    const bad = await client.compile(input(2, 'a -> {'));
    client.dispose();
    return { ok: { rev: ok.revision, scene: ok.boards[0].scene.$, fonts: Object.keys(ok.fonts).length, available: ok.available }, bad: { code: bad.error.code, boards: bad.boards, range: bad.error.diagnostics[0].range } };
  });
  expect(out.ok).toEqual({ rev: 1, scene: 'Document', fonts: expect.any(Number), available: [''] });
  expect(out.ok.fonts).toBeGreaterThan(0);
  expect(out.bad.code).toBe('compile');
  expect(out.bad.boards).toBeUndefined();
  expect(typeof out.bad.range.start).toBe('number');
});

test('latest wins in a real worker: a burst computes the first and the last only', async ({ page }) => {
  const out = await page.evaluate(async ({ source }) => {
    const client = make();
    await client.compile(input(0, 'warm\n')); // instance up
    const results = await Promise.all([1, 2, 3, 4, 5].map(n => client.compile(input(n, n === 1 ? source : `n${n}\n`)).then(r => `ok${r.revision}`, e => e.constructor.name)));
    client.dispose();
    return { results, spawned: spawned };
  }, { source: big(25) });
  expect(out.results).toEqual(['SupersededError', 'SupersededError', 'SupersededError', 'SupersededError', 'ok5']);
  expect(out.spawned).toBe(1);
});

test('a newer request aborts a long compile by respawning; a silent worker times out and is replaced', async ({ page }) => {
  test.setTimeout(120_000);
  const out = await page.evaluate(async ({ source }) => {
    const aborting = make({ supersedeAfterMs: 200 });
    await aborting.compile(input(0, 'warm\n'));
    const slow = aborting.compile(input(1, source)).then(r => `ok${r.revision}`, e => e.constructor.name);
    await new Promise(r => setTimeout(r, 400));
    const t0 = performance.now();
    const fast = await aborting.compile(input(2, 'a -> b\n'));
    const afterAbortMillis = performance.now() - t0;
    const slowResult = await slow;
    aborting.dispose();
    const spawnedAbort = spawned;
    const silent = make({ silentTimeoutMs: 300 });
    const timedOut = await silent.compile(input(3, source)).then(r => `ok${r.revision}`, e => e.constructor.name);
    const after = await silent.compile(input(4, 'x -> y\n'));
    silent.dispose();
    return { slowResult, fastRev: fast.revision, afterAbortMillis, spawnedAbort, timedOut, afterRev: after.revision, spawnedTotal: spawned };
  }, { source: big(100) });
  expect(out.slowResult).toBe('SupersededError');
  expect(out.fastRev).toBe(2);
  expect(out.afterAbortMillis).toBeLessThan(10_000); // a 100-node TALA compile alone takes 18-24 s
  expect(out.spawnedAbort).toBe(2);
  expect(out.timedOut).toBe('TimeoutError');
  expect(out.afterRev).toBe(4);
  expect(out.spawnedTotal).toBe(2 + 2);
});
