import { test, expect } from '@playwright/test';
import { diff, open, shot } from './harness.mjs';

// ADR 0009: D2 supplies link/tooltip semantics; the painter exposes them through native web elements.
const host = '<div id="a" style="position:absolute;left:0;top:0"></div>';
const source = 'x: Click {link: https://example.test}';
const linkIn = page => page.locator('#a a[data-k="link"]');

async function ready(page, source) {
  await open(page, { body: host });
  await page.evaluate(async source => {
    window.m = d2web.mount(document.getElementById('a'));
    await m.update(await compile(source));
  }, source);
}

test('a D2 link is one real anchor covering the node box', async ({ page }) => {
  await ready(page, source);
  const link = linkIn(page);
  await expect(page.locator('#a a')).toHaveCount(1);
  await expect(link).toHaveAttribute('href', 'https://example.test');
  await expect(link).toBeVisible();
  const boxes = await page.evaluate(() => {
    const a = document.getElementById('a').shadowRoot.querySelector('a[data-k="link"]');
    return {
      node: m.nodeBox('x'),
      link: { X: parseFloat(a.style.left), Y: parseFloat(a.style.top), Width: parseFloat(a.style.width), Height: parseFloat(a.style.height) },
    };
  });
  expect(boxes.node.Width).toBeGreaterThan(0);
  expect(boxes.node.Height).toBeGreaterThan(0);
  // D2's own link region is the node box grown by its stroke (2 px each side here); the painter adds nothing to it.
  const { node, link: box } = boxes;
  expect(box.X).toBeLessThanOrEqual(node.X);
  expect(box.Y).toBeLessThanOrEqual(node.Y);
  expect(box.X + box.Width).toBeGreaterThanOrEqual(node.X + node.Width);
  expect(box.Y + box.Height).toBeGreaterThanOrEqual(node.Y + node.Height);
  expect(node.X - box.X).toBeLessThanOrEqual(4);
  expect(box.Width - node.Width).toBeLessThanOrEqual(8);
});

test('a D2 tooltip exposes its exact title without a badge or extra visible content', async ({ page }) => {
  await ready(page, 'x: Hover');
  const baseline = await shot(page, '#a');
  await page.evaluate(async () => m.update(await compile('x: Hover {tooltip: Some tip}')));
  const tooltip = linkIn(page);
  await expect(tooltip).toHaveCount(1);
  await expect(tooltip).toHaveAttribute('title', 'Some tip');
  await expect(tooltip).not.toHaveAttribute('href');
  await expect(tooltip).toBeEmpty();
  expect(await diff(page, baseline, await shot(page, '#a'))).toEqual({ ratio: 0 });
  await tooltip.hover();
  await expect(tooltip).toHaveAttribute('title', 'Some tip');
});

test('a D2 link with a tooltip carries both href and title', async ({ page }) => {
  await ready(page, 'x: Click {link: https://example.test; tooltip: Some tip}');
  const link = linkIn(page);
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute('href', 'https://example.test');
  await expect(link).toHaveAttribute('title', 'Some tip');
  // The link is named by its D2 object's label; the tooltip stays the title.
  await expect(link).toHaveAccessibleName('Click');
});

test('a link-only anchor is reachable by Tab and named by its node label', async ({ page }) => {
  await ready(page, source);
  const link = linkIn(page);
  await page.keyboard.press('Tab');
  await expect(page.locator('#a [data-id="x"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(link).toBeFocused();
  await expect(link).toHaveAccessibleName('Click');
});

test('a markdown D2 tooltip exposes literal markdown in its title today', async ({ page }) => {
  await ready(page, 'x: Hover {tooltip: |md **bold** tip |}');
  const tooltip = linkIn(page);
  await expect(tooltip).toHaveCount(1);
  // D2's block-string delimiters/language are absent; the markdown source is not rendered inside a title.
  await expect(tooltip).toHaveAttribute('title', '**bold** tip');
  await expect(tooltip).toBeEmpty();
  await expect(page.locator('#a strong, #a b')).toHaveCount(0);
});

test('a link on a nested node and on a container each keep their own name', async ({ page }) => {
  await ready(page, 'group: Group {link: https://group.test; inner: Inner {link: https://inner.test}}');
  const names = await page.evaluate(() => [...document.getElementById('a').shadowRoot.querySelectorAll('a[data-k="link"]')].map(a => [a.getAttribute('href'), a.getAttribute('aria-label')]));
  expect(names).toContainEqual(['https://group.test', 'Group']);
  expect(names).toContainEqual(['https://inner.test', 'Inner']);
});

test('a link on a connection is an anchor named by the connection label', async ({ page }) => {
  await ready(page, 'a -> b: Edge {link: https://edge.test}');
  const link = page.locator('#a a[href="https://edge.test"]');
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAccessibleName('Edge');
});
