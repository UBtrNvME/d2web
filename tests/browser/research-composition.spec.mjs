import { test, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from '../examples.mjs';

// Disposable browser primitive probe, not a renderer or a shadcn compatibility claim.
const output = join(root, 'artifacts/research-composition');
const scene = JSON.parse(await readFile(join(root, 'artifacts/scene-probe/geometry.json'), 'utf8'));
const source = scene.Root.Children.find(node => node.ID === 'source');
const box = source.Children[0].Primitive.Box;
const edge = scene.Root.Children.find(node => node.ID === '(source -> target)[0]');
const route = edge.Children[0].Primitive.Commands;
const path = route.map(command => `${command.Kind === 0 ? 'M' : 'L'}${command.P1.X} ${command.P1.Y}`).join(' ');

for (const topology of ['foreignObject', 'overlay']) {
  for (const scale of [0.75, 2]) {
    test(`composition ${topology} at ${scale}x`, async ({ page, browser }, info) => {
      await mkdir(output, { recursive: true });
      const name = `${topology}-${scale}`;
      const errors = [];
      const requests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('request', request => requests.push(request.url()));
      const card = `<div xmlns="http://www.w3.org/1999/xhtml" class="consumer-card" data-d2-id="source"><span class="selectable">Select me</span><button type="button">Open</button></div>`;
      const html = `<!doctype html><meta charset="utf-8"><title>Disposable composition probe</title>
<style>
body { margin: 30px; }
.surface { position: relative; width: 260px; height: 100px; transform-origin: top left; transform: scale(${scale}); }
.surface svg { position: absolute; inset: 0; }
.slot { position: absolute; left: ${20 + box.X}px; top: ${20 + box.Y}px; width: ${box.Width}px; height: ${box.Height}px; }
.consumer-card { box-sizing: border-box; width: 100%; height: 100%; padding: 2px; font: 8px/12px Arial; background: #fff9; }
.selectable { display: block; white-space: nowrap; user-select: text; }
.consumer-card button { font: 8px/10px Arial; padding: 0 2px; }
foreignObject { overflow: visible; }
</style>
<div class="surface" data-surface>
<svg width="260" height="100" viewBox="0 0 260 100" aria-label="Fixed D2 geometry">
<g transform="translate(20 20)"><rect data-native-box x="${box.X}" y="${box.Y}" width="${box.Width}" height="${box.Height}" fill="#ff6b6b" stroke="#102a43" stroke-width="3"/>
<path data-route d="${path}" fill="none" stroke="#7b2cbf" stroke-width="4"/>
${topology === 'foreignObject' ? `<foreignObject data-slot x="${box.X}" y="${box.Y}" width="${box.Width}" height="${box.Height}">${card}</foreignObject>` : ''}
</g></svg>
${topology === 'overlay' ? `<div class="slot" data-slot>${card}</div>` : ''}
</div>
<script>
window.events = [];
document.querySelector('[data-surface]').addEventListener('click', event => {
  window.events.push({ id: event.target.closest('[data-d2-id]')?.dataset.d2Id ?? null, target: event.target.tagName });
});
</script>`;
      await writeFile(join(output, `${name}.html`), html);
      await page.setContent(html);
      const button = page.getByRole('button', { name: 'Open', exact: true });
      const metrics = await page.evaluate(() => {
        const rect = selector => {
          const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
          return { x, y, width, height };
        };
        return { box: rect('[data-native-box]'), slot: rect('[data-slot]'), card: rect('.consumer-card'), route: document.querySelector('[data-route]').getAttribute('d') };
      });
      expect(metrics.slot.width).toBeCloseTo(box.Width * scale, 2);
      expect(metrics.slot.height).toBeCloseTo(box.Height * scale, 2);
      expect(metrics.slot.x).toBeCloseTo(metrics.box.x, 2);
      expect(metrics.slot.y).toBeCloseTo(metrics.box.y, 2);
      expect(metrics.card.width).toBeCloseTo(metrics.slot.width, 2);
      await page.keyboard.press('Tab');
      await expect(button).toBeFocused();
      await page.keyboard.press('Enter');
      await button.click();
      expect(await page.evaluate(() => window.events)).toEqual([
        { id: 'source', target: 'BUTTON' }, { id: 'source', target: 'BUTTON' },
      ]);
      const label = await page.locator('.selectable').boundingBox();
      await page.mouse.move(label.x + 1, label.y + label.height / 2);
      await page.mouse.down();
      await page.mouse.move(label.x + label.width - 1, label.y + label.height / 2, { steps: 16 });
      await page.mouse.up();
      const selected = await page.evaluate(() => getSelection().toString());
      expect(selected).toBe('Select me');
      const accessibility = await button.ariaSnapshot();
      expect(accessibility).toContain('button "Open"');
      await page.screenshot({ path: join(output, `${name}-fitted.png`) });

      // Ordinary document CSS reaches both HTML placements unless the consumer scopes/resets it.
      const cleanFont = await button.evaluate(element => getComputedStyle(element).fontSize);
      await page.addStyleTag({ content: 'button { font-size: 20px !important; padding: 12px !important; }' });
      const hostile = await button.evaluate(element => ({ fontSize: getComputedStyle(element).fontSize, width: element.getBoundingClientRect().width }));
      expect(cleanFont).toBe('8px');
      expect(hostile.fontSize).toBe('20px');
      await page.addStyleTag({ content: '.consumer-card button { font: 8px/10px Arial !important; padding: 0 2px !important; }' });
      expect(await button.evaluate(element => getComputedStyle(element).fontSize)).toBe('8px');

      await page.addStyleTag({ content: `.consumer-card { width: ${box.Width * 2}px; height: ${box.Height * 2}px; }` });
      const expanded = await page.evaluate(() => {
        const card = document.querySelector('.consumer-card').getBoundingClientRect();
        const slot = document.querySelector('[data-slot]').getBoundingClientRect();
        const route = document.querySelector('[data-route]');
        const point = route.getPointAtLength(8);
        const matrix = route.getScreenCTM();
        const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
        const containsRoute = screen.x >= card.left && screen.x <= card.right && screen.y >= card.top && screen.y <= card.bottom;
        return { cardWidth: card.width, cardHeight: card.height, slotWidth: slot.width, slotHeight: slot.height, route: route.getAttribute('d'), containsRoute, hitAtRoute: document.elementFromPoint(screen.x, screen.y)?.closest('[data-d2-id]')?.dataset.d2Id ?? null, screen };
      });
      expect(expanded.cardWidth).toBeCloseTo(metrics.card.width * 2, 2);
      expect(expanded.slotWidth).toBeCloseTo(metrics.slot.width, 2);
      expect(expanded.route).toBe(metrics.route);
      expect(expanded.containsRoute).toBe(true);
      expect(expanded.hitAtRoute).toBe('source');
      await page.screenshot({ path: join(output, `${name}-overflow.png`) });
      await page.addStyleTag({ content: '[data-slot] { overflow: hidden; }' });
      const clippedHit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-d2-id]')?.dataset.d2Id ?? null, expanded.screen);
      expect(clippedHit).toBe(null);
      await page.screenshot({ path: join(output, `${name}-clipped.png`) });
      expect(errors).toEqual([]);
      expect(requests).toEqual([]);
      const report = {
        topology, scale, browser: browser.version(), viewport: page.viewportSize(),
        input: { file: 'artifacts/scene-probe/geometry.json', sourceID: source.ID, box, edgeID: edge.ID, path },
        fitted: metrics, selected, events: await page.evaluate(() => window.events), accessibility,
        css: { cleanFont, hostile, scopedResetFont: '8px' }, expanded, clippedHit, errors, requests,
        limits: [
          'Browser primitives with consumer-owned HTML; no React Flow, JointJS or shadcn code is installed or tested.',
          'Uses a real label-free D2 box/route but synthetic Arial text and HTML; no native text/pixel fidelity claim.',
          'Uniform CSS scale only; no browser zoom, nested viewport/scroll, portals, export, Shadow DOM, screen reader or lifecycle proof.',
          'Oversized card intentionally overflows or clips fixed geometry. No measurement-to-D2 relayout handshake is implemented or proven.',
          'Global CSS leak and overflow route obstruction are observed counterexamples, asserted as research outcomes.',
        ],
      };
      await writeFile(join(output, `${name}.json`), `${JSON.stringify(report, null, 2)}\n`);
      await info.attach('observations', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    });
  }
}
