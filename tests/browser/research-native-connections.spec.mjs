import { test, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from '../examples.mjs';

const output = join(root, 'artifacts/research-native-connections');
const scene = JSON.parse(await readFile(join(root, 'artifacts/scene-probe/geometry.json'), 'utf8'));
const edge = scene.Root.Children.find(node => node.ID === '(source -> target)[0]');
const edgePath = edge.Children.find(node => node.ID.endsWith(':path'));
const arrow = edge.Children.find(node => node.ID.endsWith(':dst-arrowhead'));
const source = scene.Root.Children.find(node => node.ID === 'source').Children[0].Primitive.Box;
const commandPath = commands => commands.map(command => {
  if (command.Kind === 0) return `M${command.P1.X} ${command.P1.Y}`;
  if (command.Kind === 1) return `L${command.P1.X} ${command.P1.Y}`;
  if (command.Kind === 5) return 'Z';
  throw new Error(`Unsupported scene path command ${command.Kind}`);
}).join(' ');
const route = commandPath(edgePath.Primitive.Commands);
const arrowRoute = commandPath(arrow.Primitive.Commands);

for (const viewportScale of [1, 2]) {
  for (const deviceScaleFactor of [1, 2]) {
  test(`native SVG connection viewport ${viewportScale}x at device scale ${deviceScaleFactor}x`, async ({ browser }, info) => {
    await mkdir(output, { recursive: true });
    const context = await browser.newContext({ deviceScaleFactor, viewport: { width: 700, height: 240 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
    const svgWidth = scene.ViewBox.Width * viewportScale;
    const svgHeight = scene.ViewBox.Height * viewportScale;
    const html = `<!doctype html><meta charset="utf-8"><title>Native SVG connection probe</title>
<style>
body { margin: 24px; font: 12px sans-serif; }
.surface { position: relative; width: ${svgWidth}px; height: ${svgHeight}px; }
svg { display: block; width: 100%; height: 100%; overflow: visible; }
.edge-hit { fill: none; pointer-events: stroke; }
.edge-paint { fill: none; pointer-events: none; }
.edge-arrow { fill: white; stroke: rgb(123 44 191); stroke-width: 4; pointer-events: none; }
.node-overlay { position: absolute; left: ${(source.X - scene.ViewBox.X) * viewportScale}px; top: ${(source.Y - scene.ViewBox.Y) * viewportScale}px; width: ${source.Width * viewportScale}px; height: ${source.Height * viewportScale}px; }
</style>
<div class="surface">
  <svg viewBox="${scene.ViewBox.X} ${scene.ViewBox.Y} ${scene.ViewBox.Width} ${scene.ViewBox.Height}" aria-label="D2 diagram geometry">
    <g data-d2-id="${edge.ID}">
      <path class="edge-hit" data-edge-hit d="${route}" stroke="transparent" stroke-width="24" />
      <path class="edge-paint" data-edge-paint d="${route}" stroke="rgb(123 44 191)" stroke-width="4" stroke-linecap="round" />
      <path class="edge-arrow" data-edge-arrow d="${arrowRoute}" transform="translate(${arrow.Transform.E} ${arrow.Transform.F})" />
    </g>
    <g data-d2-id="source"><rect x="${source.X}" y="${source.Y}" width="${source.Width}" height="${source.Height}" fill="#ff6b6b" stroke="#102a43" stroke-width="3" /></g>
  </svg>
  <div class="node-overlay" data-d2-id="source"><button type="button">source control</button></div>
</div>
<script>
window.events = [];
document.addEventListener('click', event => {
  const owner = event.target.closest('[data-d2-id]');
  if (!owner) { window.events.push({ id: null, target: event.target.tagName }); return; }
  const path = event.target.closest('[data-edge-hit]');
  const matrix = path?.getScreenCTM();
  const point = matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : null;
  window.events.push({ id: owner.dataset.d2Id, target: event.target.tagName,
    documentPoint: point && { x: point.x, y: point.y } });
});
</script>`;
    await page.setContent(html);

    const geometry = await page.evaluate(() => {
      const path = document.querySelector('[data-edge-hit]');
      const point = path.getPointAtLength(path.getTotalLength() / 2);
      const matrix = path.getScreenCTM();
      const screen = (x, y) => new DOMPoint(x, y).matrixTransform(matrix);
      return {
        route: path.getAttribute('d'),
        paintRoute: document.querySelector('[data-edge-paint]').getAttribute('d'),
        paintWidth: Number.parseFloat(getComputedStyle(document.querySelector('[data-edge-paint]')).getPropertyValue('stroke-width')),
        hitWidth: Number.parseFloat(getComputedStyle(path).getPropertyValue('stroke-width')),
        arrowRoute: document.querySelector('[data-edge-arrow]').getAttribute('d'),
        arrowTransform: document.querySelector('[data-edge-arrow]').getAttribute('transform'),
        deviceScaleFactor: window.devicePixelRatio,
        center: { x: point.x, y: point.y },
        hitScreen: screen(point.x, point.y + 7).toJSON(),
        outsideScreen: screen(point.x, point.y + 13).toJSON(),
        hitStrokeComputed: getComputedStyle(path).pointerEvents,
      };
    });
    expect(geometry.deviceScaleFactor).toBe(deviceScaleFactor);
    expect(geometry.route).toBe(route);
    expect(geometry.paintRoute).toBe(route);
    expect(geometry.paintWidth).toBe(4);
    expect(geometry.hitWidth).toBe(24);
    expect(geometry.arrowRoute).toBe(arrowRoute);
    expect(geometry.arrowTransform).toBe(`translate(${arrow.Transform.E} ${arrow.Transform.F})`);

    await page.mouse.click(geometry.hitScreen.x, geometry.hitScreen.y);
    await page.mouse.click(geometry.outsideScreen.x, geometry.outsideScreen.y);
    await expect(page.getByRole('button', { name: 'source control' })).toBeVisible();
    await page.getByRole('button', { name: 'source control' }).click();
    const eventsBeforeUpdate = await page.evaluate(() => structuredClone(window.events));
    expect(eventsBeforeUpdate[0].id).toBe(edge.ID);
    expect(eventsBeforeUpdate[0].target).toBe('path');
    expect(eventsBeforeUpdate[0].documentPoint.x).toBeCloseTo(geometry.center.x, 0);
    expect(eventsBeforeUpdate[0].documentPoint.y).toBeCloseTo(geometry.center.y + 7, 0);
    expect(eventsBeforeUpdate[1]).toEqual({ id: null, target: 'svg' });
    expect(eventsBeforeUpdate[2].id).toBe('source');

    await page.locator('[data-edge-paint]').evaluate(node => { window.beforeUpdateNode = node; });
    await page.locator('[data-edge-paint]').evaluate(node => node.setAttribute('stroke', 'rgb(0 128 0)'));
    await page.locator('[data-edge-hit]').evaluate(node => node.setAttribute('stroke-width', '32'));
    const afterUpdate = await page.evaluate(() => ({
      sameNode: window.beforeUpdateNode === document.querySelector('[data-edge-paint]'),
      paintRoute: document.querySelector('[data-edge-paint]').getAttribute('d'),
      hitRoute: document.querySelector('[data-edge-hit]').getAttribute('d'),
      paint: document.querySelector('[data-edge-paint]').getAttribute('stroke'),
      computedPaint: getComputedStyle(document.querySelector('[data-edge-paint]')).stroke,
      hitWidth: document.querySelector('[data-edge-hit]').getAttribute('stroke-width'),
      computedHitWidth: getComputedStyle(document.querySelector('[data-edge-hit]')).getPropertyValue('stroke-width'),
      arrowTransform: document.querySelector('[data-edge-arrow]').getAttribute('transform'),
    }));
    expect(afterUpdate.sameNode).toBe(true);
    expect(afterUpdate.paintRoute).toBe(route);
    expect(afterUpdate.hitRoute).toBe(route);
    expect(afterUpdate.paint).toBe('rgb(0 128 0)');
    expect(afterUpdate.computedPaint).toBe('rgb(0, 128, 0)');
    expect(afterUpdate.hitWidth).toBe('32');
    expect(afterUpdate.computedHitWidth).toBe('32px');
    expect(afterUpdate.arrowTransform).toBe(geometry.arrowTransform);
    await page.mouse.click(geometry.outsideScreen.x, geometry.outsideScreen.y);
    const expandedHit = await page.evaluate(() => window.events.at(-1));
    expect(expandedHit.id).toBe(edge.ID);
    expect(expandedHit.target).toBe('path');
    // A DOM API mutation updates attributes in place; it does not replace or recalculate the native scene geometry.
    expect(await page.locator('[data-edge-paint]').count()).toBe(1);
    await page.screenshot({ path: join(output, `native-connections-viewport-${viewportScale}x-dsf-${deviceScaleFactor}x.png`) });
    expect(errors).toEqual([]);

    const report = {
      status: 'passed for this browser and this scene case', viewportScale, deviceScaleFactor, browser: browser.version(),
      input: { file: 'artifacts/scene-probe/geometry.json', edgeID: edge.ID, route, sourceBox: source,
        arrowTransform: { e: arrow.Transform.E, f: arrow.Transform.F }, arrowRoute },
      geometry, eventsBeforeUpdate, afterUpdate, expandedHit, errors,
      reactFlowSource: {
        package: '@xyflow/react@12.12.0', file: 'artifacts/research-reactflow/node_modules/.pnpm/@xyflow+react@12.12.0/node_modules/@xyflow/react/dist/esm/index.js',
        observation: 'BaseEdge emits the visible path plus a same-d transparent path with default strokeWidth 20; EdgeWrapper owns events, identity, accessibility and edge state outside BaseEdge.',
      },
      limits: [
        'Native browser SVG and one existing D2 straight-edge scene only; no React, React Flow runtime, shadcn, JointJS or production abstraction.',
        'The scene path commands exercised here are move/line and the closed arrow polygon. Curves, markers, labels, clipping, z-order, multiple edges and all-D2 parity are untested.',
        'Pointer tests use CSS-pixel coordinates at deviceScaleFactor 1 and 2; this is not browser zoom, touch, keyboard, accessibility or performance coverage.',
        'setAttribute preserves the existing SVG path node and its d geometry in this probe; a consumer update policy, event capture lifecycle and scene recomputation are not specified.',
        'The HTML overlay is one positioned button example, not a general node composition or geometry synchronization contract.',
      ],
    };
    await writeFile(join(output, `native-connections-viewport-${viewportScale}x-dsf-${deviceScaleFactor}x.json`), `${JSON.stringify(report, null, 2)}\n`);
    await info.attach('observations', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    await context.close();
  });
  }
}
