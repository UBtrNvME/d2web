import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { root } from '../../../../tests/examples.mjs';

// Spec 0003: pack the package, unpack it as a consumer's node_modules/d2web, and load it with native ESM and no bundler.
// Needs `mise run build` first (test:consumer depends on it).
const consumer = mkdtempSync(join(tmpdir(), 'd2web-consumer-'));
const packed = mkdtempSync(join(tmpdir(), 'd2web-pack-'));
execFileSync('pnpm', ['pack', '--pack-destination', packed], { cwd: join(root, 'packages/d2web'), stdio: 'pipe' });
mkdirSync(join(consumer, 'node_modules/d2web'), { recursive: true });
execFileSync('tar', ['-xzf', join(packed, execFileSync('ls', [packed], { encoding: 'utf8' }).trim()), '-C', join(consumer, 'node_modules/d2web'), '--strip-components=1']);

const html = '<!doctype html><title>consumer</title><script type="module" src="/main.js"></script>';
// An external file, because the CSP case forbids inline scripts.
const script = `import { createClient, spawnWorker } from '/node_modules/d2web/dist/index.js';
const client = createClient({ spawn: spawnWorker() });
window.run = () => client.compile({ revision: 1, files: { 'main.d2': 'a -> b' }, entry: 'main.d2', render: { themeId: 0, sketch: false, pad: 0, scale: 1, center: false } });
window.ready = true;
`;
const types = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html' };

async function serve({ csp, wasmType }) {
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const file = join(consumer, path);
    const headers = csp ? { 'Content-Security-Policy': csp } : {};
    if (path === '/') return res.writeHead(200, { 'Content-Type': 'text/html', ...headers }).end(html);
    if (path === '/main.js') return res.writeHead(200, { 'Content-Type': 'text/javascript', ...headers }).end(script);
    if (!existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': extname(file) === '.wasm' && wasmType ? wasmType : types[extname(file)] ?? 'text/plain', ...headers }).end(readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

for (const [name, options] of [
  ['native ESM, defaults next to the module', {}],
  ['wasm served with the wrong MIME type still loads', { wasmType: 'application/octet-stream' }],
  ['restrictive CSP with only worker-src and wasm-unsafe-eval', { csp: "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'" }],
]) {
  test(name, async ({ page }) => {
    test.setTimeout(120_000);
    const { server, url } = await serve(options);
    try {
      await page.goto(url);
      await page.waitForFunction(() => window.ready);
      const result = await page.evaluate(() => window.run());
      expect(result.diagnostics).toEqual([]);
      expect(result.boards).toHaveLength(1);
    } finally { server.close(); }
  });
}
