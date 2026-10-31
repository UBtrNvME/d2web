import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../../tests/examples.mjs';
import { fontFamily, paintScene } from '../../tests/scene-paint.mjs';

// Whole-image pass: paint each root board from the scene dump (every primitive, paint, clip, mask, filter) and compare
// the Chromium raster with D2's native SVG raster. Ratios are recorded per case, not tuned or filtered.
const output = join(root, 'artifacts/research-census');

test('research: corpus scene paint vs native SVG raster', async ({ page }) => {
  test.setTimeout(900_000);
  mkdirSync(join(output, 'paint'), { recursive: true });
  await page.route('https://fonts.test/**', route => route.fulfill({ body: readFileSync(join(output, 'fonts', new URL(route.request().url()).pathname.slice(1))), contentType: 'font/ttf' }));
  const results = {};
  for (const file of readdirSync(join(output, 'export')).sort()) {
    const name = file.slice(0, -5);
    const data = JSON.parse(readFileSync(join(output, 'export', file), 'utf8'));
    const entry = results[name] = {};
    let painted;
    try { painted = paintScene(data.scene); } catch (error) { entry.paintError = error.message; continue; }
    entry.animated = painted.animated;
    // Images differ for reasons outside painting: native SVG links remote/local files while the scene embeds or substitutes assets.
    entry.images = JSON.stringify(data.scene).includes('"$":"Image"');
    writeFileSync(join(output, 'paint', name + '.svg'), painted.svg);
    await page.setContent(`<!doctype html><body style="margin:0;background:#fff">
      <div id="native" style="position:absolute;left:0;top:0">${data.svg}</div>
      <div id="scene" style="position:absolute;left:0;top:0;visibility:hidden">${painted.svg}</div></body>`);
    const diff = await page.evaluate(async ({ fonts }) => {
      for (const [id, fileName] of Object.entries(fonts)) {
        const face = new FontFace(id.replace(/\W/g, '-').replace(/^/, 'scene-'), `url(https://fonts.test/${fileName})`);
        document.fonts.add(face);
        await face.load();
      }
      await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.decode().catch(() => {})));
      return null;
    }, { fonts: data.fonts });
    void diff;
    const shot = async id => {
      await page.evaluate(id => { for (const el of document.querySelectorAll('#native,#scene')) el.style.visibility = el.id === id ? 'visible' : 'hidden'; }, id);
      return (await page.locator('#' + id).screenshot({ animations: 'disabled' })).toString('base64');
    };
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
        context.drawImage(image, 0, 0);
        return { width: image.width, height: image.height, pixels: context.getImageData(0, 0, image.width, image.height).data };
      };
      const [a, b] = [await load(native), await load(scene)];
      if (a.width !== b.width || a.height !== b.height) return { sizeMismatch: [a.width, a.height, b.width, b.height] };
      let different = 0;
      for (let i = 0; i < a.pixels.length; i += 4) {
        // Alpha-composite onto white so transparent areas compare as the page shows them.
        const over = (p, o) => { const al = p[i + 3] / 255; return [0, 1, 2].map(k => p[i + k] * al + 255 * (1 - al)); };
        const [x, y] = [over(a.pixels), over(b.pixels)];
        if (Math.max(Math.abs(x[0] - y[0]), Math.abs(x[1] - y[1]), Math.abs(x[2] - y[2])) > 25) different++;
      }
      return { width: a.width, height: a.height, ratio: different / (a.width * a.height) };
    }, { native, scene }));
  }
  writeFileSync(join(output, 'paint.json'), JSON.stringify(results, null, 1));
  const cases = Object.entries(results);
  const compared = cases.filter(([, r]) => r.ratio !== undefined);
  const bucket = (limit, list = compared) => list.filter(([, r]) => r.ratio <= limit).length;
  const plain = compared.filter(([, r]) => !r.images && !r.animated);
  const summary = { cases: cases.length, compared: compared.length, paintErrors: cases.filter(([, r]) => r.paintError).map(([k, r]) => [k, r.paintError]), sizeMismatch: cases.filter(([, r]) => r.sizeMismatch).map(([k]) => k), animated: cases.filter(([, r]) => r.animated).length, atMost0_1pct: bucket(0.001), atMost1pct: bucket(0.01), atMost5pct: bucket(0.05), noImageNoAnimation: { cases: plain.length, atMost0_1pct: bucket(0.001, plain), atMost1pct: bucket(0.01, plain), atMost5pct: bucket(0.05, plain), worst: plain.sort((x, y) => y[1].ratio - x[1].ratio).slice(0, 10).map(([k, r]) => [k, +r.ratio.toFixed(4)]) }, withImages: compared.filter(([, r]) => r.images).length, worst: compared.sort((x, y) => y[1].ratio - x[1].ratio).slice(0, 12).map(([k, r]) => [k, +r.ratio.toFixed(4)]) };
  writeFileSync(join(output, 'paint-summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  expect(summary.paintErrors, 'painter handles every primitive and paint kind in the corpus').toEqual([]);
});
