import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { goEnv, goRun, root } from '../../../../tests/examples.mjs';
import { patches } from '../../../../tests/upstream-patches.mjs';
import { open } from './harness.mjs';

// Spec 0007, colour emoji: what pristine D2 does with consumer-listed emoji fonts, pinned as measured behaviour (not a promise that it is good).
// Findings: D2's scene builder paints outline and COLR glyphs only, and prepares D2's own bundled Noto Color Emoji through a trusted path that the
// wasm build leaves empty (d2fonts/noto_color_emoji_wasm.go). A listed font therefore does not make emoji work:
//   - no emoji font: emoji get the primary font's placeholder glyph with a 12.91 px advance at 16 px (the browser paints its own emoji, wider);
//   - D2's own COLRv1 Noto Color Emoji (5 MB): the compile fails ("unsupported COLRv1 paint without an outline fallback");
//   - a bitmap (CBDT) emoji font: accepted, but D2 still uses the placeholder glyph.
const d2Emoji = join(root, 'imports/d2/d2renderers/d2fonts/encoded/NotoColorEmoji-COLRv1-v2.051.ttf.br');
const utils = goRun('go', ['list', '-m', '-f', '{{.Dir}}', 'github.com/go-text/typesetting-utils'], { cwd: join(root, 'packages/d2web-wasm'), env: { ...goEnv, GOFLAGS: '-mod=readonly' } }).trim();
const cbdt = join(utils, 'opentype/bitmap/NotoColorEmoji.ttf');
const emojiPatched = patches().some(p => p.file.endsWith('d2fonts-wasm-supply-bundled-emoji.patch') && p.state === 'applied');
const source = 'x: \u{1F600}\u{1F680} launch';

async function compileWith(page, bytes, asEmoji = false) {
  await page.route('https://host.test/fonts/**', route => route.fulfill({ body: bytes ?? Buffer.alloc(0), contentType: 'font/ttf' }));
  return page.evaluate(async ({ source, listed, asEmoji }) => {
    const client2 = d2web.createClient({ spawn: () => new Worker('/worker.js?exec=/wasm_exec.js&wasm=/d2web.wasm'), ...(listed && asEmoji ? { emoji: { name: 'Emoji', url: '/fonts/emoji.ttf' } } : listed ? { fonts: [{ name: 'Emoji', url: '/fonts/emoji.ttf' }] } : {}) });
    const r = await client2.compile({ revision: 1, files: { 'main.d2': source }, entry: 'main.d2', layout: 'dagre', render: { themeId: 0, sketch: false, pad: 0, scale: 1, center: false } });
    client2.dispose();
    if (r.error) return { error: r.error.message };
    const runs = [];
    const walk = n => { if (n.Primitive?.$ === 'TextRun') runs.push(n.Primitive); (n.Children ?? []).forEach(walk); };
    walk(r.boards[0].scene.Root);
    const run = runs.find(p => p.Text.includes('\u{1F600}'));
    return { warnings: r.diagnostics.map(d => d.message), emojiAdvance: run.Glyphs[0].Advance, emojiAsset: run.Glyphs[0].Asset, fallbacks: run.Fallbacks.length };
  }, { source, listed: bytes !== undefined, asEmoji });
}

test('no emoji font: emoji use the primary font placeholder advance', async ({ page }) => {
  await open(page, { body: '' });
  const out = await compileWith(page, undefined);
  expect(out.error).toBeUndefined();
  expect(out.emojiAsset).toContain('SourceSansPro');
  expect(out.emojiAdvance).toBeCloseTo(12.91, 1);
});

test('a bitmap emoji font is accepted but D2 still uses the placeholder glyph', async ({ page }) => {
  test.skip(!existsSync(cbdt), 'Noto Color Emoji bitmap test font is not in the module cache');
  await open(page, { body: '' });
  const out = await compileWith(page, readFileSync(cbdt));
  expect(out.error).toBeUndefined();
  expect(out.emojiAsset).toContain('SourceSansPro');
  expect(out.fallbacks).toBe(0);
});

test("D2's own COLRv1 emoji font fails the compile with D2's message", async ({ page }) => {
  test.skip(!existsSync(d2Emoji) || emojiPatched, 'pristine-D2 behaviour: needs the checkout\'s emoji font and no bundled-emoji patch');
  test.setTimeout(120_000);
  await open(page, { body: '' });
  const out = await compileWith(page, brotliDecompressSync(readFileSync(d2Emoji)));
  expect(out.error).toMatch(/COLRv1 paint without an outline fallback/);
});

