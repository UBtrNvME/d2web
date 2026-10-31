import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../../tests/examples.mjs';
import { paintScene } from '../../packages/d2web/src/paint.js';

// R6, painter side: a consumer element replaces one painted node's shape and label in the HTML-first output (chess board,
// node "hans"), at the original size, at double size overflowing, and double size clipped to the original box. Records what
// else on the page changes, hit testing, events, and whether restoring the original markup returns the faithful paint.
// A plain styled element stands in for a shadcn-style card; this does not test a framework or a sizing handshake.
const output = join(root, 'artifacts/research-census');
const data = JSON.parse(readFileSync(join(output, 'export/files__chess__tala.json'), 'utf8'));
const IDS = ['defendants.chesscom', 'hans']; // room to grow and overlapping neighbours; near the board's bottom edge

test('research: consumer content replaces a painted node, then the faithful paint is restored', async ({ page }) => {
  test.setTimeout(120_000);
  let doc = '';
  await page.route('https://host.test/**', route => route.fulfill({ body: doc, contentType: 'text/html' }));
  await page.route('https://fonts.test/**', route => route.fulfill({ body: readFileSync(join(output, 'fonts', new URL(route.request().url()).pathname.slice(1))), contentType: 'font/ttf' }));
  doc = `<!doctype html><body style="margin:0;background:#fff"><style>*{margin:0}</style><div id="host" style="position:absolute;left:0;top:0">${paintScene(data.scene, { html: true, cssMasks: 'subtree' }).html}</div></body>`;
  await page.setViewportSize({ width: 1600, height: 1400 });
  await page.goto('https://host.test/');
  await page.evaluate(async fonts => {
    for (const [id, name] of Object.entries(fonts)) { const face = new FontFace('scene-' + id.replace(/\W/g, '-'), `url(https://fonts.test/${name})`); document.fonts.add(face); await face.load(); }
    await document.fonts.ready;
    await Promise.all([...document.images].map(i => i.decode().catch(() => {})));
  }, data.fonts);
  // HTML text has no baseline attribute: shift each label so its baseline lands on the scene's y (same step as the HTML spec).
  await page.evaluate(() => {
    const els = [...document.querySelectorAll('#host [data-k=text]')];
    const offsets = els.map(el => el.querySelector('[data-baseline]').getBoundingClientRect().top - el.getBoundingClientRect().top);
    els.forEach((el, i) => { el.style.top = `${+el.dataset.y - offsets[i]}px`; });
  });

  const shot = async () => (await page.locator('#host').screenshot({ animations: 'disabled' })).toString('base64');
  // Pixels that differ, counted outside and inside the given rectangle (scene coordinates are offset by the view box origin).
  const diff = (a, b, rect) => page.evaluate(async ({ a, b, rect }) => {
    const read = async b64 => { const i = new Image(); i.src = 'data:image/png;base64,' + b64; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#fff'; x.fillRect(0, 0, i.width, i.height); x.drawImage(i, 0, 0); return { w: i.width, h: i.height, d: x.getImageData(0, 0, i.width, i.height).data }; };
    const [p, q] = [await read(a), await read(b)];
    if (p.w !== q.w || p.h !== q.h) return { sizeMismatch: [p.w, p.h, q.w, q.h] };
    let outside = 0, inside = 0; const at = [1e9, 1e9, -1, -1];
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      const i = (y * p.w + x) * 4;
      if (Math.max(Math.abs(p.d[i] - q.d[i]), Math.abs(p.d[i + 1] - q.d[i + 1]), Math.abs(p.d[i + 2] - q.d[i + 2])) <= 25) continue;
      if (x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h) inside++; else { outside++; at[0] = Math.min(at[0], x); at[1] = Math.min(at[1], y); at[2] = Math.max(at[2], x); at[3] = Math.max(at[3], y); }
    }
    return { outside, inside, outsideBounds: outside ? at : undefined };
  }, { a, b, rect });
  const origin = await page.evaluate(() => { const r = document.querySelector('[data-d2-scene]').getBoundingClientRect(); return { x: r.left, y: r.top }; });
  const scene = data.scene.ViewBox;
  const baselineShot = await shot();
  const baselineHtml = await page.evaluate(() => document.querySelector('[data-d2-scene]').outerHTML);
  const othersHtml = () => page.evaluate(id => [...document.querySelectorAll('[data-id]')].filter(el => el.dataset.id !== id).map(el => el.outerHTML).length, ID);
  const results = {};
  for (const ID of IDS) {
  const group = data.scene.Root.Children.find(n => n.ID === ID);
  expect(group.Primitive ?? null, 'node group has no own primitive, so every DOM child is shape or label').toBeNull();
  const box = group.Children[0].Primitive.Box;
  const entry = results[ID] = { box };
  entry.faithfulBeyondOriginalBox = await page.evaluate(({ box, ox, oy, scene }) => {
    const el = document.elementFromPoint(ox + box.X + box.Width * 1.5 - scene.X, oy + box.Y + box.Height * 1.5 - scene.Y);
    return el?.closest('[data-id]')?.dataset.id ?? el?.tagName ?? null;
  }, { box, ox: origin.x, oy: origin.y, scene });

  for (const mode of ['same', 'double', 'double-clipped']) {
    const k = mode === 'same' ? 1 : 2;
    await page.evaluate(({ id, box, k, mode }) => {
      const g = document.querySelector(`[data-id="${CSS.escape(id)}"]`);
      window.__saved = [...g.children].map(el => el.outerHTML);
      window.__count = g.children.length;
      window.clicks = 0;
      g.replaceChildren();
      const c = document.createElement('div');
      c.dataset.consumer = mode;
      c.style.cssText = `position:absolute;left:${box.X}px;top:${box.Y}px;width:${box.Width * (mode === 'double-clipped' ? 1 : k)}px;height:${box.Height * (mode === 'double-clipped' ? 1 : k)}px;box-sizing:border-box;border:2px solid #0a7;border-radius:12px;background:#efe;box-shadow:0 2px 8px #0006;font:14px sans-serif;color:#063;overflow:${mode === 'double-clipped' ? 'hidden' : 'visible'}`;
      const inner = document.createElement('div');
      inner.style.cssText = `width:${box.Width * k}px;height:${box.Height * k}px;padding:6px`;
      inner.innerHTML = '<b>Hans</b> <button type="button">Open</button>';
      inner.querySelector('button').addEventListener('click', () => { window.clicks++; });
      c.append(inner); g.append(c);
    }, { id: ID, box, k, mode });
    const after = await shot();
    // Original node box in screenshot pixels; for the enlarged variants the whole enlarged area is excluded from "outside".
    const w = box.Width * (mode === 'double' ? 2 : 1), h = box.Height * (mode === 'double' ? 2 : 1);
    const rect = { x: Math.floor(box.X - scene.X - 6), y: Math.floor(box.Y - scene.Y - 6), w: Math.ceil(w + 12), h: Math.ceil(h + 12) };
    const pixels = await diff(baselineShot, after, rect);
    const probe = await page.evaluate(({ box, mode, ox, oy, scene }) => {
      const at = (x, y) => document.elementFromPoint(ox + x - scene.X, oy + y - scene.Y);
      const label = el => el ? (el.closest('[data-consumer]') ? 'consumer' : el.closest('[data-id]')?.dataset.id ?? el.tagName) : null;
      const inside = at(box.X + box.Width / 2, box.Y + box.Height / 2);
      const beyond = at(box.X + box.Width * 1.5, box.Y + box.Height * 1.5);
      return { center: label(inside), beyondOriginalBox: label(beyond) };
    }, { box, mode, ox: origin.x, oy: origin.y, scene });
    await page.locator('[data-consumer] button').click({ force: true });
    const events = await page.evaluate(() => window.clicks);
    const kept = await page.evaluate(id => ({ groupStillHasId: !!document.querySelector(`[data-id="${CSS.escape(id)}"]`), others: [...document.querySelectorAll('[data-id]')].filter(el => el.dataset.id !== id).length }), ID);
    // Restore the faithful markup.
    await page.evaluate(id => { const g = document.querySelector(`[data-id="${CSS.escape(id)}"]`); g.replaceChildren(); g.insertAdjacentHTML('beforeend', window.__saved.join('')); }, ID);
    const restoredHtml = await page.evaluate(() => document.querySelector('[data-d2-scene]').outerHTML);
    const restored = await diff(baselineShot, await shot(), rect);
    entry[mode] = { pixels, hit: probe, events, kept, restoredMarkupIdentical: restoredHtml === baselineHtml, restoredPixels: restored };
  }
  }
  writeFileSync(join(output, 'consumer-content.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 1));
  for (const [ID, entry] of Object.entries(results)) for (const mode of ['same', 'double', 'double-clipped']) {
    const result = entry[mode];
    expect(result.hit.center, `${mode}: the consumer element, not the faithful shape, is at the node centre`).toBe('consumer');
    expect(result.events, `${mode}: consumer button receives the click`).toBe(1);
    expect(result.restoredMarkupIdentical, `${mode}: restoring returns the faithful markup`).toBe(true);
    expect([result.restoredPixels.outside, result.restoredPixels.inside]).toEqual([0, 0]);
    expect(result.pixels.outside, `${mode}: rest of the board unchanged outside the node`).toBe(0);
  }
});
