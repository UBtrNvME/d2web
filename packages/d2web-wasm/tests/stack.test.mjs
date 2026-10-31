import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { goEnv, goRun, root } from '../../../tests/examples.mjs';

// A WebKit worker has about 1/13 of the main thread's native stack (3.6k against 45k JS frames, measured), and a Go wasm that overflows it never starts.
// goldmark's linkify regexps ({1,256}) once compiled at package init and needed ~450 nested compiler frames. This starts the shipped build under a
// stack Node itself barely fits in (75 KB; the unpatched build failed at it) and requires the Go runtime to reach ready.
const module = join(root, 'packages/d2web-wasm');
const output = join(root, 'artifacts/d2web-wasm-stack');
mkdirSync(output, { recursive: true });
const env = { ...goEnv, GOFLAGS: '-mod=readonly' };
goRun('go', ['build', '-o', join(output, 'd2web.wasm'), './cmd/d2web'], { cwd: module, env: { ...env, GOOS: 'js', GOARCH: 'wasm' } });
const goRoot = goRun('go', ['env', 'GOROOT'], { cwd: module, env }).trim();

test('the wasm starts under a small native stack', () => {
  const script = join(output, 'start.mjs');
  writeFileSync(script, `import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
globalThis.require = createRequire(import.meta.url); globalThis.fs = (await import('node:fs')).default; globalThis.path = (await import('node:path')).default;
globalThis.crypto ??= (await import('node:crypto')).webcrypto;
await import(${JSON.stringify(join(goRoot, 'lib/wasm/wasm_exec.js'))});
const go = new Go(); go.argv = ['d2web', '--serve'];
const { instance } = await WebAssembly.instantiate(readFileSync(${JSON.stringify(join(output, 'd2web.wasm'))}), go.importObject);
let failure;
go.run(instance).catch(error => { failure = error; });
for (let n = 0; n < 1500 && !globalThis.d2webReady && !failure; n++) await new Promise(resolve => setTimeout(resolve, 5));
console.log(failure ? 'failed: ' + failure.message : globalThis.d2webReady ? 'ready' : 'timeout');
process.exit(0);
`);
  assert.equal(execFileSync(process.execPath, ['--stack-size=75', script], { encoding: 'utf8', timeout: 60_000 }).trim(), 'ready');
});
