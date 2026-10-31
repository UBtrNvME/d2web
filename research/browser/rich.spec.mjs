import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../../tests/examples.mjs';

// R2 browser pass: repaint the scene's text runs as SVG <text> with the scene's own font bytes and compare
// each run's position with the same text inside D2's native SVG. Measurements are recorded, not tuned.
const cases = ['markdown', 'code', 'unicode'];

for (const name of cases) {
  test(`research: scene text runs vs native SVG for ${name}`, async ({ page }) => {
    const output = join(root, 'artifacts/research-rich');
    const { export: data } = JSON.parse(readFileSync(join(output, `${name}.export.json`), 'utf8'));
    const { X, Y, Width, Height } = data.viewBox;
    const families = Object.fromEntries(Object.keys(data.fonts).map(id => [id, 'scene-' + id.replace(/\W/g, '-')]));
    const texts = data.runs.map(run => `<text data-id="${run.id}" x="${run.x}" y="${run.y}" font-family="${[run.asset, ...(run.fallbacks ?? [])].map(id => families[id]).join(',')}" text-anchor="${['start', 'middle', 'end'][run.anchor]}" font-size="${run.size}" fill="${run.fill}" xml:space="preserve">${run.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`).join('');
    await page.route('https://fonts.test/**', route => route.fulfill({ body: readFileSync(join(output, 'fonts', new URL(route.request().url()).pathname.slice(1))), contentType: 'font/ttf' }));
    await page.setContent(`<!doctype html><body style="margin:0">
      <div id="native" style="position:absolute;left:0;top:0">${data.svg}</div>
      <div id="scene" style="position:absolute;left:0;top:${Height + 20}px"><svg xmlns="http://www.w3.org/2000/svg" width="${Width}" height="${Height}" viewBox="${X} ${Y} ${Width} ${Height}">${texts}</svg></div></body>`);
    const result = await page.evaluate(async ({ fonts, families, runs }) => {
      for (const [id, b64] of Object.entries(fonts)) {
        const face = new FontFace(families[id], `url(https://fonts.test/${b64})`);
        document.fonts.add(face);
        await face.load();
      }
      await document.fonts.ready;
      const nativeRoot = document.querySelector('#native');
      const walker = document.createTreeWalker(nativeRoot, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement.closest('style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
      const nodes = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.data.trim()) nodes.push(n);
      const rows = [];
      let index = 0, from = 0;
      for (const run of runs) {
        let found = null;
        for (let i = index; i < nodes.length && !found; i++) {
          const at = nodes[i].data.indexOf(run.text, i === index ? from : 0);
          if (at >= 0) { found = { i, at }; index = i; from = at + run.text.length; }
        }
        const el = document.querySelector(`#scene text[data-id="${run.id}"]`);
        const s = el.getBoundingClientRect();
        let n = null;
        if (found) {
          const range = document.createRange();
          range.setStart(nodes[found.i], found.at);
          range.setEnd(nodes[found.i], found.at + run.text.length);
          const r = range.getBoundingClientRect();
          n = { left: r.left, top: r.top, width: r.width, height: r.height };
        }
        const sceneTop = s.top - (document.querySelector('#scene').getBoundingClientRect().top);
        rows.push({ id: run.id, text: run.text, sceneAdvance: run.advance, scene: { left: s.left, top: sceneTop, width: s.width, height: s.height }, native: n });
      }
      const sceneFamilies = [...new Set(runs.map(r => families[r.asset]))];
      return { rows, loaded: sceneFamilies.every(f => document.fonts.check(`16px ${f}`)), nativeTextNodes: nodes.length, nativeInForeignObject: !!nativeRoot.querySelector('foreignObject') };
    }, { fonts: data.fonts, families, runs: data.runs });
    const matched = result.rows.filter(r => r.native);
    const deltas = matched.map(r => ({ id: r.id, text: r.text, sceneAdvance: r.sceneAdvance, sceneWidth: r.scene.width, nativeWidth: r.native.width, dx: r.native.left - r.scene.left, dwidth: r.native.width - r.scene.width, dtop: r.native.top - r.scene.top }));
    const max = key => Math.max(...deltas.map(d => Math.abs(d[key])));
    const summary = { name, runs: data.runs.length, matched: matched.length, scaledRuns: data.runs.filter(r => r.scaled).length, nativeInForeignObject: result.nativeInForeignObject, fontsLoaded: result.loaded, maxAbsDx: max('dx'), maxAbsDwidth: max('dwidth'), dtopRange: [Math.min(...deltas.map(d => d.dtop)), Math.max(...deltas.map(d => d.dtop))], deltas };
    writeFileSync(join(output, `${name}.browser.json`), JSON.stringify(summary, null, 2) + '\n');
    await page.screenshot({ path: join(output, `${name}.png`), fullPage: true });
    expect(result.loaded, 'scene fonts load').toBe(true);
    expect(data.runs.filter(r => r.scaled), 'runs carry only translation').toHaveLength(0);
    expect(matched.length, 'every scene run found in native SVG text').toBe(data.runs.length);
    // Observation ceilings from the first measurement (not parity thresholds): sub-half-pixel agreement in this Chromium.
    if (name === 'unicode') return; // fallback glyph comparison is recorded, not yet asserted: it depends on host fonts
    expect(summary.maxAbsDx).toBeLessThan(0.5);
    expect(summary.maxAbsDwidth).toBeLessThan(0.5);
    expect(Math.max(...summary.dtopRange.map(Math.abs))).toBeLessThan(0.5);
  });
}
