import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../../tests/examples.mjs';
import { paintScene } from '../../tests/scene-paint.mjs';

// Accessibility grouping probe: the HTML-first painter can name every D2 object and connection from the scene's own IDs and
// label runs, without changing paint. Records the accessibility tree, Tab order against paint order, and pixel identity.
const output = join(root, 'artifacts/research-census');
const boards = ['files__chess__tala', 'files__markdown__tala', 'files__label_positions__tala', 'txtar__md-tables__tala'];

test('research: HTML-first accessibility grouping per D2 object', async ({ page }) => {
  const results = {};
  for (const name of boards) {
    const data = JSON.parse(readFileSync(join(output, 'export', name + '.json'), 'utf8'));
    const shell = html => `<!doctype html><body style="margin:0;background:#fff"><style>*{margin:0}</style><div id="scene">${html}</div></body>`;
    const shoot = async options => {
      await page.setContent(shell(paintScene(data.scene, { html: true, ...options }).html));
      return page.locator('#scene').screenshot({ animations: 'disabled' });
    };
    const plain = await shoot({});
    const grouped = await shoot({ a11y: true });
    const groups = await page.locator('[role=group][tabindex="0"]').evaluateAll(els => els.map(el => el.getAttribute('aria-label')));
    const aria = await page.locator('#scene').ariaSnapshot();

    // Tab through the whole page; the stops must be exactly the groups, in paint order.
    const stops = [];
    for (let i = 0; i < groups.length + 2; i++) {
      await page.keyboard.press('Tab');
      stops.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null));
    }
    results[name] = {
      pixelsIdentical: plain.equals(grouped), groups: groups.length,
      tabStopsMatchPaintOrder: JSON.stringify(stops.slice(0, groups.length)) === JSON.stringify(groups),
      // links inside the scene are real focus stops too; they follow the groups in tab order
      extraFocusStops: (await page.locator('#scene a[href], #scene [tabindex]').count()) - groups.length,
      ariaGroupLines: aria.split('\n').filter(l => l.includes('- group')).length, ariaHead: aria.slice(0, 300), sample: groups.slice(0, 6),
    };
  }
  writeFileSync(join(output, 'a11y.json'), JSON.stringify(results, null, 1));
  console.log(JSON.stringify(results, null, 1));
  for (const r of Object.values(results)) {
    expect(r.groups).toBeGreaterThan(0);
    expect(r.pixelsIdentical).toBe(true);
    expect(r.tabStopsMatchPaintOrder).toBe(true);
  }
});
