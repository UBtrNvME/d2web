import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalog } from './catalog.mjs';
import { compileAll } from './compile.mjs';

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
});
