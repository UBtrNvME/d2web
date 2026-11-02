import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { serve } from '../serve.mjs';

test('built worker dependencies are served with script and wasm MIME types; missing files are 404', async () => {
  assert.ok(existsSync(new URL('../dist/wasm_exec.js', import.meta.url)), 'run mise run editor:build first');
  for (const [url, status, type] of [['/', 200, 'text/html'], ['/worker.js?exec=x', 200, 'text/javascript'], ['/wasm_exec.js', 200, 'text/javascript'], ['/d2web.wasm', 200, 'application/wasm'], ['/missing.js', 404]]) {
    const res = { writeHead(code, headers) { this.code = code; this.headers = headers; return this; }, end(body) { this.body = body; } };
    await serve({ url }, res);
    assert.equal(res.code, status, url);
    if (type) { assert.equal(res.headers['content-type'], type); assert.ok(res.body.length > 0); }
  }
});
