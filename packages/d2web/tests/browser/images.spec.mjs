import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { goEnv, goRun, root } from '../../../../tests/examples.mjs';

// Spec 0010 in Chromium with the real worker and wasm: bundle (supplied bytes), unresolved warnings, D2's own rejection, the default, link mode, the
// fallback and hostile bytes. Test 7's comparison with native output needs a `d2` binary and is not part of this file.
const module = join(root, 'packages/d2web-wasm');
const output = join(root, 'artifacts/d2web-images');
mkdirSync(output, { recursive: true });
goRun('go', ['build', '-mod=readonly', '-o', join(output, 'd2web.wasm'), './cmd/d2web'], { cwd: module, env: { ...goEnv, GOOS: 'js', GOARCH: 'wasm' } });
const goRoot = goRun('go', ['env', 'GOROOT'], { cwd: module, env: goEnv }).trim();
const bundle = async (entry, globalName) => (await build({ entryPoints: [join(root, entry)], bundle: true, format: 'iife', globalName, write: false })).outputFiles[0].text;
const [clientJs, paintJs] = [await bundle('packages/d2web/src/client.ts', 'd2web'), await bundle('packages/d2web/src/paint.js', 'paint')];

const GREEN = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" fill="#00ad5a"/></svg>';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const render = { themeId: 0, sketch: false, pad: 0, scale: 1, center: false };

