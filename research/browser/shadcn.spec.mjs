import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { root } from '../../tests/examples.mjs';

// R6: the real shadcn Card (from the imported Studio, Tailwind compiled with consumer-owned tokens) rendered by React, measured,
// sized through the persistent D2 wasm loop and placed on the compiled boxes. Records token fidelity, convergence, React/loop
// ownership and the theme switch. The Card is borrowed read-only; this is not a packaged integration.
const output = join(root, 'artifacts/research-shadcn');
const { goRoot } = JSON.parse(execFileSync('node', [join(root, 'research/loop.mjs')], { encoding: 'utf8', timeout: 300_000 }).trim().split('\n').pop());
execFileSync('node', [join(root, 'research/shadcn.mjs')], { encoding: 'utf8', timeout: 300_000 });

test('research: real shadcn Card drives the D2 sizing loop', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://host.test/**', route => {
    const file = new URL(route.request().url()).pathname.slice(1) || 'index.html';
    const path = file === 'wasm_exec.js' ? join(goRoot, 'lib/wasm', file) : file === 'loop-serve.wasm' ? join(root, 'artifacts/research-loop', file) : join(output, file);
    return route.fulfill({ body: readFileSync(path), contentType: file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'text/javascript' });
  });
  await page.goto('https://host.test/');
  await page.waitForFunction(() => window.ready);
  const idle = () => page.evaluate(async () => { const before = window.idle ?? 0; while ((window.idle ?? 0) === before) await new Promise(r => setTimeout(r, 10)); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
  // First idle: wait until at least one compile finished and cards are placed.
  await page.waitForFunction(() => window.layoutState && window.stats.compiles >= 1);
  await page.evaluate(async () => { await new Promise(r => setTimeout(r, 300)); });
  const snapshot = () => page.evaluate(() => {
    const cards = Object.fromEntries([...document.querySelectorAll('[data-node]')].map(el => {
      const card = el.firstElementChild, cs = getComputedStyle(card), r = el.getBoundingClientRect();
      return [el.dataset.node, { left: r.left, top: r.top, width: r.width, height: r.height, cardWidth: card.getBoundingClientRect().width, cardHeight: card.getBoundingClientRect().height, background: cs.backgroundColor, radius: cs.borderTopLeftRadius, color: cs.color, slot: card.dataset.slot }];
    }));
    return { cards, measured: window.measuredSizes(), layout: window.layoutState?.nodes, stats: { ...window.stats, steps: [...window.stats.steps] } };
  });
  const first = await snapshot();
  // The node box must equal what the hidden natural-size copy measured, and the visible Card must fill that box.
  const boxEqual = s => Object.entries(s.cards).every(([id, c]) => s.measured[id][0] === s.layout[id].Width && s.measured[id][1] === s.layout[id].Height && Math.abs(c.width - s.layout[id].Width) < 0.5 && Math.abs(c.height - s.layout[id].Height) < 0.5 && Math.abs(c.cardWidth - c.width) < 0.5 && Math.abs(c.cardHeight - c.height) < 0.5);
  // Grow one card's content from React state; the observer on the hidden natural copy drives one recompile.
  const compilesBefore = first.stats.compiles;
  await page.evaluate(() => window.setBody('b', 'Quarterly revenue by region and product line, in euros'));
  await page.waitForFunction(n => window.stats.compiles > n, compilesBefore);
  await page.evaluate(async () => { await new Promise(r => setTimeout(r, 300)); });
  const grown = await snapshot();
  const overlaps = s => { const e = Object.values(s.layout); let n = 0; for (const [i, p] of e.entries()) for (const q of e.slice(i + 1)) if (p.X < q.X + q.Width && q.X < p.X + p.Width && p.Y < q.Y + q.Height && q.Y < p.Y + p.Height) n++; return n; };
  // Theme switch: tokens change colors and radius; sizes are token-independent here, so no recompile is expected.
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.evaluate(async () => { await new Promise(r => setTimeout(r, 300)); });
  const dark = await snapshot();
  const result = {
    errors, firstBoxesEqualMeasured: boxEqual(first), tokens: { light: { bg: first.cards.a.background, radius: first.cards.a.radius, fg: first.cards.a.color, slot: first.cards.a.slot }, dark: { bg: dark.cards.a.background, radius: dark.cards.a.radius, fg: dark.cards.a.color } },
    growth: { compiles: grown.stats.compiles - compilesBefore, widthBefore: first.layout.b.Width, widthAfter: grown.layout.b.Width, heightAfter: grown.layout.b.Height, boxesEqualMeasured: boxEqual(grown), overlaps: overlaps(grown), neighboursMoved: ['a', 'c', 'd'].filter(id => grown.layout[id].X !== first.layout[id].X || grown.layout[id].Y !== first.layout[id].Y).length },
    theme: { extraCompiles: dark.stats.compiles - grown.stats.compiles, boxesEqualMeasured: boxEqual(dark) },
    totals: { compiles: dark.stats.compiles, observerCallbacks: dark.stats.observed, renders: dark.stats.renders, compileMillis: dark.stats.steps },
  };
  writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 1));
  expect(errors).toEqual([]);
  expect(result.firstBoxesEqualMeasured).toBe(true);
  expect(result.tokens.light.slot).toBe('card');
  expect(result.tokens.light.bg).toBe('rgb(240, 245, 250)');
  expect(result.tokens.dark.bg).toBe('rgb(20, 30, 40)');
  expect(result.growth.widthAfter).toBeGreaterThan(result.growth.widthBefore);
  expect(result.growth.boxesEqualMeasured).toBe(true);
  expect(result.growth.overlaps).toBe(0);
});
