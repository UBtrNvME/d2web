import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { goProbe, root } from '../tests/examples.mjs';

test('research: compare graph/source/target/scene association across native and WASM', { timeout: 300_000 }, () => {
  const output = join(root, 'artifacts/research-identity');
  mkdirSync(output, { recursive: true });
  const native = join(output, 'probe');
  const probe = goProbe(join(root, 'research/identity.go'), native);
  const workspaces = ['research/identity', 'imports', 'boards'];
  const results = {};
  for (const name of workspaces) {
    const directory = join(root, 'examples', name);
    const files = Object.fromEntries(readdirSync(directory).filter(file => file.endsWith('.d2')).map(file => [file, readFileSync(join(directory, file), 'utf8')]));
    const request = JSON.stringify({ entry: 'main.d2', files });
    const result = JSON.parse(probe.native([request]));
    assert.deepEqual(JSON.parse(probe.native([request])), result, `${name}: repeat native compilation`);
    assert.deepEqual(JSON.parse(probe.wasm([request])), result, `${name}: WASM equivalence`);
    for (const board of result) {
      assert(!board.sceneError, `${name}/${board.path.join('/')}: ${board.sceneError}`);
      const semantic = [...board.objects ?? [], ...board.edges ?? []].map(object => object.id);
      assert.deepEqual([...board.targetIDs ?? []].sort(), [...semantic].sort());
      for (const id of semantic) assert(board.scene.some(node => node.id === id), `${name}: scene association for ${id}`);
      for (const object of [...board.objects ?? [], ...board.edges ?? []]) {
        for (const reference of object.references ?? []) assert(Object.hasOwn(files, reference.path));
      }
    }
    results[name] = result;
    writeFileSync(join(output, name.replaceAll('/', '-') + '.json'), JSON.stringify(result, null, 2) + '\n');
  }
  const boards = results['research/identity'];
  const base = boards.find(board => board.path.length === 1);
  const scenario = boards.find(board => board.path.includes('scenarios'));
  const layer = boards.find(board => board.path.includes('layers'));
  const find = (board, id) => board.objects.find(object => object.id === id);
  assert.equal(find(base, 'imported.child').fillSource.path, 'shared.d2');
  assert.equal(find(scenario, 'imported.child').fillSource.path, 'main.d2');
  assert.equal(find(scenario, 'imported.child').labelSource.path, 'shared.d2');
  const local = find(base, 'local');
  assert.equal(local.fill, '#abcdef');
  assert.notEqual(local.fillSource.range, local.strokeSource.range, 'class fill and glob stroke have distinct owning declarations');
  assert(local.fillSource.range.startsWith('main.d2,3:'), 'effective fill belongs to the class declaration');
  assert(!local.references.some(reference => reference.range.startsWith('main.d2,3:')), 'object reference list does not include the class property declaration');
  assert.equal(find(scenario, 'local').label, 'changed');
  assert.equal(find(layer, 'local').fill, '', 'independent layer does not inherit the root class application');
  assert(boards.every(board => find(board, 'local')), 'the same lexical ID appears in all three boards');
  assert(base.scene.some(node => node.id === ''), 'anonymous paint primitives exist');
  const generated = base.scene.filter(node => node.id && !base.targetIDs.includes(node.id));
  assert(generated.some(node => node.kind === 'd2scene.TextRun'));
  assert(generated.some(node => node.id.endsWith(':dst-arrowhead')));
  const malformed = spawnSync(native, [JSON.stringify({ entry: 'main.d2', files: { 'main.d2': 'a: {' } })], { encoding: 'utf8', timeout: 30_000 });
  assert.ifError(malformed.error);
  assert.notEqual(malformed.status, 0);
  assert.equal(malformed.stdout, '', 'failed input emits no partial association report');
  const counterexamples = {};
  for (const entry of ['collision.d2', 'invisible.d2']) {
    const request = JSON.stringify({ entry, files: { [entry]: readFileSync(join(root, 'examples/research/identity', entry), 'utf8') } });
    const result = JSON.parse(probe.native([request]));
    assert.deepEqual(JSON.parse(probe.wasm([request])), result);
    assert(!result[0].sceneError, result[0].sceneError);
    counterexamples[entry] = result;
  }
  const collision = counterexamples['collision.d2'][0];
  const duplicates = collision.scene.filter((node, index, nodes) => node.id && nodes.findIndex(other => other.id === node.id) !== index);
  assert.equal(duplicates.length, 0, 'the proposed quoted-ID collision does not occur in this case');
  assert(collision.scene.some(node => node.id === 'a:label:0'));
  assert(collision.scene.some(node => node.id === '"a:label:0"'), 'authored AbsID retains quoting, unlike the generated label ID');
  const invisible = counterexamples['invisible.d2'][0];
  assert.equal(invisible.objects[0].label, 'hello');
  assert(invisible.targetIDs.includes('a'));
  assert(invisible.scene.some(node => node.id === 'a'));
  assert(!invisible.scene.some(node => node.kind === 'd2scene.TextRun'), 'invisible label remains semantic but is absent from paint tree');
  writeFileSync(join(output, 'counterexamples.json'), JSON.stringify(counterexamples, null, 2) + '\n');
  writeFileSync(join(output, 'summary.json'), JSON.stringify({
    workspaces: workspaces.length,
    boards: Object.values(results).reduce((sum, value) => sum + value.length, 0),
    repeatedNativeAndNodeWasmEqual: true,
    objectIDsAreBoardLocal: true,
    propertyOwnershipRequiresMoreThanObjectReferences: true,
    collidingSceneIDs: duplicates.map(node => node.id),
    invisibleLabelMissingFromPaintTree: true,
    generatedAndAnonymousPrimitives: generated,
    scope: 'Diagnostic selected-case association; not a public bridge or complete provenance model. Chromium equivalence is not tested by this probe.',
  }, null, 2) + '\n');
});
