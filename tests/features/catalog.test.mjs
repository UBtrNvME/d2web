import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalog } from './catalog.mjs';
import { expectedIds } from './source.mjs';

const expected = expectedIds();

test('feature catalog entry ids are unique', () => {
  const ids = catalog.map(entry => entry.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('feature catalog covers every source-derived id', () => {
  const covered = new Set(catalog.flatMap(entry => entry.covers));
  const missing = [...expected].filter(id => !covered.has(id)).sort();
  assert.equal(missing.length, 0, `Missing feature IDs:\n${missing.join('\n')}`);
});

test('feature catalog covers only source-derived ids or explicit extras', () => {
  const covered = new Set(catalog.flatMap(entry => entry.covers));
  const unknown = [...covered].filter(id => typeof id !== 'string' || (!expected.has(id) && !id.startsWith('extra:'))).sort();
  assert.equal(unknown.length, 0, `Unknown feature IDs:\n${unknown.join('\n')}`);
});

test('feature catalog entries have input, a known mechanism and a family', () => {
  const mechanisms = new Set(['compile-only', 'scene-paint', 'interaction']);
  for (const entry of catalog) {
    const hasSource = typeof entry.source === 'string' && entry.source.trim().length > 0;
    const hasFiles = entry.files !== null && typeof entry.files === 'object' && !Array.isArray(entry.files);
    assert(hasSource || hasFiles, `${entry.id}: missing source or files map`);
    assert(mechanisms.has(entry.mechanism), `${entry.id}: unknown mechanism ${entry.mechanism}`);
    assert(typeof entry.family === 'string' && entry.family.trim().length > 0, `${entry.id}: missing family`);
    assert(Array.isArray(entry.covers), `${entry.id}: covers must be an array`);
  }
});
