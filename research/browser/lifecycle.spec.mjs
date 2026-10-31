import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../../tests/examples.mjs';
import { paintScene } from '../../packages/d2web/src/paint.js';

// R3: two painted boards in one document under hostile host CSS. Compares a plain mount, a mount with namespaced IDs and a
// shadow-root mount against a clean single-board baseline, then records effects of update, failed input, disposal and remount.
// Evidence about the research painter's output, not a mount API.
const output = join(root, 'artifacts/research-census');
const load = name => JSON.parse(readFileSync(join(output, 'export', name + '.json'), 'utf8'));
const pairs = [['txtar__gradient__tala', 'txtar__legend-leak__tala'], ['files__nesting_power__tala', 'files__arrowhead_scaling__tala']];
const hostile = `div{padding:7px;margin:5px;border:2px solid red;line-height:3;letter-spacing:3px;text-transform:uppercase}
  svg{max-width:50%;height:auto;display:inline}img{max-width:50%}a{color:red;text-decoration:underline}*{box-sizing:content-box;font-style:italic;font-size:30px}
  #a,#b{padding:0;margin:0;border:0}`; // the consumer's own containers are exempt; everything the painter emits is not

test('research: two boards per document under hostile host CSS, lifecycle effects', async ({ page }) => {
  test.setTimeout(300_000);
  const requests = [];
  page.on('request', r => { if (!r.url().startsWith('data:') && !r.url().startsWith('about:')) requests.push(r.url()); });
  await page.route('https://fonts.test/**', route => route.fulfill({ body: readFileSync(join(output, 'fonts', new URL(route.request().url()).pathname.slice(1))), contentType: 'font/ttf' }));
  const results = {};
  let document_ = '';
  await page.route('https://host.test/**', route => route.fulfill({ body: document_, contentType: 'text/html' }));
  const open = async body => { document_ = body; await page.goto('https://host.test/'); };
  // Pixel difference of two PNGs (base64) as a fraction of pixels with a channel delta over 25.
  const diff = (a, b) => page.evaluate(async ({ a, b }) => {
    const read = async b64 => {
      const image = new Image(); image.src = 'data:image/png;base64,' + b64; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true }); context.fillStyle = '#fff'; context.fillRect(0, 0, image.width, image.height); context.drawImage(image, 0, 0);
      return { w: image.width, h: image.height, d: context.getImageData(0, 0, image.width, image.height).data };
    };
    const [x, y] = [await read(a), await read(b)];
    if (x.w !== y.w || x.h !== y.h) return { sizeMismatch: [x.w, x.h, y.w, y.h] };
    let n = 0;
    for (let i = 0; i < x.d.length; i += 4) if (Math.max(Math.abs(x.d[i] - y.d[i]), Math.abs(x.d[i + 1] - y.d[i + 1]), Math.abs(x.d[i + 2] - y.d[i + 2])) > 25) n++;
    return { ratio: n / (x.w * x.h) };
  }, { a, b });
  const fonts = async fontMap => page.evaluate(async fontMap => {
    for (const [id, name] of Object.entries(fontMap)) {
      const face = new FontFace('scene-' + id.replace(/\W/g, '-'), `url(https://fonts.test/${name})`);
      document.fonts.add(face); await face.load();
    }
    await document.fonts.ready;
  }, fontMap);
  // Mounts markup into #host; mode 'shadow' uses a shadow root. Builds the full tree before touching the host, so a throw leaves it unchanged.
  const mountFn = `window.mount=(host,html,mode)=>{const t=document.createElement('template');t.innerHTML=html;const root=mode.startsWith('shadow')?(host.shadowRoot??host.attachShadow({mode:'open'})):host;root.replaceChildren(t.content);return root;};window.calibrate=root=>{const els=[...root.querySelectorAll('[data-k=text]')];const offsets=els.map(el=>el.querySelector('[data-baseline]').getBoundingClientRect().top-el.getBoundingClientRect().top);els.forEach((el,k)=>{el.style.top=el.dataset.y-offsets[k]+'px';});};`;
  const clean = async (name, key) => {
    const scene = load(name);
    await open(`<!doctype html><body style="margin:0;background:#fff"><style>*{margin:0}</style><div id="host" style="position:absolute;left:0;top:0"></div></body>`);
    await page.evaluate(mountFn);
    await fonts(scene.fonts);
    await page.evaluate(([h]) => mount(document.getElementById('host'), h, 'plain'), [paintScene(scene.scene, { html: true, cssMasks: 'subtree' }).html]);
    await page.evaluate(async () => { await Promise.all([...document.images].map(i => i.decode().catch(() => {}))); });
    await page.evaluate(() => calibrate(document));
    return (await page.locator('#host').screenshot({ animations: 'disabled' })).toString('base64');
  };

  for (const [first, second] of pairs) {
    const key = first.replace(/__tala$/, '');
    const baseline = [await clean(first), await clean(second)];
    const entry = results[key] = {};
    for (const mode of ['plain', 'prefixed', 'shadow', 'plain-hostile', 'prefixed-hostile', 'shadow-hostile', 'shadow-reset', 'shadow-reset-hostile']) {
      const isHostile = mode.endsWith('hostile');
      const kind = mode.replace('-hostile', '');
      const mountMode = kind.startsWith('shadow') ? kind : 'plain';
      const scenes = [load(first), load(second)];
      await open(`<!doctype html><body style="margin:0;background:#fff"><style>*{margin:0}${isHostile ? hostile : ''}</style>
        <div id="a" style="position:absolute;left:0;top:0"></div><div id="b" style="position:absolute;left:0;top:0;visibility:hidden"></div></body>`);
      await page.evaluate(mountFn);
      await fonts({ ...scenes[0].fonts, ...scenes[1].fonts });
      for (const [i, id] of ['a', 'b'].entries()) {
        // shadow-reset wraps the paint in an all:initial element (visibility:inherit restored: all:initial would reset a consumer hiding the host) inside the shadow root. A :host rule cannot do this: outer page rules on the host element win over it.
        const html = (([open, close]) => open + paintScene(scenes[i].scene, { html: true, cssMasks: 'subtree', idPrefix: kind === 'prefixed' ? `m${i}-` : '' }).html + close)(kind === 'shadow-reset' ? ['<div style="all:initial;display:block;visibility:inherit">', '</div>'] : ['', '']);
        await page.evaluate(([id, html, m]) => mount(document.getElementById(id), html, m), [id, html, mountMode]);
      }
      await page.evaluate(async () => { await Promise.all([...document.images].map(i => i.decode().catch(() => {}))); });
      // The painter's text baseline calibration, applied inside each mount root so labels sit where the scene puts them.
      await page.evaluate(() => { for (const id of ['a', 'b']) { const host = document.getElementById(id); calibrate(host.shadowRoot ?? host); } });
      const ids = await page.evaluate(() => { const seen = new Map(); for (const el of document.querySelectorAll('[id]')) seen.set(el.id, (seen.get(el.id) ?? 0) + 1); return [...seen.values()].filter(n => n > 1).length; });
      // Both boards are laid out at the same origin; only one is visible at a time so each is compared with its own baseline.
      const shots = [];
      for (const id of ['a', 'b']) {
        await page.evaluate(id => { for (const el of ['a', 'b']) document.getElementById(el).style.visibility = el === id ? 'visible' : 'hidden'; }, id);
        shots.push((await page.locator('#' + id).screenshot({ animations: 'disabled' })).toString('base64'));
      }
      entry[mode] = { duplicateIds: ids, a: await diff(baseline[0], shots[0]), b: await diff(baseline[1], shots[1]) };
    }
  }

  // Lifecycle on a clean document: global effects, update, failed input, dispose, remount.
  const [first, second] = pairs[0].map(load);
  await open(`<!doctype html><body style="margin:0"><div id="a" style="position:absolute;left:0;top:0"></div></body>`);
  await page.evaluate(mountFn);
  await fonts(first.fonts);
  const snapshot = () => page.evaluate(() => ({
    globals: Object.keys(window).length, head: document.head.children.length, sheets: document.styleSheets.length, adopted: document.adoptedStyleSheets.length,
    storage: localStorage.length + sessionStorage.length, cookies: document.cookie.length, hostNodes: document.getElementById('a').querySelectorAll('*').length,
    hostHtml: document.getElementById('a').innerHTML.length,
  }));
  const before = await snapshot();
  requests.length = 0;
  const htmlOf = scene => paintScene(scene.scene, { html: true, cssMasks: 'subtree' }).html;
  await page.evaluate(h => mount(document.getElementById('a'), h, 'plain'), htmlOf(first));
  const mounted = await snapshot();
  const mountRequests = requests.splice(0);
  await page.evaluate(h => mount(document.getElementById('a'), h, 'plain'), htmlOf(second));
  const updated = await snapshot();
  let failure = '';
  try { paintScene({ ...first.scene, Root: { ...first.scene.Root, Primitive: { $: 'Bogus' } } }, { html: true }); } catch (error) { failure = error.message; }
  // Structurally broken scenes must throw, not paint blank or partial output.
  const silent = {};
  for (const [name, scene] of Object.entries({ nullRoot: { ...first.scene, Root: null }, nullChild: { ...first.scene, Root: { ...first.scene.Root, Children: [null] } } })) { try { paintScene(scene, { html: true }); silent[name] = 'painted'; } catch (error) { silent[name] = error.message; } }
  const afterFailure = await snapshot();
  await page.evaluate(() => document.getElementById('a').replaceChildren());
  const disposed = await snapshot();
  await page.evaluate(h => mount(document.getElementById('a'), h, 'plain'), htmlOf(first));
  const remounted = await snapshot();
  results.lifecycle = { silent, before, mounted, mountRequests, updated, failure, domUnchangedByFailure: afterFailure.hostHtml === updated.hostHtml, disposed, remountedEqualsMounted: remounted.hostHtml === mounted.hostHtml && remounted.hostNodes === mounted.hostNodes };

  writeFileSync(join(output, 'lifecycle.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 1));
  const c = results.txtar__gradient, n = results.files__nesting_power;
  expect(results.lifecycle.mountRequests).toEqual([]);
  expect(Object.values(results.lifecycle.silent).every(m => m !== 'painted'), 'broken scenes throw').toBe(true);
  expect(results.lifecycle.domUnchangedByFailure && results.lifecycle.remountedEqualsMounted).toBe(true);
  expect(results.lifecycle.disposed.hostNodes).toBe(0);
  expect(c.plain.duplicateIds + n.plain.duplicateIds, 'unnamespaced IDs collide across scenes').toBeGreaterThan(0);
  expect(c.plain.b.ratio, 'collision changes the second board').toBeGreaterThan(0.01);
  for (const key of [c, n]) {
    for (const mode of ['prefixed', 'shadow', 'shadow-reset', 'shadow-reset-hostile']) expect([key[mode].a.ratio, key[mode].b.ratio, key[mode].duplicateIds]).toEqual([0, 0, 0]);
    expect(key['plain-hostile'].a.sizeMismatch, 'host element selectors resize a plain mount').toBeDefined();
    expect(key['shadow-hostile'].a.ratio, 'shadow root blocks selector rules').toBeLessThan(0.1);
  }
  expect(c['shadow-hostile'].a.ratio, 'inherited text properties still cross the shadow boundary').toBeGreaterThan(0.01);
});
