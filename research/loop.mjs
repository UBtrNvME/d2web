import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { goEnv, goProbe, goRun, root } from '../tests/examples.mjs';

// Builds the in-memory compile probe used by research/browser/loop.spec.mjs and records where it lives.
const output = join(root, 'artifacts/research-loop');
mkdirSync(output, { recursive: true });
const probe = goProbe(join(root, 'research/loop.go'), join(output, 'loop'));
// The persistent build adds the js/wasm-only serve file, so it cannot go through goProbe's single-source build.
goRun('go', ['build', '-mod=readonly', '-o', join(output, 'loop-serve.wasm'), join(root, 'research/loop.go'), join(root, 'research/loop-serve.go')], { env: { ...goEnv, GOOS: 'js', GOARCH: 'wasm' } });
console.log(JSON.stringify({ goRoot: probe.goRoot }));
