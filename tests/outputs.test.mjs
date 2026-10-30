import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { scenePairs } from './scene-pairs.mjs';

test('pair every board, rejecting missing and additional web outputs', () => {
  const root = mkdtempSync(join(tmpdir(), 'd2-outputs-'));
  try {
    for (const side of ['native', 'web']) mkdirSync(join(root, side, 'nested'), { recursive: true });
    const native = join(root, 'native'), web = join(root, 'web');
    for (const name of ['index', 'nested/details']) {
      writeFileSync(join(native, `${name}.svg`), '<svg/>');
      writeFileSync(join(web, `${name}.html`), '<div data-d2-scene/>');
    }
    assert.deepEqual(scenePairs(native, web).map(pair => pair.name), ['index.svg', 'nested/details.svg']);
    rmSync(join(web, 'nested/details.html'));
    assert.throws(() => scenePairs(native, web), /Missing or extra/);
    writeFileSync(join(web, 'nested/details.html'), '<div/>');
    writeFileSync(join(web, 'extra.html'), '<div/>');
    assert.throws(() => scenePairs(native, web), /Missing or extra/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('partial native output from a failed compilation cannot become the reference', () => {
  const root = mkdtempSync(join(tmpdir(), 'd2-failed-output-'));
  try {
    writeFileSync(join(root, 'case.json'), '{"status":1}');
    writeFileSync(join(root, 'diagram.svg'), '<svg/>');
    assert.throws(() => scenePairs(root, root), /Native compilation failed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
