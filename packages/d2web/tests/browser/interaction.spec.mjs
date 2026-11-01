import { test, expect } from '@playwright/test';
import { open } from './harness.mjs';

// ADR 0009: links and tooltips are behaviour, not pixels. These tests drive them as a person would (click, Enter) and pin what the painter allows.
const host = '<div id="a" style="position:absolute;left:0;top:0"></div>';
const anchor = page => page.locator('#a a[data-k="link"]');

async function ready(page, source) {
  await open(page, { body: host });
  await page.route('https://example.test/**', route => route.fulfill({ body: '<title>destination</title>ok', contentType: 'text/html' }));
  await page.evaluate(async source => {
    window.__ran = 0;
    window.m = d2web.mount(document.getElementById('a'));
    await m.update(await compile(source));
  }, source);
}

test('clicking a D2 link navigates the page to its URL', async ({ page }) => {
  await ready(page, 'x: Click {link: https://example.test/next}');
  await anchor(page).click();
  await page.waitForURL('https://example.test/next');
});

test('Enter on a focused D2 link navigates like a click', async ({ page }) => {
  await ready(page, 'x: Click {link: https://example.test/keyboard}');
  await anchor(page).focus();
  await page.keyboard.press('Enter');
  await page.waitForURL('https://example.test/keyboard');
});

for (const [name, url] of [['javascript:', 'javascript:window.__ran=1'], ['javascript: with control characters', 'java\tscript:window.__ran=1'], ['vbscript:', 'vbscript:msgbox(1)'], ['data:', 'data:text/html,<b>x</b>']]) {
  test(`a ${name} link is never put in href and runs nothing`, async ({ page }) => {
    await ready(page, `x: Click {link: "${url.replace('\t', '\\t')}"; tooltip: kept}`);
    const link = anchor(page);
    await expect(link).toHaveCount(1);
    await expect(link).not.toHaveAttribute('href', /.*/);
    await expect(link).toHaveAttribute('title', 'kept'); // the tooltip and name survive
    await link.click({ force: true });
    expect(await page.evaluate(() => window.__ran)).toBe(0);
    expect(page.url()).toBe('https://host.test/');
  });
}

test('mailto: and relative links keep their href (only script-running schemes are refused)', async ({ page }) => {
  await ready(page, 'a: Mail {link: "mailto:me@example.test"}\nb: Rel {link: "/docs/page"}');
  const hrefs = await page.evaluate(() => [...document.getElementById('a').shadowRoot.querySelectorAll('a[data-k="link"]')].map(a => a.getAttribute('href')).sort());
  expect(hrefs).toEqual(['/docs/page', 'mailto:me@example.test']);
});

test('a link to a board is an anchor without href that names its target and navigates nowhere', async ({ page }) => {
  await ready(page, 'x: Go {link: layers.two}\nlayers: { two: { y } }');
  const link = anchor(page);
  await expect(link).toHaveAttribute('data-target', 'root.layers.two');
  await expect(link).not.toHaveAttribute('href', /.*/);
  await link.click({ force: true });
  expect(page.url()).toBe('https://host.test/'); // opening the board is the consumer's decision
});