// With docs/upstream/d2fonts-wasm-supply-bundled-emoji.patch applied (and the wasm built with it) the consumer's `emoji` option reaches D2's trusted path.
// Fails on a pristine D2 build, so it only runs when the patch is applied.
test("patched D2: the emoji option gives colour emoji their own glyphs and advance", async ({ page }) => {
  test.skip(!emojiPatched, 'the bundled-emoji patch is not applied to imports/d2');
  test.skip(!existsSync(d2Emoji), 'the D2 checkout is missing its bundled emoji font');
  test.setTimeout(120_000);
  await open(page, { body: '' });
  const out = await compileWith(page, brotliDecompressSync(readFileSync(d2Emoji)), true);
  expect(out.error).toBeUndefined();
  expect(out.emojiAsset).not.toContain('SourceSansPro');
  expect(out.emojiAdvance).not.toBeCloseTo(12.91, 1);
});

// Paint check: the browser draws the emoji run in colour with the width D2 laid out (scene advance sum), so layout and paint agree.
test("patched D2: painted colour emoji are coloured and as wide as D2 laid them out", async ({ page, browserName }) => {
  test.skip(!emojiPatched, 'the bundled-emoji patch is not applied to imports/d2');
  test.skip(!existsSync(d2Emoji), 'the D2 checkout is missing its bundled emoji font');
  test.setTimeout(120_000);
  await open(page, { body: '<div id="a" style="position:absolute;left:0;top:0"></div>' });
  await page.route('https://host.test/fonts/**', route => route.fulfill({ body: brotliDecompressSync(readFileSync(d2Emoji)), contentType: 'font/ttf' }));
  const out = await page.evaluate(async source => {
    const c = d2web.createClient({ spawn: () => new Worker('/worker.js?exec=/wasm_exec.js&wasm=/d2web.wasm'), emoji: { name: 'Emoji', url: '/fonts/emoji.ttf' } });
    const view = d2web.mount(document.getElementById('a'));
    const r = await c.compile({ revision: 1, files: { 'main.d2': source }, entry: 'main.d2', layout: 'dagre', render: { themeId: 0, sketch: false, pad: 0, scale: 1, center: false } });
    c.dispose();
    if (r.error) return { error: r.error.message };
    await view.update(r);
    await document.fonts.ready;
    const runs = [];
    const walk = n => { if (n.Primitive?.$ === 'TextRun') runs.push(n.Primitive); (n.Children ?? []).forEach(walk); };
    walk(r.boards[0].scene.Root);
    const run = runs.find(p => p.Text.includes('\u{1F600}'));
    const el = [...document.getElementById('a').shadowRoot.querySelectorAll('[data-k="text"]')].find(e => e.textContent.includes('\u{1F600}'));
    const box = el.getBoundingClientRect();
    return { sceneWidth: run.Glyphs.reduce((w, g) => w + g.Advance, 0), browserWidth: box.width, box: { x: box.x, y: box.y, width: box.width, height: box.height } };
  }, source);
  expect(out.error).toBeUndefined();
  expect(Math.abs(out.browserWidth - out.sceneWidth), `scene ${out.sceneWidth}, browser ${out.browserWidth}`).toBeLessThan(0.5);
  const png = await page.screenshot({ clip: out.box, animations: 'disabled' });
  const colourful = await page.evaluate(async b64 => {
    const i = new Image(); i.src = 'data:image/png;base64,' + b64; await i.decode();
    const cv = document.createElement('canvas'); cv.width = i.width; cv.height = i.height;
    const g = cv.getContext('2d'); g.drawImage(i, 0, 0);
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let k = 0; k < d.length; k += 4) if (Math.max(d[k], d[k + 1], d[k + 2]) - Math.min(d[k], d[k + 1], d[k + 2]) > 60) n++;
    return n;
  }, png.toString('base64'));
  // WebKit does not paint COLRv1 web fonts (measured: the run keeps D2's width but draws no colour), so there it is pinned as a limitation.
  if (browserName === 'webkit') expect(colourful, 'WebKit: no colour from a COLRv1 font').toBe(0);
  else expect(colourful, 'pixels with real colour in the emoji run').toBeGreaterThan(20);
});
