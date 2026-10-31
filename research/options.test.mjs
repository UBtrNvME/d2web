import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { goProbe, root } from '../tests/examples.mjs';

// Contract question: which render options change the built scene, and do they survive native and Node/WASM identically?
// Dark theme is not a scene option (d2scenebuild.Options has ThemeID but no dark id), so "dark" means building again with a dark theme id.
const output = join(root, 'artifacts/research-options');
mkdirSync(output, { recursive: true });
const probe = goProbe(join(root, 'research/options.go'), join(output, 'probe'));
const source = 'a: Service {shape: cylinder}\nb: Client\na -> b: calls\n';
const run = (theme, sketch) => JSON.parse(probe.native([source, String(theme), String(sketch)]));

test('theme id, dark theme id and sketch each change the scene and agree between native and Node/WASM', { timeout: 300_000 }, () => {
  const light = run(0, false);
  const other = run(4, false);
  const dark = run(200, false);
  const sketch = run(0, true);
  assert.notDeepEqual(other.fills, light.fills, 'theme id reaches the scene');
  assert.notDeepEqual(dark.fills, light.fills, 'a dark theme id reaches the scene');
  assert.notDeepEqual(dark.fills, other.fills);
  assert.equal(sketch.nodes > 0, true);
  assert.notEqual(sketch.commands, light.commands, 'sketch changes path data');
  assert.deepEqual(JSON.parse(probe.wasm([source, '200', 'false'])), dark);
  assert.deepEqual(JSON.parse(probe.wasm([source, '0', 'true'])), sketch);
});
