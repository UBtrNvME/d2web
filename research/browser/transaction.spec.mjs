import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../../tests/examples.mjs';

// R4 in Chromium: replays every request of research/transaction.test.mjs through the same Go/js-wasm probe inside a page
// and requires the results to equal the native ones. Diagnostic: the probe is a CLI main driven through wasm_exec.js, not a
// proposed browser API.
const output = join(root, 'artifacts/research-transaction');
const { goRoot, cases } = JSON.parse(readFileSync(join(output, 'cases.json'), 'utf8'));

test('research: edit wrapper results in Chromium WASM equal native', async ({ page }) => {
  test.setTimeout(300_000);
  await page.route('https://host.test/**', route => {
    const file = new URL(route.request().url()).pathname.slice(1);
    if (file === '') return route.fulfill({ body: '<!doctype html><title>wasm</title>', contentType: 'text/html' });
    return route.fulfill({ body: readFileSync(file === 'probe.wasm' ? join(output, file) : join(goRoot, 'lib/wasm', file)), contentType: file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
  });
  await page.goto('https://host.test/');
  await page.addScriptTag({ url: '/wasm_exec.js' });
  const compiled = await page.evaluate(async () => {
    window.module = await WebAssembly.compileStreaming(fetch('/probe.wasm'));
    return true;
  });
  expect(compiled).toBe(true);
  const results = [];
  for (const { request, result } of cases) {
    // One Go instance per request: main() exits after printing, and wasm_exec instances cannot be restarted.
    const got = await page.evaluate(async request => {
      let out = '';
      const decoder = new TextDecoder();
      globalThis.fs.writeSync = (fd, buf) => { if (fd === 1) out += decoder.decode(buf); return buf.length; };
      const go = new Go();
      go.argv = ['probe', JSON.stringify(request)];
      go.exit = () => {};
      const instance = await WebAssembly.instantiate(window.module, go.importObject);
      await go.run(instance);
      return JSON.parse(out);
    }, request);
    expect(got).toEqual(result);
    results.push(...got.map(r => `${r.name}: ${r.ok ? 'ok' : r.panic ? 'panic' : 'rejected'}`));
  }
  console.log(results.join('\n'));
  expect(results.length).toBeGreaterThan(15);
});
