import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { goEnv, goRun, root, typesettingUtilsDir } from '../../../../tests/examples.mjs';
import { open } from './harness.mjs';

// Spec 0007 section 3: Hebrew, CJK, emoji, long right-to-left and mixed-direction text through consumer-listed fonts. The font bytes are not copied into
// this repository (their licences are not shipped with them); they are read from the pinned go-text/typesetting-utils test data (go.sum), which
// holds DejaVu Sans (Hebrew, Arabic, emoji outlines) and M+ 1p (kana and kanji).
const utils = typesettingUtilsDir();
const fonts = { 'DejaVuSans.ttf': readFileSync(join(utils, 'opentype/common/DejaVuSans.ttf')), 'mplus-1p-regular.ttf': readFileSync(join(utils, 'opentype/common/mplus-1p-regular.ttf')) };
const host = '<div id="a" style="position:absolute;left:0;top:0"></div>';

const cases = {
  hebrew: 'x: שלום עולם',
  'long hebrew': 'x: זהו משפט ארוך בעברית שנועד לבדוק את הרוחב',
  'long arabic': 'x: هذه جملة طويلة باللغة العربية لاختبار العرض',
  'mixed direction': 'x: abc שלום def 123 عربي end',
  japanese: 'x: あいう 漢字 かな',
  emoji: 'x: 😀 smile',
  'bold hebrew': 'x: שלום {style.bold: true}',
  'italic hebrew': 'x: שלום {style.italic: true}',
};

test('scripts through consumer fonts: no glyph left out, browser width equals the scene advance sum', async ({ page }) => {
  await open(page, { body: host });
  await page.route('https://host.test/fonts/**', route => route.fulfill({ body: fonts[new URL(route.request().url()).pathname.split('/').pop()], contentType: 'font/ttf' }));
  const rows = await page.evaluate(async cases => {
    const client2 = d2web.createClient({ spawn: () => new Worker('/worker.js?exec=/wasm_exec.js&wasm=/d2web.wasm'),
      fonts: [{ name: 'DejaVu Sans', url: '/fonts/DejaVuSans.ttf' }, { name: 'M+ 1p', url: '/fonts/mplus-1p-regular.ttf' }] });
    const view = d2web.mount(document.getElementById('a'));
    const out = [];
    let revision = 0;
    for (const [name, source] of Object.entries(cases)) {
      const r = await client2.compile({ revision: ++revision, files: { 'main.d2': source }, entry: 'main.d2', layout: 'dagre', render: { themeId: 0, sketch: false, pad: 0, scale: 1, center: false } });
      if (r.error) { out.push({ name, error: r.error.message }); continue; }
      await view.update(r);
      await document.fonts.ready;
      const runs = [];
      const walk = n => { if (n.Primitive?.$ === 'TextRun') runs.push(n.Primitive); (n.Children ?? []).forEach(walk); };
      walk(r.boards[0].scene.Root);
      const run = runs.find(p => /[^\x00-\x7f]/.test(p.Text));
      const el = [...document.getElementById('a').shadowRoot.querySelectorAll('[data-k="text"]')].find(e => /[^\x00-\x7f]/.test(e.textContent));
      out.push({
        name, warnings: r.diagnostics.map(d => d.message), fallbacks: run.Fallbacks.length, emptyGlyphs: run.Glyphs.filter(g => g.ID === 0).length,
        sceneWidth: run.Glyphs.reduce((w, g) => w + g.Advance, 0), browserWidth: el.getBoundingClientRect().width, weight: getComputedStyle(el).fontWeight, style: getComputedStyle(el).fontStyle, sceneStyle: `${run.Font.Weight} ${run.Font.Style}`,
      });
    }
    client2.dispose();
    return out;
  }, cases);
  console.log(rows.map(r => `${r.name}: scene ${r.sceneWidth?.toFixed(2)} browser ${r.browserWidth?.toFixed(2)} fallbacks ${r.fallbacks} notdef ${r.emptyGlyphs} weight ${r.weight} ${r.style} (scene font ${r.sceneStyle}) ${r.error ?? ''}`).join('\n'));
  for (const r of rows) {
    expect(r.error, r.name).toBeUndefined();
    expect(r.warnings, `${r.name}: every character is covered by a listed font`).toEqual([]);
    expect(r.fallbacks, `${r.name}: uses a listed font`).toBeGreaterThan(0);
    expect(r.emptyGlyphs, `${r.name}: no .notdef glyph`).toBe(0);
    expect(Math.abs(r.browserWidth - r.sceneWidth), `${r.name}: scene ${r.sceneWidth}, browser ${r.browserWidth}`).toBeLessThan(0.5);
  }
});
