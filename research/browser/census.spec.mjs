import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../../tests/examples.mjs';

// Corpus text pass: repaint every root-board scene text run as SVG <text> with the scene's own fonts and compare each
// run's box with the same text inside D2's native SVG. Measurements are recorded per run, not tuned or filtered.
const output = join(root, 'artifacts/research-census');

test('research: corpus scene text runs vs native SVG', async ({ page }) => {
  test.setTimeout(600_000);
  await page.route('https://fonts.test/**', route => route.fulfill({ body: readFileSync(join(output, 'fonts', new URL(route.request().url()).pathname.slice(1))), contentType: 'font/ttf' }));
  const results = {};
  for (const file of readdirSync(join(output, 'export')).sort()) {
    const data = JSON.parse(readFileSync(join(output, 'export', file), 'utf8'));
    data.runs ??= [];
    const { X, Y, Width, Height } = data.viewBox;
    const families = Object.fromEntries(Object.keys(data.fonts).map(id => [id, 'scene-' + id.replace(/\W/g, '-')]));
    const texts = data.runs.map((run, i) => `<text data-i="${i}" x="${run.x}" y="${run.y}" font-family="${families[run.asset]}" text-anchor="${['start', 'middle', 'end'][run.anchor]}" font-size="${run.size}" fill="${run.fill}" xml:space="preserve">${run.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`).join('');
    await page.setContent(`<!doctype html><body style="margin:0">
      <div id="native" style="position:absolute;left:0;top:0">${data.svg}</div>
      <div id="scene" style="position:absolute;left:0;top:${Height + 20}px"><svg xmlns="http://www.w3.org/2000/svg" width="${Width}" height="${Height}" viewBox="${X} ${Y} ${Width} ${Height}">${texts}</svg></div></body>`);
    results[file.slice(0, -5)] = await page.evaluate(async ({ fonts, families, runs }) => {
      for (const [id, name] of Object.entries(fonts)) {
        const face = new FontFace(families[id], `url(https://fonts.test/${name})`);
        document.fonts.add(face);
        await face.load();
      }
      await document.fonts.ready;
      const nativeRoot = document.querySelector('#native');
      const walker = document.createTreeWalker(nativeRoot, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement.closest('style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
      const nodes = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.data.trim()) nodes.push(n);
      const sceneTop = document.querySelector('#scene').getBoundingClientRect().top;
      const rows = [];
      let index = 0, from = 0;
      runs.forEach((run, i) => {
        if (!run.text) { rows.push({ text: '', scaled: run.scaled, matched: false, empty: true }); return; }
        let found = null;
        for (let k = index; k < nodes.length && !found; k++) {
          const at = nodes[k].data.indexOf(run.text, k === index ? from : 0);
          if (at >= 0) { found = { k, at }; index = k; from = at + run.text.length; }
        }
        const s = document.querySelector(`#scene text[data-i="${i}"]`).getBoundingClientRect();
        if (!found) { rows.push({ text: run.text, scaled: run.scaled, matched: false }); return; }
        const range = document.createRange();
        range.setStart(nodes[found.k], found.at);
        range.setEnd(nodes[found.k], found.at + run.text.length);
        const r = range.getBoundingClientRect();
        rows.push({ text: run.text, scaled: run.scaled, matched: true, html: !!nodes[found.k].parentElement.closest('foreignObject'), advance: run.advance, sceneWidth: s.width, nativeWidth: r.width, dx: r.left - s.left, dwidth: r.width - s.width, dtop: r.top - (s.top - sceneTop) });
      });
      return { runs: runs.length, rows, fontsLoaded: Object.keys(fonts).every(id => document.fonts.check(`16px ${families[id]}`)) };
    }, { fonts: data.fonts, families, runs: data.runs });
  }
  writeFileSync(join(output, 'browser.json'), JSON.stringify(results, null, 1));
  const rows = Object.values(results).flatMap(r => r.rows);
  const matched = rows.filter(r => r.matched && !r.scaled);
  const worst = key => matched.reduce((m, r) => Math.max(m, Math.abs(r[key])), 0);
  const within = limit => matched.filter(r => Math.abs(r.dx) < limit && Math.abs(r.dwidth) < limit && Math.abs(r.dtop) < limit).length;
  const summary = { cases: Object.keys(results).length, runs: rows.length, scaled: rows.filter(r => r.scaled).length, empty: rows.filter(r => r.empty).length, unmatched: rows.filter(r => !r.matched && !r.empty).length, sceneWithin05OfAdvance: matched.filter(r => r.advance > 0 && Math.abs(r.sceneWidth - r.advance) < 0.5).length, nativeWithin05OfAdvance: matched.filter(r => r.advance > 0 && Math.abs(r.nativeWidth - r.advance) < 0.5).length, matchedWithAdvance: matched.filter(r => r.advance > 0).length, matchedHtml: matched.filter(r => r.html).length, matchedSvg: matched.filter(r => !r.html).length, within05: within(0.5), within1: within(1), within2: within(2), maxDx: worst('dx'), maxDwidth: worst('dwidth'), maxDtop: worst('dtop'), casesFontsNotLoaded: Object.entries(results).filter(([, r]) => !r.fontsLoaded).map(([k]) => k) };
  writeFileSync(join(output, 'browser-summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  expect(summary.casesFontsNotLoaded, 'scene fonts load').toEqual([]);
  expect(summary.scaled, 'runs carry only translation').toBe(0);
  // Observation tripwire from the first measurement (not a parity threshold): scene repaint reproduces D2's own advances.
  expect(summary.sceneWithin05OfAdvance / summary.matchedWithAdvance).toBeGreaterThan(0.95);
});
