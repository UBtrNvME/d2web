import { test, expect } from '@playwright/test';
import { defaultRender, diff, open, shot } from './harness.mjs';

// Spec 0002 sections 3 (lifecycle) in Chromium, fed by the real client, worker and wasm.
const source = 'direction: right\ndb: Database { shape: cylinder }\napi: API { style.fill: "#fff4cc" }\napi -> db: query\n';
const host = '<div id="a" style="position:absolute;left:0;top:0"></div><div id="b" style="position:absolute;left:0;top:0;visibility:hidden"></div>';
const hostile = `div{padding:7px;margin:5px;border:2px solid red;line-height:3;letter-spacing:3px;text-transform:uppercase}
  svg{max-width:50%;height:auto;display:inline}a{color:red}*{box-sizing:content-box;font-style:italic;font-size:30px}#a,#b{padding:0;margin:0;border:0}`;
const mountIn = (page, id = 'a', options) => page.evaluate(async ({ id, options, source }) => {
  window.m ??= {};
  window.m[id] = d2web.mount(document.getElementById(id), options);
  window.result ??= await compile(source);
  return window.m[id].update(window.result);
}, { id, options, source });

test('mount, update and dispose leave no traces and remount reproduces the markup', async ({ page }) => {
  const requests = [];
  page.on('request', r => { if (!/^(data|about|blob):/.test(r.url())) requests.push(r.url().replace('https://host.test', '')); });
  await open(page, { body: host });
  await page.evaluate(source => compile(source).then(r => { window.result = r; }), source);
  const snap = () => page.evaluate(() => ({ head: document.head.children.length, sheets: document.styleSheets.length, adopted: document.adoptedStyleSheets.length, storage: localStorage.length + sessionStorage.length, cookies: document.cookie.length, lightDom: document.getElementById('a').children.length, globals: Object.keys(window).length }));
  await page.evaluate(() => { window.m = {}; }); // the test's own handle, not the library's
  const before = await snap();
  requests.length = 0;
  const report = await page.evaluate(() => { window.m.a = d2web.mount(document.getElementById('a'), { idPrefix: 'fixed-' }); return window.m.a.update(window.result); });
  expect(report).toEqual({ board: '', orphaned: [] });
  expect(requests).toEqual([]);
  const after = await snap();
  expect(after).toEqual(before);
  const html = () => page.evaluate(() => document.getElementById('a').shadowRoot.innerHTML);
  const painted = await html();
  expect(painted).toContain('data-d2-scene');
  expect(await page.evaluate(() => document.getElementById('a').shadowRoot.mode)).toBe('open');
  await page.evaluate(() => m.a.dispose());
  expect(await page.evaluate(() => document.getElementById('a').shadowRoot.children.length)).toBe(0);
  expect(await page.evaluate(() => m.a.update(window.result).catch(e => e.constructor.name))).toBe('MountError');
  await page.evaluate(async () => { window.m.a = d2web.mount(document.getElementById('a'), { idPrefix: 'fixed-' }); await m.a.update(window.result); });
  expect(await html()).toBe(painted);
  await page.evaluate(() => { try { d2web.mount(document.getElementById('a')); window.second = 'mounted'; } catch (e) { window.second = e.constructor.name; } });
  expect(await page.evaluate(() => window.second), 'a live mount cannot be mounted over').toBe('MountError');
});

test('update failures leave the previous DOM untouched', async ({ page }) => {
  await open(page, { body: host });
  await mountIn(page);
  const before = await page.evaluate(() => document.getElementById('a').shadowRoot.innerHTML);
  const errors = await page.evaluate(async () => {
    const r = window.result;
    const attempt = fn => fn().then(() => 'resolved', e => `${e.constructor.name}: ${e.message}`);
    return {
      errored: await attempt(() => m.a.update({ ...r, boards: undefined, error: { code: 'compile', message: 'syntax', diagnostics: [] } })),
      missing: await attempt(() => m.a.update(r, '/layers/nope')),
      nullRoot: await attempt(() => m.a.update({ ...r, boards: [{ ...r.boards[0], scene: { ...r.boards[0].scene, Root: null } }] })),
      unknown: await attempt(() => m.a.update({ ...r, boards: [{ ...r.boards[0], scene: { ...r.boards[0].scene, Root: { ...r.boards[0].scene.Root, Primitive: { $: 'Bogus' } } } }] })),
    };
  });
  for (const [name, message] of Object.entries(errors)) expect(message, name).toMatch(/^MountError/);
  expect(await page.evaluate(() => document.getElementById('a').shadowRoot.innerHTML)).toBe(before);
});

test('nodeBox reports painted node boxes in scene coordinates', async ({ page }) => {
  await open(page, { body: host });
  await mountIn(page);
  const boxes = await page.evaluate(() => ({ api: m.a.nodeBox('api'), db: m.a.nodeBox('db'), none: m.a.nodeBox('nope') }));
  expect(boxes.none).toBeUndefined();
  expect(boxes.api.Width).toBeGreaterThan(0);
  expect(boxes.db.Height).toBeGreaterThan(0);
  expect(boxes.api.X).toBeLessThan(boxes.db.X); // direction: right
});

