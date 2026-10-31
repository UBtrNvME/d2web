import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { goProbe, root } from '../tests/examples.mjs';
import { patches } from '../tests/upstream-patches.mjs';

test('research: copy-on-write wrapper publishes only recompiling edits (native and Node/WASM agree)', { timeout: 300_000 }, () => {
  const output = join(root, 'artifacts/research-transaction');
  mkdirSync(output, { recursive: true });
  const probe = goProbe(join(root, 'research/transaction.go'), join(output, 'probe'));
  const workspace = (dir, names) => Object.fromEntries(names.map(file => [file, readFileSync(join(root, 'examples/research/join', dir, file), 'utf8')]));
  const cases = []; // requests with their native results, replayed in Chromium by research/browser/transaction.spec.mjs
  const run = request => {
    const result = JSON.parse(probe.native([JSON.stringify(request)]));
    cases.push({ request, result });
    assert.deepEqual(JSON.parse(probe.wasm([JSON.stringify(request)])), result);
    return Object.fromEntries(result.map(r => [r.name, r]));
  };
  // authored glob index reference (* -> *)[*] plus an imported file
  const globbed = run({ entry: 'main.d2', files: workspace('imports', ['main.d2', 'shared.d2']), edits: [
    { name: 'set fill', op: 'set', key: 'x.style.fill', arg: '#112233' },
    { name: 'set opacity 2', op: 'set', key: 'x.style.opacity', arg: '2' },
    { name: 'rename x', op: 'rename', key: 'x', arg: 'z' },
    { name: 'delete first x -> y', op: 'delete', key: '(x -> y)[0]' },
    { name: 'delete missing', op: 'delete', key: 'nope' },
    { name: 'delete imported edge', op: 'delete', key: '(imp.a -> imp.b)[0]' },
  ] });
  // authored numeric index reference without a glob
  const numbered = run({ entry: 'main.d2', files: { 'main.d2': 'a\nb\na -> b: one\na -> b: two\na -> b: three\n(a -> b)[2].style.stroke: red\n' }, edits: [
    { name: 'delete middle', op: 'delete', key: '(a -> b)[1]' },
    { name: 'delete first', op: 'delete', key: '(a -> b)[0]' },
  ] });
  // multi-board file (layer, scenario) plus an imported file that defines its own layer
  const boards = run({ entry: 'main.d2', files: workspace('boards', ['main.d2', 'shared.d2']), edits: [
    { name: 'layer delete first', op: 'delete', key: '(a -> b)[0]', board: ['detail'] },
    { name: 'layer rename a', op: 'rename', key: 'a', arg: 'c', board: ['detail'] },
    { name: 'layer set', op: 'set', key: 'a.style.fill', arg: 'green', board: ['detail'] },
    { name: 'scenario set', op: 'set', key: 'x.style.opacity', arg: '0.5', board: ['alt'] },
    { name: 'scenario full path', op: 'set', key: 'x.style.opacity', arg: '0.5', board: ['scenarios', 'alt'] },
    { name: 'missing board', op: 'set', key: 'a.style.fill', arg: 'red', board: ['nope'] },
    { name: 'imported board', op: 'set', key: 'm.style.fill', arg: 'red', board: ['imp', 'inner'] },
    { name: 'imported object', op: 'set', key: 'imp.p.style.fill', arg: 'red' },
  ] });
  // an edge endpoint renamed inside a layer, with no authored index reference
  const endpoint = run({ entry: 'main.d2', files: { 'main.d2': 'layers: {\n  d: {\n    a -> b: one\n    a -> b: two\n  }\n}\n' }, edits: [
    { name: 'layer rename endpoint', op: 'rename', key: 'a', arg: 'z', board: ['d'] },
  ] })['layer rename endpoint'];
  writeFileSync(join(output, 'native.json'), JSON.stringify({ globbed, numbered, boards }, null, 2) + '\n');
  // minimal reproduction for docs/upstream/d2oracle-delete-glob-index.patch
  const minimal = run({ entry: 'main.d2', files: { 'main.d2': 'x -> y\nx -> y\n(* -> *)[*].style.opacity: 0.8\n' }, edits: [{ name: 'delete first', op: 'delete', key: '(x -> y)[0]' }] });
  // The glob-index patch is opt-in (mise run reference:patch); assert whichever state the checkout is in.
  const applied = name => patches().find(p => p.file.includes(name))?.state === 'applied';
  const patched = applied('glob-index');
  if (patched) {
    assert.equal(minimal['delete first'].ok, true, 'patched oracle deletes the first parallel edge');
    assert.equal(minimal['delete first'].panic, '');
  } else assert.match(minimal['delete first'].panic, /nil pointer/, 'two parallel edges plus a glob index crash the pinned v0.9.0 oracle; if this fails the upstream bug is fixed');
  writeFileSync(join(output, 'cases.json'), JSON.stringify({ goRoot: probe.goRoot, cases }) + '\n');
  const original = workspace('imports', ['main.d2'])['main.d2'];
  assert.equal(globbed['set fill'].ok, true);
  assert.match(globbed['set opacity 2'].error, /opacity/);
  for (const bad of patched ? [globbed['set opacity 2']] : [globbed['set opacity 2'], globbed['delete first x -> y']]) {
    assert.equal(bad.ok, false);
    assert.equal(bad.entry, '', 'wrapper publishes no text for a failed edit');
    assert.notEqual(bad.direct, original, 'the same edit applied in place leaves the live AST changed');
  }
  if (!patched) assert.match(globbed['delete first x -> y'].panic, /nil pointer/, 'oracle panics renumbering the glob reference (* -> *)[*]');
  assert.equal(globbed['rename x'].deltas['(x -> y)[1]'], '(z -> y)[1]');
  assert.match(globbed['rename x'].entry, /\(z -> y\)\[1\]\.style/, 'authored index reference follows the rename');
  assert.equal(globbed['delete missing'].entry, original, 'deleting a missing key succeeds as a no-op');
  assert.match(globbed['delete imported edge'].entry, /imp\.\(a -> b\)\[0\]: null/, 'imported edge is deleted by a local null override; shared.d2 is not rewritten');
  assert.match(numbered['delete middle'].entry, /\(a -> b\)\[1\]\.style\.stroke: red/, 'authored index 2 is renumbered to 1');
  assert.match(numbered['delete first'].entry, /\(a -> b\)\[1\]\.style\.stroke: red/);
  // board edits
  assert.match(boards['layer delete first'].entry, /detail: \{\n {4}a -> b: second\n {4}\(a -> b\)\[0\]\.style\.stroke: red/, 'layer edge delete renumbers the authored index inside the layer');
  assert.match(boards['layer set'].entry, /detail: \{[^}]*a\.style\.fill: green/, 'a layer edit lands inside the layer block');
  assert.match(boards['scenario set'].entry, /alt: \{\n {4}x\.style\.fill: blue\n {4}x\.style\.opacity: 0\.5/, 'a scenario is addressed by its own ID, not scenarios/alt');
  for (const name of ['scenario full path', 'missing board', 'imported board']) {
    assert.match(boards[name].error, /board \[.*\] not found/);
    assert.equal(boards[name].entry, '');
  }
  if (applied('board-rename')) {
    assert.equal(endpoint.ok, true, 'patched oracle renames an edge endpoint inside a layer');
    assert.match(endpoint.entry, /z -> b: one\n {4}z -> b: two/);
    assert.equal(endpoint.deltas['(a -> b)[1]'], '(z -> b)[1]');
  } else {
    assert.equal(endpoint.ok, false);
    assert.match(endpoint.error, /outside of given scope/, 'v0.9.0 refuses: GetWriteableRefs ignores references inside edge keys');
  }
  assert.equal(boards['layer rename a'].ok, false, 'with an authored index reference the layer rename still produces text that does not recompile, patched or not; the wrapper rejects it');
  assert.match(boards['layer rename a'].error, /stroke must be style\.stroke/);
  assert.match(boards['imported object'].entry, /^imp\.p\.style\.fill: red$/m, 'editing an imported object appends a local override to the entry; shared.d2 is not rewritten');
  for (const r of [...Object.values(globbed), ...Object.values(numbered), ...Object.values(boards)]) if (r.ok) assert.equal(r.recompileError, '');
});
