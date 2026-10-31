import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { goEnv, goRun, root } from '../../../../tests/examples.mjs';
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
const source = 'x: \u{1F600}\u{1F680} launch';

async function compileWith(page, bytes) {
  await page.route('https://host.test/fonts/**', route => route.fulfill({ body: bytes ?? Buffer.alloc(0), contentType: 'font/ttf' }));
  return page.evaluate(async ({ source, listed }) => {
    const client2 = d2web.createClient({ spawn: () => new Worker('/worker.js?exec=/wasm_exec.js&wasm=/d2web.wasm'), fonts: listed ? [{ name: 'Emoji', url: '/fonts/emoji.ttf' }] : undefined });
    const r = await client2.compile({ revision: 1, files: { 'main.d2': source }, entry: 'main.d2', layout: 'dagre', render: { themeId: 0, sketch: false, pad: 0, scale: 1, center: false } });
    client2.dispose();
    if (r.error) return { error: r.error.message };
    const runs = [];
    const walk = n => { if (n.Primitive?.$ === 'TextRun') runs.push(n.Primitive); (n.Children ?? []).forEach(walk); };
    walk(r.boards[0].scene.Root);
    const run = runs.find(p => p.Text.includes('\u{1F600}'));
    return { warnings: r.diagnostics.map(d => d.message), emojiAdvance: run.Glyphs[0].Advance, emojiAsset: run.Glyphs[0].Asset, fallbacks: run.Fallbacks.length };
  }, { source, listed: bytes !== undefined });
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
  test.skip(!existsSync(d2Emoji), 'the D2 checkout is missing its bundled emoji font');
  test.setTimeout(120_000);
  await open(page, { body: '' });
  const out = await compileWith(page, brotliDecompressSync(readFileSync(d2Emoji)));
  expect(out.error).toMatch(/COLRv1 paint without an outline fallback/);
});
