import { test, expect } from '@playwright/test';
import { diff, open, shot } from './harness.mjs';

// Spec 0002 section 5 in Chromium: consumer content in a node's box, restore, persistence across updates, and the size handshake.
const source = 'direction: right\ndb: Database { shape: cylinder }\napi: API { style.fill: "#fff4cc" }\napi -> db: query\n';
const host = '<div id="a" style="position:absolute;left:0;top:0"></div>';

async function ready(page, src = source) {
  await open(page, { body: host });
  await page.evaluate(async src => {
    window.events = [];
    window.m = d2web.mount(document.getElementById('a'));
    for (const type of ['click']) m.on(type, e => events.push([e.type, e.id]));
    window.result = await compile(src);
    await m.update(window.result);
  }, src);
}
const card = `(() => { const c = document.createElement('div'); c.dataset.card = ''; c.style.cssText = 'width:100%;height:100%;box-sizing:border-box;background:#e6f7ee;border:2px solid #0a7;border-radius:12px'; const b = document.createElement('button'); b.textContent = 'Open'; b.onclick = () => { window.opened = (window.opened ?? 0) + 1; }; c.append(b); return c; })()`;

test('content replaces only the node: rest of the board unchanged, events and clicks work, restore is exact', async ({ page }) => {
  await ready(page);
  const markup = () => page.evaluate(() => document.getElementById('a').shadowRoot.innerHTML);
  const before = { markup: await markup(), pixels: await shot(page, '#a') };
  const box = await page.evaluate(() => m.nodeBox('api'));
  await page.evaluate(c => m.setNodeContent('api', eval(c)), card);
  const during = await shot(page, '#a');
  // The painted scene sits 1px inside the board wrapper (scene origin offset); exclude the node box with a margin.
  const rect = { x: Math.floor(box.X) - 4, y: Math.floor(box.Y) - 4, w: Math.ceil(box.Width) + 10, h: Math.ceil(box.Height) + 10 };
  expect(await diff(page, before.pixels, during, rect), 'nothing outside the node changes').toEqual({ ratio: 0 });
  expect((await diff(page, before.pixels, during)).ratio, 'the node itself does change').toBeGreaterThan(0);
  expect(await page.evaluate(() => [...document.getElementById('a').shadowRoot.querySelectorAll('[data-id]')].length)).toBeGreaterThan(5);
  const holder = await page.evaluate(() => { const h = document.getElementById('a').shadowRoot.querySelector('[data-d2-content="api"]'); const r = h.getBoundingClientRect(); return { w: r.width, h: r.height, inGroup: h.parentElement.dataset.id }; });
  expect(holder).toEqual({ w: box.Width, h: box.Height, inGroup: 'api' });
  await page.locator('#a [data-card] button').click();
  expect(await page.evaluate(() => window.opened)).toBe(1);
  expect(await page.evaluate(() => events.splice(0)), 'the click inside consumer content is also reported for its node').toEqual([['click', 'api']]);
  await page.evaluate(() => m.setNodeContent('api', null));
  expect(await markup(), 'restore is byte-identical').toBe(before.markup);
  expect(await diff(page, before.pixels, await shot(page, '#a'))).toEqual({ ratio: 0 });
});

test('content persists across updates; a node that disappears is reported as orphaned and revived when it returns', async ({ page }) => {
  await ready(page);
  await page.evaluate(c => m.setNodeContent('api', eval(c)), card);
  const out = await page.evaluate(async () => {
    const same = await m.update(await compile('direction: right\ndb: Database { shape: cylinder }\napi: API\napi -> db\n'));
    const kept = !!document.getElementById('a').shadowRoot.querySelector('[data-d2-content="api"]');
    const gone = await m.update(await compile('db: Database\n'));
    const hidden = !document.getElementById('a').shadowRoot.querySelector('[data-d2-content="api"]');
    const back = await m.update(await compile('api\ndb\n'));
    return { same, kept, gone, hidden, back, revived: !!document.getElementById('a').shadowRoot.querySelector('[data-d2-content="api"]') };
  });
  expect(out).toMatchObject({ same: { orphaned: [] }, kept: true, gone: { orphaned: ['api'] }, hidden: true, back: { orphaned: [] }, revived: true });
});

test('size handshake: a measured consumer card becomes D2 width/height and the next update fits the new box', async ({ page }) => {
  await ready(page, 'direction: right\nb\na\na -> b\n');
  const out = await page.evaluate(async () => {
    const el = document.createElement('div');
    el.style.cssText = 'display:inline-block;padding:10px 24px;font:16px sans-serif;white-space:nowrap';
    el.textContent = 'A consumer card with some long text inside';
    document.body.append(el);
    const { width, height } = el.getBoundingClientRect(); // natural size, measured by the consumer
    el.remove();
    const next = await compile(`direction: right\nb\na\na -> b\na.width: ${Math.ceil(width)}\na.height: ${Math.ceil(height)}\n`);
    const fill = document.createElement('div'); fill.style.cssText = 'width:100%;height:100%;background:#eef';
    m.setNodeContent('a', fill);
    await m.update(next);
    const box = m.nodeBox('a');
    const h = document.getElementById('a').shadowRoot.querySelector('[data-d2-content="a"]').getBoundingClientRect();
    return { asked: [Math.ceil(width), Math.ceil(height)], box, holder: [h.width, h.height] };
  });
  expect(out.box.Width).toBe(out.asked[0]);
  expect(out.box.Height).toBe(out.asked[1]);
  expect(out.holder).toEqual([out.asked[0], out.asked[1]]);
});