let hostRequests;
test.beforeEach(async ({ page }) => {
  hostRequests = [];
  await page.route('https://host.test/**', route => {
    const file = new URL(route.request().url()).pathname.slice(1);
    const bodies = { '': '<!doctype html><title>images</title><body style="margin:0">', 'client.js': clientJs, 'paint.js': paintJs,
      'worker.js': readFileSync(join(root, 'packages/d2web/src/worker.js')), 'wasm_exec.js': readFileSync(join(goRoot, 'lib/wasm/wasm_exec.js')) };
    route.fulfill({ body: file in bodies ? bodies[file] : readFileSync(join(output, file)), contentType: file === '' ? 'text/html' : file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
  });
  // Anything that is not the host page is an image the browser itself loads; answer it with a one-pixel PNG so a request is observable and harmless.
  await page.route(/^https:\/\/(?!host\.test)/, route => { hostRequests.push([route.request().resourceType(), route.request().url()]); route.fulfill({ body: Buffer.from(PNG, 'base64'), contentType: 'image/png' }); });
  await page.goto('https://host.test/');
  for (const url of ['/client.js', '/paint.js']) await page.addScriptTag({ url });
});

// Compiles in the page, paints the root board into the document and reports what a test needs to look at.
const run = (page, args) => page.evaluate(async ({ source, mode, bodies, fallback, boards, render }) => {
  const log = [];
  const spawn = () => { const w = new Worker('/worker.js?exec=/wasm_exec.js&wasm=/d2web.wasm'); const post = w.postMessage.bind(w); w.postMessage = m => { log.push(m.type); post(m); }; return w; };
  const bytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const images = mode === 'link' ? { mode } : mode === 'bundle' ? { mode, fallback, resolve: async s => { const b = bodies[s]; return b ? (b.png ? new Blob([bytes(b.png)], { type: 'image/png' }) : new Blob([b.svg], { type: 'image/svg+xml' })) : null; } } : undefined;
  const client = d2web.createClient({ spawn, images });
  const result = await client.compile({ revision: 1, files: { 'main.d2': source }, entry: 'main.d2', render, ...(boards ? { boards } : {}) });
  client.dispose();
  window.__pwned = undefined;
  let painted = null;
  if (result.boards) {
    const board = result.boards[0];
    const p = paint.paintScene(board.scene, { html: true, association: board.association.objects });
    document.body.innerHTML = p.html;
    const assets = Object.keys(board.scene.Assets ?? {}).filter(k => k.startsWith('image:'));
    painted = {
      html: p.html, assets, stats: p.stats, objects: board.association.objects.filter(o => o.image).map(o => ({ id: o.id, ...o.image })),
      imgs: [...document.querySelectorAll('img[src]')].map(i => ({ src: i.getAttribute('src'), policy: i.getAttribute('referrerpolicy'), rect: i.getBoundingClientRect().toJSON(), style: i.getAttribute('style') })),
      scripts: document.querySelectorAll('script,foreignObject,[onload],[onerror]').length,
    };
  }
  return { result: { error: result.error, diagnostics: result.diagnostics, echo: result.echo }, log, painted };
}, { render, ...args });

const three = 'a: { icon: https://i.test/a.svg }\np: { shape: image; icon: https://i.test/p.png }\na -> p: { icon: https://i.test/e.svg }\n';
const all = { 'https://i.test/a.svg': { svg: GREEN }, 'https://i.test/p.png': { png: PNG }, 'https://i.test/e.svg': { svg: GREEN } };

test('7. bundle: supplied bytes paint real vectors and a raster for an icon, a shape: image and an edge icon, with no warning and no browser request', async ({ page }) => {
  test.setTimeout(120_000);
  const { result, log, painted } = await run(page, { source: three, mode: 'bundle', bodies: all });
  expect(result.error).toBeUndefined();
  expect(result.diagnostics).toEqual([]);
  expect(result.echo.images).toBe('bundle');
  expect(log).toEqual(['preflight', 'compile']);
  expect(painted.assets.filter(a => a !== 'image:unavailable').length).toBeGreaterThanOrEqual(2);
  expect(painted.assets).not.toContain('image:unavailable');
  expect(painted.html).toContain('rgb(0,173,90)'); // the supplied SVG's fill, imported as drawing primitives
  expect(painted.html).toMatch(/<img [^>]*src="data:image\/png;base64,/); // the raster, embedded
  expect(hostRequests).toEqual([]);
});

test('8. an unresolved link paints the placeholder and one image-unresolved warning names the link, board and object', async ({ page }) => {
  test.setTimeout(120_000);
  const { result, painted } = await run(page, { source: three, mode: 'bundle', bodies: { 'https://i.test/a.svg': { svg: GREEN }, 'https://i.test/p.png': { png: PNG } } });
  expect(result.error).toBeUndefined();
  expect(result.diagnostics).toHaveLength(1);
  const [d] = result.diagnostics;
  expect(d).toMatchObject({ severity: 'warning', code: 'image-unresolved' });
  expect(d.board ?? '').toBe(''); // the root board's path is empty and omitted
  expect(d.message).toContain('https://i.test/e.svg');
  expect(d.message).toContain('(a -> p)[0]');
  expect(painted.assets).toContain('image:unavailable');
  expect(painted.imgs.filter(i => i.src.startsWith('https:'))).toEqual([]);
});

test('9. an SVG with gradients outside <defs> makes the compile fail with D2\'s message and no boards', async ({ page }) => {
  test.setTimeout(120_000);
  const bad = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient><rect width="24" height="24" fill="url(#g)"/></svg>';
  const { result, painted } = await run(page, { source: 'a: { icon: https://i.test/bad.svg }\n', mode: 'bundle', bodies: { 'https://i.test/bad.svg': { svg: bad } } });
  expect(result.error?.message ?? '').toMatch(/gradient|defs/i);
  expect(painted).toBeNull();
});

test('10. default: no images option means no preflight, no request and the placeholder', async ({ page }) => {
  test.setTimeout(120_000);
  const { result, log, painted } = await run(page, { source: three, mode: undefined });
  expect(result.error).toBeUndefined();
  expect(result.diagnostics).toEqual([]);
  expect(result.echo.images).toBeUndefined();
  expect(log).toEqual(['compile']);
  expect(painted.assets).toEqual(['image:unavailable']);
  expect(painted.imgs.filter(i => i.src.startsWith('https:'))).toEqual([]);
  expect(hostRequests).toEqual([]);
});

test('4. a relative path is a link like any other: supplied it is real vectors, unsupplied it is the placeholder and a warning, never a failed compile', async ({ page }) => {
  test.setTimeout(120_000);
  const source = 'a: { icon: ./img/go.svg }\nb: { icon: other/missing.png }\n';
  const { result, painted } = await run(page, { source, mode: 'bundle', bodies: { './img/go.svg': { svg: GREEN } } });
  expect(result.error).toBeUndefined();
  expect(painted.html).toContain('rgb(0,173,90)');
  expect(painted.assets).toContain('image:unavailable');
  expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0].message).toContain('other/missing.png');
  // Without the option a missing file is the placeholder too (D2's own behaviour for a file that does not exist), not the error the browser used to give.
  const plain = await run(page, { source, mode: undefined, bodies: {} });
  expect(plain.result.error).toBeUndefined();
  expect(plain.painted.assets).toEqual(['image:unavailable']);
});

test('11, 13. link mode: the <img> sits at D2\'s box, a relative path makes no element, and only the browser loads the image', async ({ page }) => {
  test.setTimeout(120_000);
  // D2 itself refuses javascript:, file:, ftp:, // and malformed data: links (the compile fails; see the next test); a relative path is what is left to the painter.
  const source = three + 'rel: { icon: relative/icon.png }\n';
  const { result, log, painted } = await run(page, { source, mode: 'link' });
  expect(result.error).toBeUndefined();
  expect(result.echo.images).toBe('link');
  expect(log).toEqual(['compile']);
  const byId = Object.fromEntries(painted.objects.map(o => [o.id, o]));
  expect(byId.a).toMatchObject({ source: 'https://i.test/a.svg', role: 'icon', node: 'a:icon' });
  expect(byId.p).toMatchObject({ source: 'https://i.test/p.png', role: 'image', node: 'p:image' });
  expect(byId['(a -> p)[0]']).toMatchObject({ source: 'https://i.test/e.svg', role: 'edge-icon', node: '(a -> p)[0]:icon' });
  expect(painted.imgs.map(i => i.src).sort()).toEqual(['https://i.test/a.svg', 'https://i.test/e.svg', 'https://i.test/p.png']);
  for (const img of painted.imgs) { expect(img.policy).toBe('no-referrer'); expect(img.rect.width).toBeGreaterThan(0); expect(img.rect.height).toBeGreaterThan(0); }
  await expect.poll(() => hostRequests.length).toBe(3); // the routes answer asynchronously
  expect(hostRequests.every(([type]) => type === 'image')).toBe(true);
  expect(hostRequests.map(([, url]) => url).sort()).toEqual(['https://i.test/a.svg', 'https://i.test/e.svg', 'https://i.test/p.png']);
});

test('11. D2 refuses unsafe schemes before the painter sees them: javascript:, file:, ftp: and // fail the compile in every mode', async ({ page }) => {
  test.setTimeout(120_000);
  for (const mode of [undefined, 'bundle', 'link']) {
    for (const icon of ['"javascript:alert(1)"', '"file:///etc/passwd"', '"ftp://i.test/a.png"', '"//host/a.png"']) {
      const { result, painted } = await run(page, { source: `a: { icon: ${icon} }\n`, mode, bodies: {} });
      expect(result.error?.message, `${mode} ${icon}`).toMatch(/unsupported URI scheme|network-path/);
      expect(painted).toBeNull();
    }
  }
});

test('17. fallback "link": an unresolved link is an <img> and still warned about; a resolved one is real vectors', async ({ page }) => {
  test.setTimeout(120_000);
  const source = 'a: { icon: https://i.test/a.svg }\nb: { icon: https://i.test/b.svg }\n';
  const body = { 'https://i.test/a.svg': { svg: GREEN } };
  const withFallback = await run(page, { source, mode: 'bundle', fallback: 'link', bodies: body });
  expect(withFallback.painted.imgs.map(i => i.src)).toEqual(['https://i.test/b.svg']);
  expect(withFallback.painted.html).toContain('rgb(0,173,90)');
  expect(withFallback.result.diagnostics).toHaveLength(1);
  expect(withFallback.result.diagnostics[0].message).toContain('a link');
  const without = await run(page, { source, mode: 'bundle', bodies: body });
  expect(without.painted.imgs).toEqual([]);
  expect(without.painted.assets).toContain('image:unavailable');
});

test('12. hostile bytes: nothing from the SVG reaches the page as markup and nothing runs', async ({ page }) => {
  test.setTimeout(180_000);
  const uses = Array.from({ length: 40 }, (_, i) => `<g id="g${i + 1}"><use href="#g${i}"/><use href="#g${i}"/></g>`).join('');
  const hostile = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="24" height="24" onload="window.__pwned=1"><script>window.__pwned=1</script><image href="https://evil.test/x.png" width="4" height="4"/><foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml" onclick="window.__pwned=2">x</div></foreignObject><a href="javascript:window.__pwned=3"><rect width="24" height="24" fill="#ff0000" onclick="window.__pwned=4"/></a><defs><g id="g0"><rect width="1" height="1"/></g>${uses}</defs><use href="#g40"/></svg>`;
  const { result, painted } = await run(page, { source: 'a: { icon: https://i.test/h.svg }\n', mode: 'bundle', bodies: { 'https://i.test/h.svg': { svg: hostile } } });
  if (result.error) { expect(painted).toBeNull(); return; } // D2 rejected it (the budget on <use> instances, for one)
  expect(painted.scripts).toBe(0);
  expect(painted.html).not.toMatch(/evil\.test|javascript:|onclick|onload|<script|foreignObject/i);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  await page.waitForTimeout(300);
  expect(hostRequests).toEqual([]);
});
