import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../../tests/examples.mjs';
import { paintScene } from '../../tests/scene-paint.mjs';

// HTML-first pass: paint each root board with real HTML elements where an HTML equivalent is exact enough (boxes, text,
// raster images, link regions) and nested SVG elsewhere. Records the HTML/SVG split with fallback reasons, the raster
// difference from D2's native SVG and from the all-SVG painter, and browser text selection and accessibility output.
const output = join(root, 'artifacts/research-census');
// D2_CSS_MASKS=1 applies clips and masks to HTML groups with CSS instead of painting those subtrees as SVG.
// D2_CSS_MASKS=subtree sizes each masked group to its subtree bounds instead of the document extent.
const cssMasks = process.env.D2_CSS_MASKS === 'subtree' ? 'subtree' : process.env.D2_CSS_MASKS === '1';
const suffix = cssMasks === 'subtree' ? '-css-masks-subtree' : cssMasks ? '-css-masks' : '';
const probes = ['files__chess__tala', 'files__markdown__tala', 'files__label_positions__tala', 'txtar__md-tables__tala'];

test('research: corpus HTML-first paint vs native SVG raster', async ({ page }) => {
  test.setTimeout(900_000);
  await page.route('https://fonts.test/**', route => route.fulfill({ body: readFileSync(join(output, 'fonts', new URL(route.request().url()).pathname.slice(1))), contentType: 'font/ttf' }));
  const svgPaint = JSON.parse(readFileSync(join(output, 'paint.json'), 'utf8'));
  const results = {};
  const totals = {};
  const loadFonts = fonts => page.evaluate(async fonts => {
    for (const [id, name] of Object.entries(fonts)) {
      const face = new FontFace('scene-' + id.replace(/\W/g, '-'), `url(https://fonts.test/${name})`);
      document.fonts.add(face);
      await face.load();
    }
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.decode().catch(() => {})));
  }, fonts);
  const shot = async id => {
    await page.evaluate(id => { for (const el of document.querySelectorAll('#native,#scene')) el.style.visibility = el.id === id ? 'visible' : 'hidden'; }, id);
    return (await page.locator('#' + id).screenshot({ animations: 'disabled' })).toString('base64');
  };

  for (const file of readdirSync(join(output, 'export')).sort()) {
    const name = file.slice(0, -5);
    const data = JSON.parse(readFileSync(join(output, 'export', file), 'utf8'));
    const entry = results[name] = {};
    const painted = paintScene(data.scene, { html: true, cssMasks });
    entry.stats = painted.stats;
    entry.animated = painted.animated;
    entry.images = JSON.stringify(data.scene).includes('"$":"Image"');
    for (const [k, v] of Object.entries(painted.stats)) totals[k] = (totals[k] ?? 0) + v;
    await page.setContent(`<!doctype html><body style="margin:0;background:#fff"><style>*{margin:0}svg{display:block}</style>
      <div id="native" style="position:absolute;left:0;top:0">${data.svg}</div>
      <div id="scene" style="position:absolute;left:0;top:0;visibility:hidden">${painted.html}</div></body>`);
    await loadFonts(data.fonts);
    // HTML text has no baseline attribute: measure where the baseline falls in each element and shift it onto the scene's y.
    await page.evaluate(() => {
      const els = [...document.querySelectorAll('#scene [data-k=text]')];
      const offsets = els.map(el => el.querySelector('[data-baseline]').getBoundingClientRect().top - el.getBoundingClientRect().top);
      els.forEach((el, i) => { el.style.top = `${+el.dataset.y - offsets[i]}px`; });
    });
    const native = await shot('native');
    const scene = await shot('scene');
    Object.assign(entry, await page.evaluate(async ({ native, scene }) => {
      const load = async b64 => {
        const image = new Image();
        image.src = 'data:image/png;base64,' + b64;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.fillStyle = '#fff';
        context.fillRect(0, 0, image.width, image.height);
        context.drawImage(image, 0, 0);
        return { width: image.width, height: image.height, pixels: context.getImageData(0, 0, image.width, image.height).data };
      };
      const [a, b] = [await load(native), await load(scene)];
      if (a.width !== b.width || a.height !== b.height) return { sizeMismatch: [a.width, a.height, b.width, b.height] };
      let different = 0;
      for (let i = 0; i < a.pixels.length; i += 4) if (Math.max(Math.abs(a.pixels[i] - b.pixels[i]), Math.abs(a.pixels[i + 1] - b.pixels[i + 1]), Math.abs(a.pixels[i + 2] - b.pixels[i + 2])) > 25) different++;
      return { width: a.width, height: a.height, ratio: different / (a.width * a.height) };
    }, { native, scene }));
    entry.svgPainterRatio = svgPaint[name]?.ratio;

    if (probes.includes(name)) {
      // Selection and accessibility: the same board painted as HTML and as all-SVG.
      const read = async selector => ({
        selected: await page.evaluate(selector => { const el = document.querySelector(selector); const sel = getSelection(); sel.removeAllRanges(); sel.selectAllChildren(el); return sel.toString().replace(/\s+/g, ' ').trim(); }, selector),
        aria: await page.locator(selector).ariaSnapshot().catch(() => ''),
      });
      entry.html = await read('#scene [data-d2-scene]');
      await page.setContent(`<!doctype html><body><div id="svg">${readFileSync(join(output, 'paint', name + '.svg'), 'utf8')}</div></body>`);
      entry.svg = await read('#svg');
      entry.html = { selectedChars: entry.html.selected.length, ariaChars: entry.html.aria.length, selectedHead: entry.html.selected.slice(0, 80), ariaHead: entry.html.aria.slice(0, 120) };
      entry.svg = { selectedChars: entry.svg.selected.length, ariaChars: entry.svg.aria.length, selectedHead: entry.svg.selected.slice(0, 80), ariaHead: entry.svg.aria.slice(0, 120) };
    }
  }
  writeFileSync(join(output, `html${suffix}.json`), JSON.stringify(results, null, 1));
  const compared = Object.entries(results).filter(([, r]) => r.ratio !== undefined);
  const plain = compared.filter(([, r]) => !r.images && !r.animated);
  const within = (list, limit) => list.filter(([, r]) => r.ratio <= limit).length;
  const worse = plain.filter(([, r]) => r.svgPainterRatio !== undefined && r.ratio - r.svgPainterRatio > 0.01).length;
  const html = Object.entries(totals).filter(([k]) => k.startsWith('html:')).reduce((n, [, v]) => n + v, 0);
  const svg = Object.entries(totals).filter(([k]) => k.startsWith('svg:') && !k.endsWith('nodes')).reduce((n, [, v]) => n + v, 0);
  const summary = {
    cases: Object.keys(results).length, compared: compared.length, plainCases: plain.length,
    plainWithin1pct: within(plain, 0.01), plainWithin5pct: within(plain, 0.05), plainWithin10pct: within(plain, 0.1),
    plainMoreThan1ptWorseThanSvgPainter: worse,
    primitives: { html, svg, htmlShare: +(html / (html + svg)).toFixed(3) }, totals,
    worst: plain.sort((x, y) => y[1].ratio - x[1].ratio).slice(0, 10).map(([k, r]) => [k, +r.ratio.toFixed(4), r.svgPainterRatio === undefined ? null : +r.svgPainterRatio.toFixed(4)]),
    selectionAndAria: Object.fromEntries(probes.map(k => [k, { html: results[k].html, svg: results[k].svg }])),
  };
  writeFileSync(join(output, `html-summary${suffix}.json`), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  expect(summary.compared).toBeGreaterThan(100);
});
