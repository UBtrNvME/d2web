import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from '../../tests/examples.mjs';

const directory = join(root, 'artifacts/research-jointjs');

test('JointJS retains fixed bounds and route through HTML content and structural cleanup', async ({ page, browser }, info) => {
  const fixture = JSON.parse(await readFile(join(directory, 'input.json'), 'utf8'));
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
  page.on('request', request => requests.push(request.url()));
  const origin = 'http://d2-jointjs.test';
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    const file = { '/': 'index.html', '/probe.js': 'probe.js' }[url.pathname];
    if (url.origin !== origin || !file) return route.abort('accessdenied');
    return route.fulfill({ path: join(directory, file) });
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 10000 });
  await page.waitForFunction(() => window.probeReady && document.querySelector('#paper svg'), null, { timeout: 10000 })
    .catch(error => { throw new Error(`${error.message}\nBrowser errors: ${JSON.stringify(errors)}`); });
  const measure = () => page.evaluate(() => {
    const boxes = [...document.querySelectorAll('g[data-type="d2web.Node"]')].map(element => {
      const bounds = element.getBoundingClientRect();
      const foreign = element.querySelector('foreignObject');
      const button = element.querySelector('button');
      const rectStyle = getComputedStyle(element.querySelector('rect'));
      return { id: element.getAttribute('model-id'), x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
        foreignTag: foreign?.tagName, foreignX: foreign?.getAttribute('x'), foreignWidth: foreign?.getAttribute('width'),
        buttonRole: button?.tagName, userSelect: getComputedStyle(element).userSelect,
        effectiveFill: rectStyle.fill, effectiveStrokeWidth: rectStyle.strokeWidth };
    });
    const path = [...document.querySelectorAll('#paper path')].find(element => element.getAttribute('d')?.includes('59.5'));
    const bounds = path?.getBBox();
    return { boxes, path: path?.getAttribute('d'), pathBox: bounds && { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, paperCount: document.querySelectorAll('.joint-paper').length,
      observations: structuredClone(window.observations) };
  });
  const initial = await measure();
  const normalizePath = path => path.replace(/([ML])\s+/g, '$1').trim().replace(/\s+/g, ' ');
  expect(normalizePath(initial.path)).toBe(normalizePath(fixture.path));
  expect(initial.boxes).toHaveLength(2);
  for (const shape of fixture.shapes) {
    const box = initial.boxes.find(box => box.id === shape.id);
    expect(box.x).toBeCloseTo(shape.pos.x, 3);
    expect(box.y).toBeCloseTo(shape.pos.y, 3);
    expect(box.width).toBeCloseTo(shape.width, 3);
    expect(box.height).toBeCloseTo(shape.height, 3);
    expect(box.foreignTag).toBe('foreignObject');
    expect(box.buttonRole.toLowerCase()).toBe('button');
    expect(box.userSelect).toBe('text');
    expect(box.effectiveFill).toBe('rgb(1, 2, 3)');
    expect(box.effectiveStrokeWidth).toBe('7px');
  }
  expect(initial.pathBox.x).toBeCloseTo(59.5, 3);
  expect(initial.pathBox.y).toBeCloseTo(21, 3);
  expect(initial.pathBox.width).toBeCloseTo(101.5, 3);
  await page.getByRole('button', { name: 'Open node' }).first().click();
  await page.getByRole('button', { name: 'Open node' }).first().focus();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.observations.clicks)).toEqual(['Open node', 'Open node']);
  expect(await page.evaluate(() => window.observations.paperEvents)).toBe(1);
  const structuralCleanup = await page.evaluate(() => window.disposeProbe());
  expect(structuralCleanup).toEqual({ cells: 0, paperAttached: false });
  expect(await page.locator('.joint-paper').count()).toBe(0);
  expect(errors).toEqual([]);
  expect(requests.every(url => url.startsWith(origin + '/'))).toBe(true);
  const report = { browser: browser.version(), fixture, initial,
    interactions: await page.evaluate(() => window.observations), errors, requests,
    structuralCleanup,
    limits: [
      'One pinned JointJS Core version, two fixed-bound consumer HTML shapes and one straight route only; no full D2 paint, marker, label, text or TALA parity claim.',
      'The probe supplies a custom connector returning the native scene path and disables JointJS cell interaction; it does not validate the library default router or consumer editing gestures.',
      'ForeignObject supplies HTML buttons and fixed content; no changed-size relayout, nesting, portals, multi-instance isolation, Safari, packaging API or shadcn comparison.',
      'The host page CSS deliberately overrides element fill and stroke width; this confirms CSS can affect effective SVG paint while D2 geometry stays fixed.',
      'Browser path and fixed element boxes are measured in Chromium; this does not establish accessibility or cross-browser behavior.',
    ] };
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await info.attach('observations', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
});
