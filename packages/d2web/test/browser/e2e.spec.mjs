import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { goEnv, goRun, nativeArgs, root } from '../../../../tests/examples.mjs';

// Slice 1 step 6, end to end in Chromium: D2 source -> client -> worker -> wasm -> scene JSON + fonts -> painter -> pixels, compared with
// D2's own native SVG for the same theme. Light and dark are two requests (spec 0001 section 5). Fidelity bar: ADR 0002 / 0007 (5%).
const module = join(root, 'packages/d2web-wasm');
const output = join(root, 'artifacts/d2web-e2e');
mkdirSync(output, { recursive: true });
goRun('go', ['build', '-mod=readonly', '-o', join(output, 'd2web.wasm'), './cmd/d2web'], { cwd: module, env: { ...goEnv, GOOS: 'js', GOARCH: 'wasm' } });
const goRoot = goRun('go', ['env', 'GOROOT'], { cwd: module, env: goEnv }).trim();
const bundle = async (entry, globalName) => (await build({ entryPoints: [join(root, entry)], bundle: true, format: 'iife', globalName, write: false })).outputFiles[0].text;
const [clientJs, paintJs] = [await bundle('packages/d2web/src/client.ts', 'd2web'), await bundle('packages/d2web/src/paint.js', 'paint')];

const source = `direction: right
db: Database { shape: cylinder }
api: API { style.fill: "#fff4cc" }
box: Group { a; b }
api -> db: query
box.a -> api
`;
const native = theme => {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-'));
  writeFileSync(join(dir, 'main.d2'), source);
  execFileSync('d2', [...nativeArgs.map(a => a.startsWith('--theme=') ? `--theme=${theme}` : a), join(dir, 'main.d2'), join(dir, 'out.svg')], { encoding: 'utf8' });
  return readFileSync(join(dir, 'out.svg'), 'utf8');
};

test('source to pixels: light and dark as two requests match native D2 within 5%', async ({ page }) => {
  test.setTimeout(120_000);
  await page.route('https://host.test/**', route => {
    const file = new URL(route.request().url()).pathname.slice(1);
    const type = file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
    const bodies = { '': '<!doctype html><title>e2e</title><body style="margin:0;background:#fff">', 'client.js': clientJs, 'paint.js': paintJs,
      'worker.js': readFileSync(join(root, 'packages/d2web/src/worker.js')), 'wasm_exec.js': readFileSync(join(goRoot, 'lib/wasm/wasm_exec.js')) };
    route.fulfill({ body: file in bodies ? bodies[file] : readFileSync(join(output, file)), contentType: file === '' ? 'text/html' : type });
  });
  await page.goto('https://host.test/');
  for (const url of ['/client.js', '/paint.js']) await page.addScriptTag({ url });
  const ratios = {};
  const painted = {};
  for (const [name, themeId] of [['light', 0], ['dark', 200]]) {
    const result = await page.evaluate(async ({ source, themeId }) => {
      const client = d2web.createClient({ spawn: () => new Worker('/worker.js?exec=/wasm_exec.js&wasm=/d2web.wasm') });
      const r = await client.compile({ revision: 1, files: { 'main.d2': source }, entry: 'main.d2', render: { themeId, sketch: false, pad: 0, scale: 1, center: false } });
      client.dispose();
      return r;
    }, { source, themeId });
    expect(result.error).toBeUndefined();
    expect(result.echo.render.themeId).toBe(themeId);
    const nativeSvg = native(themeId);
    await page.evaluate(async ({ result, nativeSvg }) => {
      for (const [id, b64] of Object.entries(result.fonts)) {
        const face = new FontFace(paint.fontFamily(id), Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
        document.fonts.add(await face.load());
      }
      const { svg } = paint.paintScene(result.boards[0].scene);
      document.body.innerHTML = `<div id="native" style="position:absolute;left:0;top:0">${nativeSvg}</div><div id="scene" style="position:absolute;left:0;top:0;visibility:hidden">${svg}</div>`;
      await document.fonts.ready;
    }, { result, nativeSvg });
    const shot = async id => {
      await page.evaluate(id => { for (const el of document.querySelectorAll('#native,#scene')) el.style.visibility = el.id === id ? 'visible' : 'hidden'; }, id);
      return (await page.locator('#' + id).screenshot({ animations: 'disabled' })).toString('base64');
    };
    const [a, b] = [await shot('native'), await shot('scene')];
    painted[name] = b;
    ratios[name] = await page.evaluate(async ({ a, b }) => {
      const load = async b64 => { const i = new Image(); i.src = 'data:image/png;base64,' + b64; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(i, 0, 0); return { w: i.width, h: i.height, p: x.getImageData(0, 0, i.width, i.height).data }; };
      const [x, y] = [await load(a), await load(b)];
      if (x.w !== y.w || x.h !== y.h) return { sizeMismatch: [x.w, x.h, y.w, y.h] };
      let different = 0;
      for (let i = 0; i < x.p.length; i += 4) {
        const over = (p, k) => p[i + k] * p[i + 3] / 255 + 255 * (1 - p[i + 3] / 255);
        if ([0, 1, 2].some(k => Math.abs(over(x.p, k) - over(y.p, k)) > 25)) different++;
      }
      return different / (x.w * x.h);
    }, { a, b });
  }
  writeFileSync(join(output, 'ratios.json'), JSON.stringify(ratios, null, 1));
  expect(ratios.light, JSON.stringify(ratios)).toBeLessThanOrEqual(0.05);
  expect(ratios.dark, JSON.stringify(ratios)).toBeLessThanOrEqual(0.05);
  expect(painted.light, 'dark theme paints different pixels than light').not.toBe(painted.dark);
});
