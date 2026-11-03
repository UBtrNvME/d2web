import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { goEnv, goRun, root } from '../../../../tests/examples.mjs';
import { open, output } from './harness.mjs';

// Spec 0012 in Chromium with the real worker: edit, take the patched text, compile it, repaint; the worker's answers equal the native build's.
goRun('go', ['build', '-mod=readonly', '-o', join(output, 'd2web-native'), './cmd/d2web'], { cwd: join(root, 'packages/d2web-wasm'), env: goEnv });
const native = request => JSON.parse(goRun(join(output, 'd2web-native'), [JSON.stringify(request)], { cwd: root, env: goEnv }));
const stable = r => ({ ...r, id: 0, millis: 0 });

const source = '# services\na: API\nb: DB {shape: cylinder}\na -> b\n';
const requests = [
  { ops: [{ op: 'set', key: 'a.style.fill', value: '#ff0000' }] },
  { ops: [{ op: 'rename', key: 'a', name: 'api' }, { op: 'create', key: 'api -> c' }] },
  { ops: [{ op: 'set', key: 'a.style.opacity', value: '2' }] },
  { ops: [{ op: 'move', key: 'b', parent: 'a' }] },
];

test('edit, apply the patch, repaint; Chromium WASM equals native', async ({ page }) => {
  await open(page, { body: '<div id="host"></div>' });
  const out = await page.evaluate(async ({ source, requests }) => {
    const m = d2web.mount(document.getElementById('host'));
    await m.update(await compile(source));
    const red = () => [...(document.getElementById('host').shadowRoot ?? document).querySelectorAll('*')].some(e => [getComputedStyle(e).backgroundColor, getComputedStyle(e).fill].includes('rgb(255, 0, 0)'));
    const before = red();
    const results = [];
    for (const r of requests) results.push(await client.edit({ revision: 1, files: { 'main.d2': source }, entry: 'main.d2', ...r }));
    const restyled = results[0].patch.text;
    const compiled = await compile(restyled);
    await m.update(compiled);
    const a = d2web.getObject(compiled.boards[0].association, 'a');
    return { before, results, restyled, fill: a.properties.fill?.value, painted: red() };
  }, { source, requests });
  expect(out.restyled).toBe('# services\na: API {style.fill: "#ff0000"}\nb: DB {shape: cylinder}\na -> b\n');
  expect(out.fill).toBe('#ff0000');
  expect([out.before, out.painted]).toEqual([false, true]);
  expect(out.results[2].error.code).toBe('edit');
  expect(out.results[3].ids.renamed).toMatchObject({ b: 'a.b' });
  for (const [i, r] of requests.entries()) {
    expect(stable(out.results[i])).toEqual(stable(native({ v: 2, type: 'edit', id: 0, revision: 1, files: { 'main.d2': source }, entry: 'main.d2', ...r })));
  }
});
