import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { root } from '../tests/examples.mjs';

// Builds the R6 consumer: the real shadcn Card from the imported Studio (read only), compiled Tailwind CSS with consumer-owned
// theme tokens, and a React entry that measures the cards and drives the persistent D2 wasm sizing loop.
const output = join(root, 'artifacts/research-shadcn');
mkdirSync(output, { recursive: true });
// The Studio is a separate ignored checkout; a linked worktree reads the main checkout's copy.
const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim();
const studio = [join(root, 'imports/d2-architecture-studio'), resolve(root, common, '..', 'imports/d2-architecture-studio')].find(p => existsSync(join(p, 'components/ui/card.tsx')));
if (!studio) throw new Error('imports/d2-architecture-studio not found');
execFileSync('node', [join(root, 'research/loop.mjs')], { encoding: 'utf8', timeout: 300_000 });

await build({
  entryPoints: [join(root, 'research/shadcn-entry.jsx')], outfile: join(output, 'app.js'), bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic',
  alias: { react: join(root, 'node_modules/react'), 'react-dom': join(root, 'node_modules/react-dom'), '@': studio },
});
const req = createRequire(realpathSync(join(studio, 'node_modules/@tailwindcss/postcss/package.json')));
const postcss = req('postcss');
const tailwind = (await import(pathToFileURL(req.resolve('@tailwindcss/postcss')))).default;
const css = `@import "tailwindcss" source(none);
@source "${join(studio, 'components/ui/card.tsx')}";
@source "${join(root, 'research/shadcn-entry.jsx')}";
@theme inline { --color-card: var(--card); --color-card-foreground: var(--card-foreground); --color-border: var(--border); --color-muted-foreground: var(--muted-foreground); --radius-xl: calc(var(--radius) + 4px); }
:root{--card:rgb(240,245,250);--card-foreground:rgb(10,20,30);--border:rgb(100,110,120);--muted-foreground:rgb(90,100,110);--radius:8px}
.dark{--card:rgb(20,30,40);--card-foreground:rgb(230,240,250);--border:rgb(150,160,170);--muted-foreground:rgb(170,180,190);--radius:12px}
body{margin:0;font-family:system-ui}
`;
writeFileSync(join(output, 'theme.css'), (await postcss([tailwind()]).process(css, { from: join(studio, 'research-only.css') })).css);
writeFileSync(join(output, 'index.html'), '<!doctype html><link rel="stylesheet" href="/theme.css"><div id="app"></div><script src="/wasm_exec.js"></script><script type="module" src="/app.js"></script>');
console.log(JSON.stringify({ studio: studio.replace(root, '.'), tailwind: JSON.parse(readFileSync(join(studio, 'node_modules/@tailwindcss/postcss/package.json'), 'utf8')).version }));
