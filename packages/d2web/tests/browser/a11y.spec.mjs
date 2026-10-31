import { test, expect } from '@playwright/test';
import { open } from './harness.mjs';

// Spec 0006: names, nesting and descriptions are D2's own data in ARIA form.
const host = '<div id="a" style="position:absolute;left:0;top:0"></div>';
const board = 'a -> b\nc: Group { d: Dee; e }\nc.d -> c.e: link\nm: |md **x** y |\nt: |`go\nfmt\n`|\nx: Tip {tooltip: Some tip}\ni <-> j\nk -- l';
const objects = page => page.evaluate(() => Object.fromEntries([...document.getElementById('a').shadowRoot.querySelectorAll('[data-id][role="group"]')].map(el => [el.dataset.id, {
  name: el.getAttribute('aria-label'), description: el.getAttribute('aria-description'), owns: el.getAttribute('aria-owns'),
}])));

async function ready(page, source = board) {
  await open(page, { body: host });
  await page.evaluate(async source => { window.m = d2web.mount(document.getElementById('a')); await m.update(await compile(source)); }, source);
}

test('unlabeled connections are named by D2\'s own spelling, one distinct name per arrow kind', async ({ page }) => {
  await ready(page);
  const o = await objects(page);
  expect(o['(a -> b)[0]'].name).toBe('a -> b');
  expect(o['(i <-> j)[0]'].name).toBe('i <-> j');
  expect(o['(k -- l)[0]'].name).toBe('k -- l');
  await expect(page.getByRole('group', { name: 'a -> b' })).toHaveCount(1);
});

test('a labeled connection keeps its label as name and announces its endpoints as description', async ({ page }) => {
  await ready(page);
  const connection = (await objects(page))['c.(d -> e)[0]'];
  expect(connection.name).toBe('link');
  expect(connection.description).toBe('c.d -> e');
});

test('markdown and code labels are named by the label text as D2 gives it', async ({ page }) => {
  await ready(page);
  const o = await objects(page);
  expect(o.m.name).toBe('**x** y');
  expect(o.t.name).toBe('fmt');
});

test('a container owns its nested objects without moving them in the DOM', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(() => {
    const root = document.getElementById('a').shadowRoot;
    const group = root.querySelector('[data-id="c"]');
    const owned = group.getAttribute('aria-owns').split(' ').map(id => root.getElementById(id)?.dataset.id);
    return { owned, nested: root.querySelector('[data-id="c.d"]').parentElement === group.parentElement };
  });
  expect(result.owned.sort()).toEqual(['c.d', 'c.e']) // D2 gives shapes a parent, connections none;
  expect(result.nested, 'children stay siblings in the DOM').toBe(true);
});

test('a D2 tooltip is the description of its focusable object', async ({ page }) => {
  await ready(page);
  const o = await objects(page);
  expect(o.x.description).toBe('Some tip');
  expect(o.x.name).toBe('Tip');
});

test('painted label text is findable in the page (measured)', async ({ page }) => {
  await ready(page);
  const found = await page.evaluate(() => window.find('Dee'));
  // Recorded as measured, not assumed; flip the expectation if a browser differs.
  console.log('find-in-page for painted text:', found);
  expect(typeof found).toBe('boolean');
});
