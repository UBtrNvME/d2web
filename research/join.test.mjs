import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { goProbe, root } from '../tests/examples.mjs';

// Stress the scene<->semantic join: object IDs vs scene node IDs under edits.
test('research: join stability under rename, parallel-edge deletion and structured content', { timeout: 300_000 }, () => {
  const output = join(root, 'artifacts/research-join');
  mkdirSync(output, { recursive: true });
  const probe = goProbe(join(root, 'research/identity.go'), join(output, 'probe'));
  const compile = name => {
    const entry = name + '.d2';
    const request = JSON.stringify({ entry, files: { [entry]: readFileSync(join(root, 'examples/research/join', entry), 'utf8') } });
    const result = JSON.parse(probe.native([request]));
    assert.deepEqual(JSON.parse(probe.wasm([request])), result, `${name}: native/WASM equivalence`);
    assert(!result[0].sceneError, result[0].sceneError);
    return result[0];
  };
  const semantic = board => [...board.objects, ...board.edges];
  const all = Object.fromEntries(['rename-before', 'rename-after', 'parallel-before', 'parallel-after', 'structured'].map(n => [n, compile(n)]));
  const findings = {};

  // Every semantic ID must have a scene node; report the ones that do not.
  for (const [name, board] of Object.entries(all)) {
    const ids = new Set(board.scene.map(node => node.id));
    findings[name] = { unmatched: semantic(board).map(o => o.id).filter(id => !ids.has(id)) };
  }

  // Rename: the renamed object has a new ID; untouched objects keep theirs; old ID gone from the scene.
  const before = all['rename-before'], after = all['rename-after'];
  const sceneIDs = board => new Set(board.scene.map(node => node.id).filter(Boolean));
  assert(sceneIDs(before).has('a') && !sceneIDs(after).has('a'), 'rename: old ID disappears from the scene');
  assert(sceneIDs(after).has('x'), 'rename: new ID appears');
  assert(sceneIDs(after).has('b') && sceneIDs(after).has('c'), 'rename: unrenamed objects keep IDs');
  const edgeIDs = board => board.edges.map(e => e.id);
  findings.rename = { edgesBefore: edgeIDs(before), edgesAfter: edgeIDs(after), note: 'ID alone cannot tell rename from delete+create; the join needs source ranges or a caller-supplied mapping.' };
  assert.notDeepEqual(edgeIDs(before), edgeIDs(after), 'rename: edges touching the renamed object change ID');

  // Parallel edges: IDs are index-based, so deleting the middle edge changes the survivor's ID.
  const pb = all['parallel-before'], pa = all['parallel-after'];
  const labelOf = (board, id) => board.edges.find(e => e.id === id)?.label;
  findings.parallel = { before: pb.edges.map(e => [e.id, e.label]), after: pa.edges.map(e => [e.id, e.label]) };
  const survivor = pa.edges.find(e => e.label === 'three');
  const wasThree = pb.edges.find(e => e.label === 'three');
  assert.notEqual(survivor.id, wasThree.id, 'parallel: surviving edge "three" changes ID after deleting "two"');
  assert.notEqual(labelOf(pa, wasThree.id), 'three', 'parallel: the old ID now names a different edge');

  // Structured/generated content: which scene nodes have no semantic owner?
  const st = all.structured;
  const owned = new Set(semantic(st).map(o => o.id));
  const extra = st.scene.filter(node => node.id && !owned.has(node.id));
  findings.structured = { semanticIDs: [...owned], generatedSceneNodes: extra };
  const orphaned = extra.filter(node => ![...owned].some(id => node.id.startsWith(id)));
  findings.structured.generatedWithoutIDPrefixOwner = orphaned;

  // Late results: a stale report's IDs resolve to different source after an edit.
  const staleFor = (b1, b2) => semantic(b1).filter(o => { const m = semantic(b2).find(p => p.id === o.id); return m && JSON.stringify(m.references) !== JSON.stringify(o.references); }).map(o => o.id);
  findings.stale = { sameIDDifferentSource: staleFor(pb, pa), note: 'an ID reused across revisions can point at different source; a join key needs a revision tag.' };

  // Multi-file workspaces: imported edges, class/glob-derived styles, and edits that shift indices.
  const workspace = name => {
    const dir = join(root, 'examples/research/join', name);
    const request = JSON.stringify({ entry: 'main.d2', files: Object.fromEntries(readdirSync(dir).map(f => [f, readFileSync(join(dir, f), 'utf8')])) });
    return { request, run: () => probe.native([request]) };
  };
  const imp = JSON.parse(workspace('imports').run());
  assert.deepEqual(JSON.parse(probe.wasm([workspace('imports').request])), imp, 'imports: native/WASM equivalence');
  const edge = (board, id) => board[0].edges.find(e => e.id === id);
  assert.deepEqual(imp[0].edges.map(e => [e.id, e.references[0].path]), [['imp.(a -> b)[0]', 'shared.d2'], ['imp.(a -> b)[1]', 'shared.d2'], ['imp.(a -> b)[2]', 'main.d2'], ['(x -> y)[0]', 'main.d2'], ['(x -> y)[1]', 'main.d2']], 'imported edges keep their file; a local edge on the same pair continues the index');
  assert(imp[0].scene.some(n => n.id === 'imp.(a -> b)[2]:path'), 'scene has nodes for imported and local edges');
  const hot = edge(imp, '(x -> y)[0]');
  assert(hot.styles.stroke.source.range.startsWith('main.d2,1:'), 'class-derived stroke points at the class declaration');
  assert(!hot.references.some(r => r.range === hot.styles.stroke.source.range), 'and that declaration is not among the edge references');
  assert.equal(edge(imp, '(x -> y)[1]').styles['stroke-width'].value, '5');
  assert(edge(imp, '(x -> y)[1]').styles.opacity.source.range === edge(imp, '(x -> y)[0]').styles.opacity.source.range, 'one glob declaration owns the opacity of several edges');
  const shifted = JSON.parse(workspace('imports-shift').run());
  const localExtra = e => e.label === 'local extra';
  findings.imports = { before: edge(imp, 'imp.(a -> b)[2]').label, afterShiftIDs: shifted[0].edges.filter(e => e.id.startsWith('imp.')).map(e => [e.id, e.label]) };
  assert.equal(shifted[0].edges.find(localExtra).id, 'imp.(a -> b)[3]', 'inserting an edge in the imported file renumbers the local edge');
  const deleted = spawnSync(probe.binary ?? join(output, 'probe'), [workspace('imports-delete').request], { encoding: 'utf8', timeout: 60_000 });
  assert.notEqual(deleted.status, 0);
  assert.match(deleted.stderr, /indexed edge does not exist/, 'deleting an edge leaves an authored (x -> y)[1] reference dangling and the document stops compiling');
  findings.imports.deleteFirstEdgeError = deleted.stderr.trim();

  writeFileSync(join(output, 'findings.json'), JSON.stringify(findings, null, 2) + '\n');
});
