import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open } from '../../packages/d2web/tests/browser/harness.mjs';
import { root } from '../examples.mjs';
import { catalog } from './catalog.mjs';
import { boardTarget } from './compile.mjs';
import { writeReport } from './report.mjs';

// Feature map step 3: every catalog entry compiled in the browser worker, mounted with the shipping mount API, and compared with D2's own
// native SVG for the same options. Records a status per entry; it does not fail on a difference (baseline.json guards regressions in step 5).
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
  let different = 0, ink = 0;
  for (let i = 0; i < x.d.length; i += 4) {
    const bad = [0, 1, 2].some(k => Math.abs(x.d[i + k] - y.d[i + k]) > 25);
    const inked = [x.d, y.d].some(d => [0, 1, 2].some(k => d[i + k] < 230));
    if (bad) different++;
    if (inked) ink++;
  }
  return { ratio: different / (x.w * x.h), inkRatio: ink ? different / ink : 0 };
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
  const only = process.env.FEATURES_ONLY;
  const results = [];
  for (const entry of catalog.filter(e => !only || e.id.includes(only))) {
    const entryRow = { id: entry.id };
    results.push(entryRow);
    try {
      const request = { revision: 1, files: { 'main.d2': entry.source, ...entry.files }, entry: 'main.d2', render: { themeId: 0, sketch: false, pad: 0, scale: 1, center: false, ...entry.render }, boards: entry.boards ?? [''], ...(entry.layout ? { layout: entry.layout } : {}) };
      const mounted = await page.evaluate(async request => {
        const result = await client.compile(request);
        if (result.error) return { error: `${result.error.code}: ${result.error.message}` };
        const host = document.getElementById('scene');
        host.replaceChildren();
        window.currentMount = d2web.mount(host);
        window.currentResult = result;
        return { boards: result.boards.map(b => b.path) };
      }, request);
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
          else { row.ratio = Number(d.ratio.toFixed(4)); row.inkRatio = Number(d.inkRatio.toFixed(3)); row.status = d.ratio <= THRESHOLD && d.inkRatio <= INK_THRESHOLD ? 'ok' : 'differs'; }
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
  const regressed = Object.keys(baseline).filter(id => baseline[id] === 'ok' && status[id] !== 'ok');
  const improved = Object.keys(status).filter(id => status[id] === 'ok' && baseline[id] !== 'ok');
  if (improved.length) console.log('improved since baseline (rerun with UPDATE_BASELINE=1):', improved.join(', '));
  expect(regressed, 'cases that were ok in tests/features/baseline.json').toEqual([]);
});
