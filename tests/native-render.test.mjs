import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { examples, nativeArgs, root } from './examples.mjs';

const full = process.env.D2_FULL === '1';
const outputRoot = join(root, full ? 'artifacts/native-corpus' : 'artifacts/native');
rmSync(outputRoot, { recursive: true, force: true });
for (const example of examples(full)) {
  for (const run of example.runs) {
    test(`${example.id}/${run.id}: native TALA rendering`, () => {
      const directory = join(root, example.directory);
      const output = join(outputRoot, example.id, run.id);
      mkdirSync(output, { recursive: true });
      assert(existsSync(join(directory, run.entry)), 'Example missing; see examples/README.md');
      const args = [...nativeArgs, ...(run.args ?? []), run.entry, join(output, 'diagram.svg')];
      const result = spawnSync('d2', args, { cwd: directory, encoding: 'utf8', timeout: 40_000, maxBuffer: 8 * 1024 * 1024 });
      writeFileSync(join(output, 'stdout.txt'), result.stdout ?? '');
      writeFileSync(join(output, 'stderr.txt'), result.stderr ?? '');
      writeFileSync(join(output, 'case.json'), JSON.stringify({ example, run, args, status: result.status }, null, 2) + '\n');
      if (result.error) throw result.error;
      assert.equal(result.status, 0, result.stderr);
      const svgs = readdirSync(output, { recursive: true }).filter(path => path.endsWith('.svg')).sort();
      assert(svgs.length, 'No SVG output');
      if (run.outputs) assert.deepEqual(svgs, run.outputs);
      for (const path of svgs) assert.match(readFileSync(join(output, path), 'utf8'), /<svg[\s>]/);
    });
  }
}
