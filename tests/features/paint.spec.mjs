import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open } from '../../packages/d2web/tests/browser/harness.mjs';
import { goEnv, goRun, root, typesettingUtilsDir } from '../examples.mjs';
import { catalog } from './catalog.mjs';
import { boardTarget } from './compile.mjs';
import { writeReport } from './report.mjs';

// Feature map step 3: every catalog entry compiled in the browser worker, mounted with the shipping mount API, and compared with D2's own
// native SVG for the same options. Records a status per entry; it does not fail on a difference (baseline.json guards regressions in step 5).
// Consumer fonts for the Unicode family, read from the pinned go-text/typesetting-utils test data (not copied: their licences are not shipped with them).
const utils = typesettingUtilsDir();
const fontFiles = { dejavu: ['DejaVu Sans', 'DejaVuSans.ttf'], mplus: ['M+ 1p', 'mplus-1p-regular.ttf'] };
const output = join(root, 'artifacts/feature-map');
const shots = join(output, 'shots');
mkdirSync(shots, { recursive: true });
const browser = process.env.D2WEB_BROWSER ?? 'chromium';
const suffix = browser === 'chromium' ? '' : `.${browser}`;
const THRESHOLD = 0.05; // ADR 0002 / 0007 fidelity bar, over the whole image
const INK_THRESHOLD = 0.25; // proposed (not an ADR): at most a quarter of the inked pixels may differ
// Whole-image ratios hide a missing label on a small board, so the second metric divides by the pixels that carry ink in either image.
const diff = (page, a, b) => page.evaluate(async ({ a, b }) => {
  const read = async b64 => { const i = new Image(); i.src = 'data:image/png;base64,' + b64; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#fff'; x.fillRect(0, 0, i.width, i.height); x.drawImage(i, 0, 0); return { w: i.width, h: i.height, d: x.getImageData(0, 0, i.width, i.height).data }; };
  const [x, y] = [await read(a), await read(b)];
  if (x.w !== y.w || x.h !== y.h) return { sizeMismatch: [x.w, x.h, y.w, y.h] };
  let different = 0, ink = 0, shifted = 0;
  // A pixel that differs only because glyph or curve edges sit up to one pixel apart still has a matching pixel next to it in the other image.
  const near = (p, q, px, py) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const ox = px + dx, oy = py + dy; if (ox < 0 || oy < 0 || ox >= x.w || oy >= x.h) continue;
    const j = (oy * x.w + ox) * 4; if ([0, 1, 2].every(k => Math.abs(p[k] - q[j + k]) <= 25)) return true; } return false; };
  for (let i = 0; i < x.d.length; i += 4) {
    const bad = [0, 1, 2].some(k => Math.abs(x.d[i + k] - y.d[i + k]) > 25);
    const inked = [x.d, y.d].some(d => [0, 1, 2].some(k => d[i + k] < 230));
    if (bad) { different++; const px = (i / 4) % x.w, py = Math.floor(i / 4 / x.w); if (!near(x.d.subarray(i, i + 3), y.d, px, py) && !near(y.d.subarray(i, i + 3), x.d, px, py)) shifted++; }
    if (inked) ink++;
  }
  return { ratio: different / (x.w * x.h), inkRatio: ink ? different / ink : 0, shiftRatio: shifted / (x.w * x.h), shiftInkRatio: ink ? shifted / ink : 0 };
}, { a, b });

// Native D2 with the same settings the product asks for. An empty target renders only root; a dotted path renders only that board.
function native(entry, board) {
  const dir = mkdtempSync(join(tmpdir(), 'feature-'));
  const r = { themeId: 0, sketch: false, pad: 0, scale: 1, center: false, ...entry.render };
  // The CLI has no flag for theme overrides; its own d2-config block in the source is the native equivalent of the request field.
  const config = r.themeOverrides ? `vars: {d2-config: {theme-overrides: {${Object.entries(r.themeOverrides).map(([k, v]) => `${k}: "${v}"`).join('; ')}}}}\n` : '';
  writeFileSync(join(dir, 'main.d2'), config + entry.source);
  for (const [name, text] of Object.entries(entry.files ?? {})) writeFileSync(join(dir, name), text);
  const args = [`--layout=${entry.layout ?? 'tala'}`, '--tala-seeds=1', `--theme=${r.themeId}`, '--dark-theme=-1', `--pad=${r.pad}`, `--scale=${r.scale}`, `--sketch=${r.sketch}`,
    `--center=${r.center}`, '--bundle=true', '--force-appendix=false', '--animate-interval=0', `--target=${boardTarget(board)}`, '--timeout=60', join(dir, 'main.d2'), join(dir, 'out.svg')];
  try { execFileSync('d2', args, { encoding: 'utf8', stdio: 'pipe', timeout: 90_000 }); } catch (error) { return { error: String(error.stderr || error.message).split('\n').find(l => l.includes('err') || l.includes('failed')) ?? 'native d2 failed' }; }
  return { svg: readFileSync(join(dir, 'out.svg'), 'utf8') };
}

