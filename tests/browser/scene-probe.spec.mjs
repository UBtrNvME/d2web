import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../examples.mjs';

test('D2 scene builder runs in Chromium/WASM with native-equivalent geometry', async ({ page }) => {
  const directory = join(root, 'artifacts/scene-probe');
  const reference = JSON.parse(readFileSync(join(directory, 'native.json'), 'utf8'));
  const source = JSON.parse(readFileSync(join(directory, 'source.json'), 'utf8'));
  const messages = [], errors = [];
  page.on('console', message => {
    if (message.type() === 'log') messages.push(message.text());
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', error => errors.push(error.message));
  const origin = 'http://d2-scene-probe.test';
  await page.route(`${origin}/**`, async route => {
    switch (new URL(route.request().url()).pathname) {
      case '/': return route.fulfill({ contentType: 'text/html', body: '<!doctype html><script src="/wasm_exec.js"></script>' });
      case '/wasm_exec.js': return route.fulfill({ path: join(directory, 'wasm_exec.js') });
      case '/scene-probe.wasm': return route.fulfill({ path: join(directory, 'scene-probe.wasm') });
      default: return route.abort();
    }
  });
  await page.goto(origin);
  const exitCode = await page.evaluate(async source => {
    const go = new Go();
    go.argv = ['scene-probe', source];
    let exitCode;
    go.exit = code => { exitCode = code; };
    const bytes = await (await fetch('/scene-probe.wasm')).arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
    await go.run(instance);
    return exitCode;
  }, source);
  expect(exitCode).toBe(0);
  expect(errors).toEqual([]);
  expect(messages).toHaveLength(1);
  expect(JSON.parse(messages[0])).toEqual(reference);
});
