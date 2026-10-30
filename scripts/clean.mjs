import { lstatSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const studio = 'imports/d2-architecture-studio';
const paths = [
  'artifacts', '.cache', '.pnpm-store', 'dist', 'coverage',
  'node_modules/.cache', 'node_modules/.vite', 'node_modules/.pnpm-store',
  ...['dist', '.next', '.vinext', '.cache', '.pnpm-store', 'coverage',
    'tsconfig.tsbuildinfo', 'node_modules/.cache', 'node_modules/.vite',
    '.sites-runtime/pnpm-store', '.sites-runtime/wrangler/logs',
  ].map(path => `${studio}/${path}`),
];

// Refuse symlinked parents so cleanup cannot escape into another checkout.
for (const path of paths) {
  let parent = root;
  for (const segment of path.split('/').slice(0, -1)) {
    parent = join(parent, segment);
    if (lstatSync(parent, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error(`Refusing cleanup through symlink: ${parent}`);
    }
  }
}
for (const path of paths) {
  rmSync(join(root, path), { recursive: true, force: true });
  console.log(`Removed ${path}`);
}
