import assert from 'node:assert/strict';
import { existsSync, globSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { examples, root } from './examples.mjs';

test('fast and full suites use checked-in examples with complete input trees', () => {
  const fast = examples();
  const full = examples(true);
  assert.equal(fast.flatMap(example => example.runs).length, 4);
  assert.equal(full.flatMap(example => example.runs).length, 147);
  assert.equal(new Set(full.map(example => example.id)).size, full.length);
  const entries = new Set();
  for (const example of full) {
    const directory = resolve(root, example.directory);
    const local = relative(join(root, 'examples'), directory);
    assert(local !== '..' && !local.startsWith(`..${sep}`), example.id);
    assert.equal(example.source, undefined, 'Archive cases must be ordinary files');
    for (const run of example.runs) {
      const entry = join(directory, run.entry);
      assert(existsSync(entry), entry);
      entries.add(entry);
    }
  }
  for (const path of globSync(['files/*.d2', 'archives/*/*.d2'], { cwd: join(root, 'examples') })) {
    assert(entries.has(join(root, 'examples', path)), `Unregistered example: ${path}`);
  }
  for (const path of ['files/icon.svg', 'imports/x.d2', 'imports/y.d2', 'imports/p.d2', 'boards/x.d2', 'boards/y.d2']) {
    assert(existsSync(join(root, 'examples', path)), `Missing supporting file: ${path}`);
  }
});
