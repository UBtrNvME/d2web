import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';

// Spec 0003 section 6: growth past these is a deliberate decision. Needs `mise run build` first.
const dist = new URL('../dist/', import.meta.url);
const gzipMb = name => gzipSync(readFileSync(new URL(name, dist)), { level: 9 }).length / 1e6;

test('dist has every file the package exports', () => {
  for (const name of ['index.js', 'index.d.ts', 'worker.js', 'wasm_exec.js', 'd2web.wasm', 'NOTICE.txt']) assert.ok(existsSync(new URL(name, dist)), name);
});

test('size budget: wasm 15 MB gzip, index.js 40 KB gzip', () => {
  assert.ok(gzipMb('d2web.wasm') < 15, `d2web.wasm is ${gzipMb('d2web.wasm').toFixed(1)} MB gzipped`);
  assert.ok(gzipMb('index.js') < 0.04, `index.js is ${(gzipMb('index.js') * 1000).toFixed(1)} KB gzipped`);
});