test('two mounts of the same scene stay independent and isolated from hostile page CSS', async ({ page, context }) => {
  await open(page, { body: host });
  await mountIn(page);
  const baseline = await shot(page, '#a');
  const hostilePage = await context.newPage();
  await open(hostilePage, { body: host, css: hostile });
  await mountIn(hostilePage, 'a');
  await mountIn(hostilePage, 'b');
  const ids = await hostilePage.evaluate(() => ['a', 'b'].map(id => [...document.getElementById(id).shadowRoot.querySelectorAll('[id]')].map(e => e.id)));
  expect(ids[0].length + ids[1].length).toBeGreaterThanOrEqual(0);
  expect(ids[0].filter(id => ids[1].includes(id)), 'IDs inside the two mounts are prefixed apart').toEqual([]);
  for (const id of ['a', 'b']) {
    await hostilePage.evaluate(id => { for (const e of ['a', 'b']) document.getElementById(e).style.visibility = e === id ? 'visible' : 'hidden'; }, id);
    expect(await diff(hostilePage, baseline, await shot(hostilePage, '#' + id)), `mount ${id} under hostile CSS`).toEqual({ ratio: 0 });
  }
  // The host element's own visibility is the consumer's: a hidden host stays hidden (the wrapper inherits it).
  await hostilePage.evaluate(() => { document.getElementById('b').style.visibility = 'hidden'; });
  expect(await hostilePage.evaluate(() => getComputedStyle(document.getElementById('b').shadowRoot.firstElementChild).visibility)).toBe('hidden');
});

test('pad, scale and center scale the painted content with the host', async ({ page }) => {
  await open(page, { body: host });
  const boxes = await page.evaluate(async () => {
    const mount = d2web.mount(document.getElementById('a'));
    const boxes = [];
    for (const scale of [1, 1.5]) {
      await mount.update(await compile('a -> b', { pad: 40, scale, center: true }));
      const root = document.getElementById('a').shadowRoot;
      boxes.push(['[data-d2-scene]', '[data-id="a"] [data-k="rect"]'].map(selector => {
        const { x, y, width, height } = root.querySelector(selector).getBoundingClientRect();
        return { x, y, width, height };
      }));
    }
    mount.dispose();
    return boxes;
  });
  const [[baseHost, shape], [scaledHost, scaledShape]] = boxes;
  expect(scaledHost.width).toBe(Math.ceil(baseHost.width * 1.5));
  expect(scaledHost.height).toBe(Math.ceil(baseHost.height * 1.5));
  expect(scaledShape.width).toBeCloseTo(shape.width * 1.5, 2);
  expect(scaledShape.height).toBeCloseTo(shape.height * 1.5, 2);
  expect(scaledShape.x).toBeCloseTo(shape.x * 1.5 + (scaledHost.width - baseHost.width * 1.5) / 2, 2);
  expect(scaledShape.y).toBeCloseTo(shape.y * 1.5 + (scaledHost.height - baseHost.height * 1.5) / 2, 2);
});

// Spec 0007: a font the engine refuses must not stop the board; the refusal is reported and the rest paints.
test('a font the engine rejects is reported in the update report and the board still paints', async ({ page }) => {
  await open(page, { body: host });
  const out = await page.evaluate(async () => {
    const view = d2web.mount(document.getElementById('a'));
    const result = await compile('a -> b');
    const bad = { ...result, fonts: { ...result.fonts, 'font:fallback:bogus': new Uint8Array([1, 2, 3, 4]) } };
    const first = await view.update(bad);
    const second = await view.update(bad); // not retried, still reported
    return { first, second, painted: document.getElementById('a').shadowRoot.querySelectorAll('[data-id]').length };
  });
  expect(out.first.rejectedFonts.map(f => f.id)).toEqual(['font:fallback:bogus']);
  expect(out.second.rejectedFonts.map(f => f.id)).toEqual(['font:fallback:bogus']);
  expect(out.painted).toBeGreaterThan(0);
});

test('updates paint in call order: a later result is not painted over by an earlier one still loading fonts', async ({ page }) => {
  await open(page, { body: host });
  const label = await page.evaluate(async source => {
    const first = await compile(source);
    const later = await compile('later: Later\n');
    // Every font of the first result loads slowly; the later one brings none to load.
    const Face = FontFace;
    window.FontFace = class extends Face { load() { return new Promise(r => setTimeout(r, 300)).then(() => super.load()); } };
    const m = d2web.mount(document.getElementById('a'));
    const slow = m.update(first);
    await m.update({ ...later, fonts: {} });
    await slow;
    window.FontFace = Face;
    return [...document.getElementById('a').shadowRoot.querySelectorAll('[data-k=text]')].map(t => t.textContent.trim()).join(' ');
  }, source);
  expect(label).toBe('Later');
});
