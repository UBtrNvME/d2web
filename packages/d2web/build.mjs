import { copyFileSync, globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { goEnv, goRun, root } from '../../tests/examples.mjs';
import { patches } from '../../tests/upstream-patches.mjs';

// mise run build (spec 0003): packages/d2web/dist/ = index.js, index.d.ts, worker.js, wasm_exec.js, d2web.wasm, NOTICE.txt.
const pinned = 'd5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda';
const head = goRun('git', ['rev-parse', 'HEAD']).trim();
if (head !== pinned) throw new Error(`imports/d2 is ${head}, not the pinned ${pinned}; run mise run reference:fetch`);
const patched = patches().some(p => p.state === 'applied');
if (patched && process.env.D2WEB_ALLOW_PATCHED !== '1') throw new Error('imports/d2 has docs/upstream patches applied; revert them (node tests/upstream-patches.mjs --revert) or set D2WEB_ALLOW_PATCHED=1');

const dist = join(root, 'packages/d2web/dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const module = join(root, 'packages/d2web-wasm');
const flags = `-s -w${patched ? ' -X d2web.local/wasm/compile.Patched=true' : ''}`;
goRun('go', ['build', '-mod=readonly', '-trimpath', '-ldflags', flags, '-o', join(dist, 'd2web.wasm'), './cmd/d2web'], { cwd: module, env: { ...goEnv, GOOS: 'js', GOARCH: 'wasm' } });
const goRoot = goRun('go', ['env', 'GOROOT'], { cwd: module, env: goEnv }).trim();
copyFileSync(join(goRoot, 'lib/wasm/wasm_exec.js'), join(dist, 'wasm_exec.js'));
copyFileSync(join(root, 'packages/d2web/src/worker.js'), join(dist, 'worker.js'));
await build({ entryPoints: [join(root, 'packages/d2web/src/index.ts')], bundle: true, format: 'esm', minify: true, outfile: join(dist, 'index.js') });

// Declarations: tsc emits one .d.ts per source file next to index.d.ts; the painter's is hand-written.
goRun('pnpm', ['exec', 'tsc', '-p', 'packages/d2web/tsconfig.build.json'], { cwd: root });
// tsc leaves `.ts` specifiers in declarations; consumers resolve them as `.js`.
for (const file of globSync('*.d.ts', { cwd: dist })) writeFileSync(join(dist, file), readFileSync(join(dist, file), 'utf8').replace(/(from '\.\/[\w-]+)\.ts'/g, "$1.js'"));
copyFileSync(join(root, 'packages/d2web/src/paint.d.ts'), join(dist, 'paint.d.ts'));

const notice = [['D2 (MPL-2.0)', join(root, 'imports/d2/LICENSE.txt')], ['D2 third-party notices', join(root, 'imports/d2/THIRD_PARTY_NOTICES.txt')], ['Go runtime (wasm_exec.js, BSD-3)', join(goRoot, 'LICENSE')]]
  .map(([title, file]) => `==== ${title} ====\n${readFileSync(file, 'utf8')}`).join('\n');
writeFileSync(join(dist, 'NOTICE.txt'), `d2web distributes a WebAssembly build of D2 ${patched ? '(with local patches applied) ' : ''}and Go's wasm_exec.js.\n\n${notice}`);
console.log(`built ${dist}${patched ? ' (patched D2)' : ''}`);
