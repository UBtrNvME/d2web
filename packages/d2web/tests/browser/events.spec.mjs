import { test, expect } from '@playwright/test';
import { open } from './harness.mjs';

// Spec 0002 section 4 in Chromium: delegated events carry the board path and the D2 object ID, also through a shadow root.
const source = 'direction: right\ndb: Database { shape: cylinder }\napi: API { style.fill: "#fff4cc"; link: https://example.test/api }\napi -> db: query\n';
const host = '<div id="a" style="position:absolute;left:20px;top:20px"></div><div id="far" style="position:absolute;left:600px;top:400px;width:40px;height:40px"></div>';

async function ready(page) {
  await open(page, { body: host });
  await page.evaluate(async source => {
    window.events = [];
    // Real links navigate; the test only observes them.
    document.addEventListener('click', e => { if (e.composedPath().some(n => n.tagName === 'A')) e.preventDefault(); }, true);
    window.m = d2web.mount(document.getElementById('a'));
    for (const type of ['click', 'dblclick', 'contextmenu', 'hover', 'focus']) m.on(type, e => events.push({ type: e.type, board: e.board, id: e.id, dom: e.domEvent.type }));
    await m.update(await compile(source));
  }, source);
}
const events = page => page.evaluate(() => events.splice(0));
const part = (page, id) => page.locator(`#a [data-id="${id}"] [data-k=text]`).first();
// The api node has a link, so a link region lies over its label: pointer actions go through the region (forced, no actionability wait).
const linked = { force: true };

test('click, double click and context menu report the object, for nodes and connections', async ({ page }) => {
  await ready(page);
  await part(page, 'api:label:0').click(linked);
  await part(page, 'db:label:0').dblclick();
  await part(page, 'api:label:0').click({ button: 'right', ...linked });
  await page.locator('#a [data-id="(api -> db)[0]:path"] path').click({ force: true });
  const seen = (await events(page)).filter(e => e.type !== 'hover' && e.type !== 'focus');
  // A browser double click is two clicks and then the dblclick.
  expect(seen.map(e => [e.type, e.id])).toEqual([['click', 'api'], ['click', 'db'], ['click', 'db'], ['dblclick', 'db'], ['contextmenu', 'api'], ['click', '(api -> db)[0]']]);
  expect(seen.every(e => e.board === '')).toBe(true);
});

test('hover fires when the pointer enters or leaves an object, not between its parts', async ({ page }) => {
  await ready(page);
  const label = await part(page, 'api:label:0').boundingBox();
  await page.mouse.move(label.x + label.width / 2, label.y + label.height / 2);
  const entered = (await events(page)).filter(e => e.type === 'hover');
  expect(entered.map(e => [e.id, e.dom])).toEqual([['api', 'pointerover']]);
  await page.mouse.move(label.x + 1, label.y + 1, { steps: 4 }); // still inside the same object
  expect((await events(page)).filter(e => e.type === 'hover' && e.id === 'api' && e.dom === 'pointerout')).toEqual([]);
  await page.mouse.move(610, 410);
  expect((await events(page)).filter(e => e.type === 'hover').map(e => [e.id, e.dom])).toContainEqual(['api', 'pointerout']);
});

test('focus: Tab walks the objects in paint order and reports them; links are focusable and hit-testable under the shadow root', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Safari leaves links out of the Tab order unless the user enables it');
  await ready(page);
  const order = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(() => { const a = document.getElementById('a').shadowRoot.activeElement; return a?.tagName === 'A' ? 'link:' + a.getAttribute('href') : a?.dataset.id ?? null; }));
  }
  const focused = (await events(page)).filter(e => e.type === 'focus').map(e => e.id);
  expect(focused).toEqual(order.filter(x => x && !x.startsWith('link:')));
  expect(order).toContain('db');
  expect(order).toContain('api');
  expect(order).toContain('(api -> db)[0]');
  expect(order.some(x => x?.startsWith('link:https://example.test/api'))).toBe(true);
  const hit = await page.evaluate(() => { const a = document.getElementById('a').shadowRoot.querySelector('a[data-k=link]'); const r = a.getBoundingClientRect(); return document.getElementById('a').shadowRoot.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.tagName; });
  expect(hit).toBe('A');
  expect(await page.locator('#a').ariaSnapshot()).toContain('group "Database"');
});

test('unsubscribing stops delivery; listeners are gone after dispose', async ({ page }) => {
  await ready(page);
  const out = await page.evaluate(async () => {
    let n = 0;
    const off = m.on('click', () => n++);
    const label = document.getElementById('a').shadowRoot.querySelector('[data-id="api:label:0"] [data-k=text]');
    label.click(); off(); label.click();
    const afterOff = n;
    m.dispose();
    return { afterOff, throwsAfterDispose: (() => { try { m.on('click', () => {}); return false; } catch (e) { return e.constructor.name; } })() };
  });
  expect(out).toEqual({ afterOff: 1, throwsAfterDispose: 'MountError' });
});
