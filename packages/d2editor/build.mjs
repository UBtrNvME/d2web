// mise run editor:build (spec 0013 §3): packages/d2editor/dist = the page, its bundle and d2web's worker, wasm and notices, as one static site.
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { root } from '../../tests/examples.mjs';

const here = join(root, 'packages/d2editor'), dist = join(here, 'dist'), d2web = join(root, 'packages/d2web/dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
await build({ entryPoints: [join(here, 'src/main.ts')], bundle: true, format: 'esm', minify: true, outfile: join(dist, 'main.js') });
for (const file of ['index.html', 'style.css']) copyFileSync(join(here, file), join(dist, file));
for (const file of ['worker.js', 'wasm_exec.js', 'd2web.wasm', 'NOTICE.txt']) copyFileSync(join(d2web, file), join(dist, file));
console.log(`built ${dist}`);
