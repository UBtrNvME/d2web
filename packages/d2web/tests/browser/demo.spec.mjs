import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { open } from './harness.mjs';
// The Pages demo ships these; one that fails to compile is a broken page (the SQL example once used `Shape`, which D2 reads as the keyword).
test('every demo example compiles, and a Shape-named object is the reserved keyword', async ({ page }) => {
  const html = readFileSync(new URL('../../demo/index.html', import.meta.url), 'utf8');
  const block = html.match(/const examples = (\{[\s\S]*?\n\});/)[1];
  const examples = new Function(`return ${block}`)();
  await open(page, { body: '<div id="a"></div>' });
  const out = await page.evaluate(async examples => {
    const r = {};
    for (const [k, v] of Object.entries(examples)) { const x = await compile(v); r[k] = x.error ? JSON.stringify(x.error) : 'ok'; }
    return r;
  }, examples);
  expect((await page.evaluate(async () => (await compile('Shape: {shape: class\n  +area(): float\n}')).error ? 'error' : 'ok'))).toBe('error');
  expect(Object.values(out).filter(v => v !== 'ok')).toEqual([]);
});
