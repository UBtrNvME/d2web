// Scene-feature census over the whole example corpus (native only). Observations, not parity: it shows what a browser
// renderer would have to paint and which boards the scene builder refuses.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { examples, goRun, root } from '../tests/examples.mjs';

const output = join(root, 'artifacts/research-census');
mkdirSync(output, { recursive: true });
const binary = join(output, 'probe');
// Per-run root-board text runs and native SVG for research/browser/census.spec.mjs; fonts are shared by asset ID.
const exports = join(output, 'export');
rmSync(exports, { recursive: true, force: true });
mkdirSync(join(output, 'fonts'), { recursive: true });
mkdirSync(exports, { recursive: true });
goRun('go', ['build', '-mod=readonly', '-o', binary, join(root, 'research/census.go')]);

const runs = examples(true).flatMap(example => example.runs.map(run => ({ id: `${example.id}/${run.id}`, dir: join(root, example.directory), entry: run.entry })));
const results = {};
const exec = promisify(execFile);
const queue = [...runs];
await Promise.all(Array.from({ length: 4 }, async () => {
  for (let run; (run = queue.pop());) {
    try {
      const { stdout } = await exec(binary, [run.dir, run.entry, join(output, 'fonts')], { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
      results[run.id] = JSON.parse(stdout);
      const { export: data, ...rest } = results[run.id];
      results[run.id] = rest;
      if (data) writeFileSync(join(exports, run.id.replaceAll('/', '__') + '.json'), JSON.stringify(data));
    } catch (error) {
      results[run.id] = { error: `probe: ${error.message.split('\n')[0]}`, boards: [] };
    }
  }
}));
writeFileSync(join(output, 'census.json'), JSON.stringify(results, null, 2));

const sum = (key) => {
  const total = {};
  for (const r of Object.values(results)) for (const b of r.boards) for (const [k, v] of Object.entries(b[key] ?? {})) total[k] = (total[k] ?? 0) + v;
  return total;
};
const boards = Object.values(results).flatMap(r => r.boards);
const refused = Object.entries(results).flatMap(([id, r]) => r.error ? [[id, '(compile) ' + r.error]] : r.boards.filter(b => b.error).map(b => [`${id}${b.path}`, b.error]));
const reasons = {};
for (const [, message] of refused) reasons[message.slice(0, 110)] = (reasons[message.slice(0, 110)] ?? 0) + 1;
const featureRuns = key => Object.fromEntries(Object.keys(sum(key)).map(k => [k, Object.values(results).filter(r => r.boards.some(b => b[key]?.[k])).length]));
const summary = { runs: runs.length, boards: boards.length, boardsBuilt: boards.filter(b => !b.error).length, runsWithRefusal: refused.length, primitives: featureRuns('primitives'), paints: featureRuns('paints'), filters: featureRuns('filters'), features: featureRuns('features'), assets: featureRuns('assets'), refusalReasons: reasons };
writeFileSync(join(output, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
// Tripwire, not a support claim: today every board builds offline with local files resolved and remote images unavailable.
assert.equal(Object.keys(results).length, runs.length);
assert.deepEqual(refused, [], 'scene builder refused boards');
