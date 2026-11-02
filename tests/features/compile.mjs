import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { goEnv, goRun, root } from '../examples.mjs';
import { normalizeCompileRequest } from '../../packages/d2web/src/request.ts';
import { catalog } from './catalog.mjs';

// Feature map step 2: every catalog entry compiled by the product worker (native build, same code as the wasm), TALA unless the entry says otherwise.
export const output = join(root, 'artifacts/feature-map');
const defaults = { themeId: 0, sketch: false, pad: 0, scale: 1, center: false };

// shortcut: catalog board names are simple identifiers; quote segments if cases add literal dots or slashes.
export const boardTarget = path => path.slice(1).replaceAll('/', '.');

export const requestFor = (entry, id = 1) => JSON.stringify(normalizeCompileRequest({
  v: 2, type: 'compile', id, revision: 1, entry: 'main.d2', files: { 'main.d2': entry.source, ...entry.files },
  render: { ...defaults, ...entry.render }, boards: entry.boards ?? [''], ...(entry.layout ? { layout: entry.layout } : {}),
}));

// Distinct scene primitive types (the `$` tags) used by one board, to show which painter code each feature needs.
const primitives = scene => {
  const kinds = new Set();
  const walk = node => { if (node.Primitive?.$) kinds.add(node.Primitive.$); (node.Children ?? []).forEach(walk); };
  walk(scene.Root);
  return [...kinds].sort();
};

export function summarize(entry, result) {
  if (result.error) return { id: entry.id, ok: false, error: `${result.error.code}: ${result.error.message}`, diagnostics: result.error.diagnostics.map(d => d.message) };
  return {
    id: entry.id, ok: true, boards: result.boards.map(b => b.path), millis: result.millis, warnings: result.diagnostics.map(d => d.message),
    primitives: [...new Set(result.boards.flatMap(b => primitives(b.scene)))].sort(), objects: result.boards.reduce((n, b) => n + b.association.objects.length, 0),
  };
}

export async function compileAll(concurrency = 4) {
  mkdirSync(output, { recursive: true });
  const binary = join(output, 'd2web');
  goRun('go', ['build', '-mod=readonly', '-o', binary, './cmd/d2web'], { cwd: join(root, 'packages/d2web-wasm'), env: { ...goEnv, GOFLAGS: '-mod=readonly' } });
  const results = new Array(catalog.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < catalog.length; i = next++) {
      const entry = catalog[i];
      const stdout = await new Promise(resolve => execFile(binary, [requestFor(entry)], { maxBuffer: 1 << 28, timeout: 120_000 }, (error, out) => resolve(error ? JSON.stringify({ error: { code: 'internal', message: String(error.message).slice(0, 200), diagnostics: [] } }) : out)));
      results[i] = summarize(entry, JSON.parse(stdout));
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  writeFileSync(join(output, 'compile.json'), JSON.stringify(results, null, 1));
  return results;
}
