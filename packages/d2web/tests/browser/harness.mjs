import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { goEnv, goRun, root } from '../../../../tests/examples.mjs';
import { patches } from '../../../../tests/upstream-patches.mjs';

// Shared by the Chromium specs of packages/d2web: builds the wasm and the package bundle once, routes them onto https://host.test, and
// exposes `compile(source, render)` in the page (real client, real worker, real wasm).
const module = join(root, 'packages/d2web-wasm');
export const output = join(root, 'artifacts/d2web-browser');
mkdirSync(output, { recursive: true });
const emojiPatch = patches().some(p => p.file.endsWith('d2fonts-wasm-supply-bundled-emoji.patch') && p.state === 'applied');
goRun('go', ['build', '-mod=readonly', ...(emojiPatch ? ['-tags', 'd2webpatched'] : []), '-o', join(output, 'd2web.wasm'), './cmd/d2web'], { cwd: module, env: { ...goEnv, GOOS: 'js', GOARCH: 'wasm' } });
const goRoot = goRun('go', ['env', 'GOROOT'], { cwd: module, env: goEnv }).trim();
const bundle = (await build({ entryPoints: [join(root, 'packages/d2web/src/index.ts')], bundle: true, format: 'iife', globalName: 'd2web', write: false })).outputFiles[0].text;

export const defaultRender = { themeId: 0, sketch: false, pad: 0, scale: 1, center: false };

// `html` is the document served at https://host.test/ ; `css` is added to <head>.
export async function open(page, { body = '', css = '' } = {}) {
  await page.route('https://host.test/**', route => {
    const file = new URL(route.request().url()).pathname.slice(1);
    const type = file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
    const bodies = { 'd2web.js': bundle, 'worker.js': readFileSync(join(root, 'packages/d2web/src/worker.js')), 'wasm_exec.js': readFileSync(join(goRoot, 'lib/wasm/wasm_exec.js')) };
    if (file === '') return route.fulfill({ body: `<!doctype html><title>mount</title><style>*{margin:0}${css}</style><body style="background:#fff">${body}`, contentType: 'text/html' });
    route.fulfill({ body: file in bodies ? bodies[file] : readFileSync(join(output, file)), contentType: type });
  });
  await page.goto('https://host.test/');
  await page.addScriptTag({ url: '/d2web.js' });
  await page.evaluate(render => {
    window.client = d2web.createClient({ spawn: () => new Worker('/worker.js?exec=/wasm_exec.js&wasm=/d2web.wasm') });
    let revision = 0;
    window.compile = (source, override = {}) => window.client.compile({ revision: ++revision, files: { 'main.d2': source }, entry: 'main.d2', render: { ...render, ...override }, ...override.request });
  }, defaultRender);
}

// Fraction of pixels whose channel differs by more than 25 (alpha composited on white) between two base64 PNGs.
export const diff = (page, a, b, exclude) => page.evaluate(async ({ a, b, exclude }) => {
  const read = async b64 => { const i = new Image(); i.src = 'data:image/png;base64,' + b64; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#fff'; x.fillRect(0, 0, i.width, i.height); x.drawImage(i, 0, 0); return { w: i.width, h: i.height, d: x.getImageData(0, 0, i.width, i.height).data }; };
  const [x, y] = [await read(a), await read(b)];
  if (x.w !== y.w || x.h !== y.h) return { sizeMismatch: [x.w, x.h, y.w, y.h] };
  let n = 0;
  for (let i = 0; i < x.d.length; i += 4) {
    const [px, py] = [(i / 4) % x.w, Math.floor(i / 4 / x.w)];
    if (exclude && px >= exclude.x && px < exclude.x + exclude.w && py >= exclude.y && py < exclude.y + exclude.h) continue;
    if ([0, 1, 2].some(k => Math.abs(x.d[i + k] - y.d[i + k]) > 25)) n++;
  }
  return { ratio: n / (x.w * x.h) };
}, { a, b, exclude });

export const shot = async (page, selector) => (await page.locator(selector).screenshot({ animations: 'disabled' })).toString('base64');
