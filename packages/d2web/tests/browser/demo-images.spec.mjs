import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../../../../tests/examples.mjs';

// Spec 0010 test 15: the built demo page (packages/d2web/dist + demo/index.html) uses the `images` option, not a source rewrite. The icons origin is stubbed.
const dist = join(root, 'packages/d2web/dist');
const types = { '.js': 'text/javascript', '.wasm': 'application/wasm' };
const GREEN = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" fill="#00ad5a"/></svg>';

const open = async (page, icons) => {
  const iconRequests = [];
  await page.route('https://demo.test/**', route => {
    const name = new URL(route.request().url()).pathname.slice(1) || 'index.html';
    const body = name === 'index.html' ? readFileSync(join(root, 'packages/d2web/demo/index.html')) : readFileSync(join(dist, name));
    route.fulfill({ body, contentType: name === 'index.html' ? 'text/html' : types[name.slice(name.lastIndexOf('.'))] ?? 'application/octet-stream' });
  });
  await page.route('https://icons.terrastruct.com/**', route => { iconRequests.push([route.request().resourceType(), route.request().url()]); icons(route); });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('https://demo.test/');
  await expect(page.locator('#status')).toContainText('compiled in', { timeout: 90_000 });
  return { iconRequests, errors };
};
const ecosystem = async page => {
  await page.selectOption('#example', 'd2web in the D2 ecosystem');
  await page.waitForFunction(() => /compiled in/.test(document.querySelector('#status').textContent) && document.querySelector('#src').value.includes('icons.terrastruct.com'), null, { timeout: 90_000 });
};

test('the ecosystem example fetches its icons from the page and paints them as vectors; the editor keeps the links', async ({ page }) => {
  test.setTimeout(240_000);
  const { iconRequests, errors } = await open(page, route => route.fulfill({ body: GREEN, contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' } }));
  await ecosystem(page);
  await expect(page.locator('#status')).not.toContainText('could not be fetched', { timeout: 90_000 });
  expect(await page.inputValue('#src')).toContain('https://icons.terrastruct.com/');
  expect(await page.inputValue('#src')).not.toContain('data:image');
  expect(iconRequests.length).toBeGreaterThan(3);
  expect(iconRequests.every(([type]) => type === 'fetch')).toBe(true); // the page fetched them; the browser did not load any as an image
  const html = await page.evaluate(() => document.querySelector('#host').shadowRoot.innerHTML);
  expect(html).toContain('rgb(0,173,90)');
  expect(html).not.toMatch(/<img [^>]*icons\.terrastruct\.com/);
  expect(errors).toEqual([]);
});

test('icons that cannot be fetched are shown as links, with the count in the status line', async ({ page }) => {
  test.setTimeout(240_000);
  const { iconRequests } = await open(page, route => (route.request().resourceType() === 'fetch' ? route.abort() : route.fulfill({ body: GREEN, contentType: 'image/svg+xml' }))); // what a CORS refusal looks like to fetch; an <img> does not need CORS
  await ecosystem(page);
  await expect(page.locator('#status')).toContainText('could not be fetched and are shown as links', { timeout: 90_000 });
  const html = await page.evaluate(() => document.querySelector('#host').shadowRoot.innerHTML);
  expect(html).toMatch(/<img [^>]*src="https:\/\/icons\.terrastruct\.com\//);
  await expect.poll(() => iconRequests.some(([type]) => type === 'image')).toBe(true);
});
