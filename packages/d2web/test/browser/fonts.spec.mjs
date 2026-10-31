import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diff, open, shot } from './harness.mjs';
import { nativeArgs } from '../../../../tests/examples.mjs';

// Spec 0002 section 6 (fonts) and the slice 1+2 end to end: client + mount in Chromium, light and dark as two requests, compared with native D2.
const source = 'direction: right\ndb: Database { shape: cylinder }\napi: API { style.fill: "#fff4cc" }\nbox: Group { a; b }\napi -> db: query\nbox.a -> api\n';
const hosts = ['a', 'b'].map(id => `<div id="${id}" style="position:absolute;left:0;top:0;visibility:hidden"></div>`).join('');
const families = page => page.evaluate(() => [...document.fonts].map(f => f.family).sort());

test('fonts are registered once, shared by mounts, and released with the last one', async ({ page }) => {
  await open(page, { body: hosts });
  const out = await page.evaluate(async source => {
    const names = () => [...document.fonts].map(f => f.family);
    const result = await compile(source);
    const base = names().length;
    const a = d2web.mount(document.getElementById('a')); await a.update(result);
    const afterA = names().length;
    const b = d2web.mount(document.getElementById('b')); await b.update(result);
    const afterB = names().length;
    a.dispose(); const afterDisposeA = names().length;
    b.dispose(); const afterDisposeB = names().length;
    const c = d2web.mount(document.getElementById('a'), { fonts: 'consumer' }); await c.update(result);
    const consumerMode = names().length;
    c.dispose();
    return { base, afterA, afterB, afterDisposeA, afterDisposeB, consumerMode };
  }, source);
  expect(out.afterA).toBeGreaterThan(out.base);
  expect(out.afterB, 'the second mount reuses the registered families').toBe(out.afterA);
  expect(out.afterDisposeA, 'the first dispose keeps them for the other mount').toBe(out.afterA);
  expect(out.afterDisposeB, 'the last dispose releases them').toBe(out.base);
  expect(out.consumerMode, "fonts: 'consumer' registers nothing").toBe(out.base);
});

test('client plus mount: light and dark as two requests match native D2 within 5%', async ({ page }) => {
  test.setTimeout(120_000);
  // The native SVG is inline in its div; display:block removes the descender gap an inline replaced element would add.
  await open(page, { body: hosts + '<div id="native" style="position:absolute;left:0;top:0;visibility:hidden"></div>', css: '#native svg{display:block}' });
  const ratios = {};
  for (const [name, themeId] of [['light', 0], ['dark', 200]]) {
    const dir = mkdtempSync(join(tmpdir(), 'mount-e2e-'));
    writeFileSync(join(dir, 'main.d2'), source);
    execFileSync('d2', [...nativeArgs.map(a => a.startsWith('--theme=') ? `--theme=${themeId}` : a), join(dir, 'main.d2'), join(dir, 'out.svg')], { encoding: 'utf8', stdio: 'pipe' });
    const nativeSvg = readFileSync(join(dir, 'out.svg'), 'utf8');
    const id = name === 'light' ? 'a' : 'b';
    await page.evaluate(async ({ source, themeId, id, nativeSvg }) => {
      window.mounts ??= {};
      window.mounts[id] = d2web.mount(document.getElementById(id));
      await window.mounts[id].update(await compile(source, { themeId }));
      document.getElementById('native').innerHTML = nativeSvg;
      for (const e of ['a', 'b', 'native']) document.getElementById(e).style.visibility = 'hidden';
    }, { source, themeId, id, nativeSvg });
    const show = async el => { await page.evaluate(el => { for (const e of ['a', 'b', 'native']) document.getElementById(e).style.visibility = e === el ? 'visible' : 'hidden'; }, el); return shot(page, '#' + el); };
    const result = await diff(page, await show('native'), await show(id));
    ratios[name] = result.ratio ?? result;
  }
  expect(ratios.light, JSON.stringify(ratios)).toBeLessThanOrEqual(0.05);
  expect(ratios.dark, JSON.stringify(ratios)).toBeLessThanOrEqual(0.05);
  expect(await diff(page, await shotOf(page, 'a'), await shotOf(page, 'b')), 'dark differs from light').not.toEqual({ ratio: 0 });
});

async function shotOf(page, id) {
  await page.evaluate(id => { for (const e of ['a', 'b']) document.getElementById(e).style.visibility = e === id ? 'visible' : 'hidden'; }, id);
  return shot(page, '#' + id);
}
