import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from './harness.mjs';

// Spec 0007: consumer-listed fallback fonts, end to end in the browser (compile with fonts, paint with a font stack, report uncovered characters).
// Amiri (OFL, packages/d2web-wasm/tests/fixtures/fonts) covers Arabic; Japanese is deliberately left uncovered.
const amiri = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../d2web-wasm/tests/fixtures/fonts/Amiri-Regular.ttf'));
const sha = createHash('sha256').update(amiri).digest('hex');
const host = '<div id="a" style="position:absolute;left:0;top:0"></div>';
const source = 'a: عربي\nb: あ\nc: plain';

async function ready(page, fonts, log = []) {
  await open(page, { body: host });
  await page.route('https://host.test/fonts/**', route => { log.push(new URL(route.request().url()).pathname); route.fulfill({ body: amiri, contentType: 'font/ttf' }); });
  await page.evaluate(fonts => {
    window.client2 = d2web.createClient({ spawn: () => new Worker('/worker.js?exec=/wasm_exec.js&wasm=/d2web.wasm'), fonts });
  }, fonts);
}
const compile = (page, text = source) => page.evaluate(async text => {
  const r = await client2.compile({ revision: 1, files: { 'main.d2': text }, entry: 'main.d2', layout: 'dagre', render: { themeId: 0, sketch: false, pad: 0, scale: 1, center: false } });
  return { error: r.error?.message, diagnostics: r.diagnostics.map(d => d.message), fonts: Object.keys(r.fonts ?? {}) };
}, text);

test('a listed font paints Arabic with a font stack whose width matches the scene, and an uncovered character is reported', async ({ page }) => {
  const log = [];
  await ready(page, [{ name: 'Amiri', url: '/fonts/Amiri-Regular.ttf', sha256: sha }], log);
  const out = await page.evaluate(async text => {
    const r = await client2.compile({ revision: 1, files: { 'main.d2': text }, entry: 'main.d2', layout: 'dagre', render: { themeId: 0, sketch: false, pad: 0, scale: 1, center: false } });
    const view = d2web.mount(document.getElementById('a'));
    await view.update(r);
    const runs = [];
    const walk = n => { if (n.Primitive?.$ === 'TextRun') runs.push(n.Primitive); (n.Children ?? []).forEach(walk); };
    walk(r.boards[0].scene.Root);
    const arabic = runs.find(p => /[؀-ۿ]/.test(p.Text));
    const sceneWidth = arabic.Glyphs.reduce((w, g) => w + g.Advance, 0);
    const el = [...document.getElementById('a').shadowRoot.querySelectorAll('[data-k="text"]')].find(e => /[؀-ۿ]/.test(e.textContent));
    const family = getComputedStyle(el).fontFamily;
    await document.fonts.ready;
    const width = el.querySelector('[data-baseline]') ? el.getBoundingClientRect().width : NaN;
    return { diagnostics: r.diagnostics.map(d => d.message), fallbacks: arabic.Fallbacks, family, sceneWidth, width, fontsInResult: Object.keys(r.fonts) };
  }, source);
  expect(out.fontsInResult.length).toBeGreaterThanOrEqual(2);
  expect(out.fallbacks.length).toBeGreaterThan(0);
  expect(out.family.split(',').length).toBeGreaterThan(1);
  expect(Math.abs(out.width - out.sceneWidth), `scene ${out.sceneWidth}, browser ${out.width}`).toBeLessThan(0.5);
  expect(out.diagnostics.filter(m => m.includes('U+3042')).length).toBe(1);
  expect(out.diagnostics.some(m => m.includes('U+0639'))).toBe(false);
  expect(log, 'only the listed URL is requested, once').toEqual(['/fonts/Amiri-Regular.ttf']);
});

test('a checksum mismatch fails the compile and registers nothing', async ({ page }) => {
  await ready(page, [{ name: 'Amiri', url: '/fonts/Amiri-Regular.ttf', sha256: 'c'.repeat(64) }]);
  const error = await page.evaluate(() => client2.compile({ revision: 1, files: { 'main.d2': 'a' }, entry: 'main.d2', render: { themeId: 0, sketch: false, pad: 0, scale: 1, center: false } }).then(() => 'resolved', e => `${e.constructor.name}: ${e.message}`));
  expect(error).toMatch(/^FontError: .*checksum mismatch/);
});

test('without listed fonts nothing is fetched and Arabic stays on the primary font', async ({ page }) => {
  const log = [];
  await ready(page, undefined, log);
  const out = await compile(page);
  expect(out.fonts.length).toBe(1);
  expect(out.diagnostics).toEqual([]);
  expect(log).toEqual([]);
});