test('paint every catalog entry and compare with native D2', async ({ page }) => {
  test.setTimeout(30 * 60_000);
  await open(page, { body: '<div id="scene" style="position:absolute;left:0;top:0"></div><div id="native" style="position:absolute;left:0;top:0;visibility:hidden"></div>' });
  await page.route('https://host.test/fonts/**', route => route.fulfill({ body: readFileSync(join(utils, 'opentype/common', new URL(route.request().url()).pathname.split('/').pop())), contentType: 'font/ttf' }));
  await page.evaluate(list => { window.fontClient = d2web.createClient({ spawn: () => new Worker('/worker.js?exec=/wasm_exec.js&wasm=/d2web.wasm'), fonts: list.map(([name, file]) => ({ name, url: `/fonts/${file}` })) }); }, Object.values(fontFiles));
  const only = process.env.FEATURES_ONLY;
  const results = [];
  for (const entry of catalog.filter(e => !only || e.id.includes(only))) {
    const entryRow = { id: entry.id };
    results.push(entryRow);
    try {
      const request = { revision: 1, files: { 'main.d2': entry.source, ...entry.files }, entry: 'main.d2', render: { themeId: 0, sketch: false, pad: 0, scale: 1, center: false, ...entry.render }, boards: entry.boards ?? [''], ...(entry.layout ? { layout: entry.layout } : {}) };
      const mounted = await page.evaluate(async ({ request, withFonts }) => {
        const result = await (withFonts ? fontClient : client).compile(request);
        if (result.error) return { error: `${result.error.code}: ${result.error.message}` };
        const host = document.getElementById('scene');
        host.replaceChildren();
        window.currentMount = d2web.mount(host);
        window.currentResult = result;
        return { boards: result.boards.map(b => b.path) };
      }, { request, withFonts: Boolean(entry.fonts) });
      entryRow.boards = mounted.boards;
      if (mounted.error) { entryRow.status = 'compile-error'; entryRow.detail = mounted.error.slice(0, 200); continue; }
      for (const board of entry.family === 'board' ? mounted.boards : ['']) {
        const row = board ? { id: `${entry.id}#${boardTarget(board)}` } : entryRow;
        if (board) results.push(row);
        try {
          const error = await page.evaluate(async board => {
            try { await window.currentMount.update(window.currentResult, board); }
            catch (error) { return error.message; }
          }, board);
          if (error) { row.status = 'mount-error'; row.detail = error.slice(0, 200); continue; }
          if (entry.fonts) { // native chooses host fonts: check D2's own advances instead (no warning, no .notdef, browser width equals the scene advance sum)
            const out = await page.evaluate(async () => {
              await document.fonts.ready;
              const runs = [];
              const walk = n => { if (n.Primitive?.$ === 'TextRun') runs.push(n.Primitive); (n.Children ?? []).forEach(walk); };
              walk(currentResult.boards[0].scene.Root);
              const els = [...document.getElementById('scene').shadowRoot.querySelectorAll('[data-k="text"]')];
              // D2's advances carry no pair kerning; the browser applies it (natural on the web, ADR 0009). Measure both: the check is on D2's advances
              // (kerning off) and the kerning the browser adds is recorded.
              const rows = runs.map(r => {
                const el = els.find(e => e.textContent.replace(/\s+/g, ' ').trim() === r.Text.replace(/\s+/g, ' ').trim());
                const kerned = el?.getBoundingClientRect().width;
                if (el) { el.style.fontKerning = 'none'; el.style.fontVariantLigatures = 'none'; }
                return { text: r.Text, scene: r.Glyphs.reduce((w, g) => w + g.Advance, 0), notdef: r.Glyphs.filter(g => g.ID === 0).length,
                  browser: el?.getBoundingClientRect().width, kerning: el ? kerned - el.getBoundingClientRect().width : 0 };
              });
              return { warnings: currentResult.diagnostics.map(d => d.message), rows };
            });
            const worst = Math.max(0, ...out.rows.map(r => Math.abs((r.browser ?? Infinity) - r.scene)));
            const bad = out.warnings.length || out.rows.some(r => r.notdef) || worst >= 0.5;
            row.status = bad ? 'differs' : 'scene-checked'; row.worstWidthError = Number(worst.toFixed(3)); row.kerning = Number(Math.min(0, ...out.rows.map(r => r.kerning)).toFixed(2));
            if (bad) row.detail = JSON.stringify(out).slice(0, 300);
            continue;
          }
          const ref = native(entry, board);
          if (ref.skip || ref.error) { row.status = 'no-native'; row.detail = ref.skip ?? ref.error.slice(0, 200); continue; }
          await page.evaluate(svg => { document.getElementById('native').innerHTML = svg; document.querySelector('#native > svg').style.display = 'block'; }, ref.svg);
          await page.evaluate(() => document.fonts.ready);
          // Spec 0005: animated cases are compared at one shared moment (500 ms), native CSS animation against the Web Animations the mount runs.
          await page.evaluate(() => document.getAnimations().forEach(a => { a.pause(); a.currentTime = 500; }));
          const shot = async id => {
            await page.evaluate(id => { for (const el of document.querySelectorAll('#native,#scene')) el.style.visibility = el.id === id ? 'visible' : 'hidden'; }, id);
            return (await page.locator('#' + id).screenshot({ animations: 'disabled' })).toString('base64');
          };
          const [a, b] = [await shot('native'), await shot('scene')];
          const d = await diff(page, a, b);
          if (d.sizeMismatch) { row.status = 'size-mismatch'; row.detail = d.sizeMismatch.join(','); }
          else { row.ratio = Number(d.ratio.toFixed(4)); row.inkRatio = Number(d.inkRatio.toFixed(3)); row.status = d.ratio <= THRESHOLD && d.inkRatio <= INK_THRESHOLD ? 'ok' : 'differs';
            // Strict bars failed but nothing is missing or moved by more than a pixel: the same drawing, edges rasterised slightly apart.
            if (row.status === 'differs' && d.shiftRatio <= THRESHOLD && d.shiftInkRatio <= INK_THRESHOLD) { row.status = 'equivalent'; row.shiftInkRatio = Number(d.shiftInkRatio.toFixed(3)); } }
          if (row.status !== 'ok') {
            const name = row.id.replaceAll('/', '__');
            writeFileSync(join(shots, `${name}.native.png`), Buffer.from(a, 'base64'));
            writeFileSync(join(shots, `${name}.web.png`), Buffer.from(b, 'base64'));
          }
        } catch (error) {
          row.status = 'harness-error'; row.detail = String(error.message).split('\n')[0].slice(0, 200);
        }
      }
    } catch (error) {
      entryRow.status = 'harness-error'; entryRow.detail = String(error.message).split('\n')[0].slice(0, 200);
    } finally {
      await page.evaluate(() => { window.currentMount?.dispose(); window.currentMount = null; window.currentResult = null; document.getElementById('native').replaceChildren(); }).catch(() => {});
    }
  }
  writeFileSync(join(output, only ? 'paint.partial.json' : `paint${suffix}.json`), JSON.stringify(results, null, 1));
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  console.log('feature paint status:', JSON.stringify(counts));
  if (only) return;
  // Regression guard: a case that was ok in baseline.json must stay ok. UPDATE_BASELINE=1 rewrites it from this run (a measurement, not an endorsement).
  const baselinePath = join(root, `tests/features/baseline${suffix}.json`);
  const status = Object.fromEntries(results.map(r => [r.id, r.status]));
  if (process.env.UPDATE_BASELINE || !existsSync(baselinePath)) writeFileSync(baselinePath, JSON.stringify(status, null, 1) + '\n');
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  if (!suffix) writeReport(); // docs/feature-map.md describes Chromium; other browsers keep their own artifact and baseline
  const holds = (was, now) => was === 'ok' ? now === 'ok' : was === 'equivalent' ? now === 'ok' || now === 'equivalent' : was === 'scene-checked' ? now === 'scene-checked' : true;
  const regressed = Object.keys(baseline).filter(id => !holds(baseline[id], status[id]));
  const improved = Object.keys(status).filter(id => status[id] !== baseline[id] && (status[id] === 'ok' || status[id] === 'equivalent' && baseline[id] === 'differs'));
  if (improved.length) console.log('improved since baseline (rerun with UPDATE_BASELINE=1):', improved.join(', '));
  expect(regressed, 'cases that held ok or equivalent in the baseline').toEqual([]);
});
