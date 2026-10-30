import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));

export function examples(full = false) {
  const cases = JSON.parse(readFileSync(join(root, 'examples/cases.json'), 'utf8'));
  if (!full) return cases;
  for (const path of [...globSync(['files/*.d2', 'archives/*/*.d2'], { cwd: join(root, 'examples') })].sort()) {
    cases.push({ id: path.replace(/^archives\//, '').slice(0, -3), directory: 'examples', runs: [{ id: 'tala', entry: path }] });
  }
  return cases;
}
