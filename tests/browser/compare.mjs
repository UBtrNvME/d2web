import { expect } from '@playwright/test';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

async function capture(page, path, selector, root) {
  root = realpathSync(root ?? dirname(path));
  const origin = 'http://d2-fixtures.test';
  await page.unroute(`${origin}/**`);
  // Serve fixture files through Playwright so normal ES modules and fonts work.
  await page.route(`${origin}/**`, async route => {
    try {
      const file = realpathSync(resolve(root, '.' + decodeURIComponent(new URL(route.request().url()).pathname)));
      const local = relative(root, file);
      if (local === '..' || local.startsWith(`..${sep}`)) return route.abort('accessdenied');
      await route.fulfill({ path: file });
    } catch { await route.abort('failed'); }
  });
  await page.goto(`${origin}/${relative(root, path).split(sep).map(encodeURIComponent).join('/')}`);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images ?? []].map(image => image.decode()));
  });
  const scene = page.locator(selector);
  await expect(scene).toHaveCount(1);
  return { bounds: await scene.boundingBox(), png: await scene.screenshot({ animations: 'disabled' }) };
}

export async function compare(page, nativeSVG, webHTML, info, webRoot) {
  expect(info.config.updateSnapshots, 'The candidate must never update the native reference').toBe('none');
  const reference = await capture(page, nativeSVG, ':root');
  const actual = await capture(page, webHTML, '[data-d2-scene]', webRoot);
  expect(actual.bounds.width, 'Diagram width').toBeCloseTo(reference.bounds.width, 2);
  expect(actual.bounds.height, 'Diagram height').toBeCloseTo(reference.bounds.height, 2);
  const expectedPath = info.snapshotPath('native.png');
  mkdirSync(dirname(expectedPath), { recursive: true });
  writeFileSync(expectedPath, reference.png);
  await info.attach('native', { body: reference.png, contentType: 'image/png' });
  await info.attach('web', { body: actual.png, contentType: 'image/png' });
  await info.attach('browser', { body: page.context().browser().version(), contentType: 'text/plain' });
  expect(actual.png).toMatchSnapshot('native.png');
}
