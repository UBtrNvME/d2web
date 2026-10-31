import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { catalog } from './catalog.mjs';
import { boardTarget, compileAll } from './compile.mjs';

test('catalog board paths map to native D2 targets', () => {
  assert.equal(boardTarget(''), '');
  assert.equal(boardTarget('/layers/one'), 'layers.one');
  assert.equal(boardTarget('/layers/x/scenarios/y'), 'layers.x.scenarios.y');
});

// Feature map step 2: every catalog case compiles with the product worker and produces a scene; results land in artifacts/feature-map/compile.json.
test('every catalog entry compiles to a scene with an association', { timeout: 300_000 }, async () => {
  const results = await compileAll();
  assert.equal(results.length, catalog.length);
  const failed = results.filter(r => !r.ok).map(r => `${r.id}: ${r.error}`);
  assert.deepEqual(failed, [], 'entries that do not compile');
  for (const r of results) {
    assert(r.primitives.length > 0, `${r.id}: no scene primitives`);
    assert(r.objects > 0, `${r.id}: empty association`);
  }
  const wanted = catalog.filter(e => e.boards === 'all');
  for (const e of wanted) assert(results.find(r => r.id === e.id).boards.length > 1, `${e.id}: expected several boards`);
  const baseline = JSON.parse(readFileSync(new URL('./baseline.json', import.meta.url), 'utf8'));
  for (const r of results.filter(r => r.id.startsWith('board/'))) {
    for (const board of r.boards.filter(Boolean)) assert(Object.hasOwn(baseline, `${r.id}#${boardTarget(board)}`), `${r.id}#${boardTarget(board)}: missing paint baseline`);
  }
});
