import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from '../../tests/examples.mjs';

const directory = join(root, 'artifacts/research-reactflow');

test('React Flow retains native fixed bounds and adjusted route under consumer interaction', async ({ page, browser }, info) => {
  const fixture = JSON.parse(await readFile(join(directory, 'input.json'), 'utf8'));
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
  page.on('request', request => requests.push(request.url()));
  const origin = 'http://d2-reactflow.test';
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    const file = { '/': 'index.html', '/probe.js': 'probe.js', '/probe.css': 'probe.css' }[url.pathname];
    if (url.origin !== origin || !file) return route.abort('accessdenied');
    return route.fulfill({ path: join(directory, file) });
  });
  await page.goto(origin, {waitUntil:'domcontentloaded',timeout:10000});
  await page.waitForFunction(() => window.probeReady && document.querySelector('.react-flow__edge-path'), null, {timeout:10000})
    .catch(error => { throw new Error(`${error.message}\nBrowser errors: ${JSON.stringify(errors)}`); });
  const measure = () => page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.react-flow__node')].map(element => {
      const {x,y,width,height} = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { id: element.dataset.id, x,y,width,height, padding:style.padding, border:style.borderWidth,
        background:style.backgroundColor, userSelect:style.userSelect, pointerEvents:style.pointerEvents,
        cardPointerEvents:getComputedStyle(element.querySelector('.consumer-card')).pointerEvents, transform:style.transform };
    });
    const path = document.querySelector('.react-flow__edge-path');
    const matrix = path.getScreenCTM();
    return { boxes, path:path.getAttribute('d'), viewport:document.querySelector('.react-flow__viewport').style.transform,
      edgeMatrix:{a:matrix.a,d:matrix.d,e:matrix.e,f:matrix.f}, observations:structuredClone(window.observations) };
  });
  const verify = (measurement, zoom) => {
    expect(measurement.path).toBe(fixture.path);
    expect(measurement.boxes).toHaveLength(2);
    for (const shape of fixture.shapes) {
      const box = measurement.boxes.find(box => box.id === shape.id);
      expect(box.x).toBeCloseTo(30 + shape.pos.x * zoom, 3);
      expect(box.y).toBeCloseTo(30 + shape.pos.y * zoom, 3);
      expect(box.width).toBeCloseTo(shape.width * zoom, 3);
      expect(box.height).toBeCloseTo(shape.height * zoom, 3);
    }
    expect(measurement.edgeMatrix).toEqual({a:zoom,d:zoom,e:30,f:30});
    expect(measurement.observations.nodeChanges.filter(change => change.type !== 'dimensions')).toEqual([]);
    expect(measurement.observations.edgeChanges).toEqual([]);
  };
  const initial = await measure();
  verify(initial, 1);
  const button = page.getByRole('button', { name:'Open source', exact:true });
  await button.click();
  await button.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  const label = await page.locator('[data-d2-id="source"] .selectable').boundingBox();
  await page.mouse.move(label.x + 1, label.y + label.height / 2);
  await page.mouse.down();
  await page.mouse.move(label.x + 23, label.y + label.height / 2, {steps:12});
  await page.mouse.up();
  expect(await page.evaluate(() => getSelection().toString())).toBe('Select');
  await page.mouse.move(300, 150);
  await page.mouse.down();
  await page.mouse.move(350, 180, {steps:8});
  await page.mouse.up();
  await page.mouse.wheel(0, 120);
  const interacted = await measure();
  verify(interacted, 1);
  expect(interacted.observations.clicks).toEqual(['source','source']);
  expect(interacted.observations.viewportChanges).toEqual([]);
  expect(initial.boxes.every(box => box.pointerEvents === 'none' && box.cardPointerEvents === 'auto')).toBe(true);
  await page.evaluate(() => { window.originalNode = document.querySelector('[data-d2-id="source"]'); window.renderProbe(); });
  await expect(page.locator('[data-revision]')).toHaveAttribute('data-revision','2');
  expect(await page.evaluate(() => window.originalNode === document.querySelector('[data-d2-id="source"]'))).toBe(true);
  const rerendered = await measure();
  verify(rerendered, 1);
  await page.evaluate(() => window.renderProbe(2));
  await expect(page.locator('.react-flow__viewport')).toHaveCSS('transform', 'matrix(2, 0, 0, 2, 30, 30)');
  const scaled = await measure();
  verify(scaled, 2);
  expect(await button.ariaSnapshot()).toContain('button "Open source"');
  expect(errors).toEqual([]);
  expect(requests.every(url => url.startsWith(origin + '/'))).toBe(true);
  await page.screenshot({path:join(directory,'scaled.png')});
  const report = {browser:browser.version(), fixture, initial, interacted, rerendered, scaled, errors, requests,
    limits:[
      'Actual pinned React Flow, two fixed consumer HTML cards and one straight native adjusted route only; no faithful node paint, marker, text or full-D2 parity claim.',
      'This fixture supplies hidden measurable handles; it does not compare a no-handle configuration. Its edge ignores handle endpoint coordinates and uses the caller-supplied native scene path.',
      'No shadcn installed; custom HTML button probes representation replacement only. No changed-size relayout, nesting, packaging API, portal, multi-instance or dispose proof.',
      'Only base.css imported; synthetic consumer card CSS explicitly supplied. Native target positions and native scene-adjusted path are distinct inputs.',
      'Read-only flags set node-wrapper pointer-events:none and base CSS sets user-select:none. Consumer card opts into pointer-events:auto and selectable span into user-select:text.',
    ]};
  await writeFile(join(directory,'report.json'), JSON.stringify(report,null,2)+'\n');
  await info.attach('observations',{body:JSON.stringify(report,null,2),contentType:'application/json'});
});
