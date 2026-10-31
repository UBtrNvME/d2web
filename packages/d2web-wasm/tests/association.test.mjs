import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { goEnv, goRun, root } from '../../../tests/examples.mjs';
import { normalizeCompileRequest } from '../../d2web/src/request.ts';

// Spec 0004: the association payload of each board, from the same native and Node/WASM builds protocol.test.mjs uses.
// Own build directory: node --test runs files in parallel and protocol.test.mjs rebuilds artifacts/d2web-wasm.
const module = join(root, 'packages/d2web-wasm');
const output = join(root, 'artifacts/d2web-wasm-association');
mkdirSync(output, { recursive: true });
const env = { ...goEnv, GOFLAGS: '-mod=readonly' };
goRun('go', ['build', '-o', join(output, 'd2web'), './cmd/d2web'], { cwd: module, env });
goRun('go', ['build', '-o', join(output, 'd2web.wasm'), './cmd/d2web'], { cwd: module, env: { ...env, GOOS: 'js', GOARCH: 'wasm' } });
const goRoot = goRun('go', ['env', 'GOROOT'], { cwd: module, env }).trim();
const render = { themeId: 0, sketch: false, pad: 0, scale: 1, center: false };
const request = (files, patch = {}) => JSON.stringify(normalizeCompileRequest({ v: 1, type: 'compile', id: 1, revision: 1, files, entry: 'main.d2', render, boards: 'all', ...patch }));
const run = (binary, args) => JSON.parse(goRun(binary, args, { cwd: output, env, timeout: 60_000 }));
const native = json => run(join(output, 'd2web'), [json]);
const wasm = json => run(join(goRoot, 'lib/wasm/go_js_wasm_exec'), [join(output, 'd2web.wasm'), json]);
const byId = (board, id) => board.association.objects.find(o => o.id === id);

test('shapes and connections: kind, label, parent, endpoints, references, scene nodes', () => {
  const r = native(request({ 'main.d2': 'a: Service {\n  inner\n}\nb: Client\na -> b: calls\n' }));
  const board = r.boards[0];
  const [a, inner, b, edge] = ['a', 'a.inner', 'b', '(a -> b)[0]'].map(id => byId(board, id));
  assert.deepEqual([a.kind, a.label, a.parent], ['shape', 'Service', undefined]);
  assert.deepEqual([inner.kind, inner.parent], ['shape', 'a']);
  assert.deepEqual([edge.kind, edge.label, edge.src, edge.dst], ['connection', 'calls', 'a', 'b']);
  assert.equal(a.references[0].path, 'main.d2');
  assert.deepEqual(a.references[0].start, { line: 0, column: 0, offset: 0 });
  assert.deepEqual(b.references[0].start, { line: 3, column: 0, offset: 23 });
  assert(a.nodes.includes('a') && edge.nodes.includes('(a -> b)[0]:path'), 'scene nodes are listed explicitly');
});

test('positions: column and offset count UTF-16 units (usable as JS string indices)', () => {
  const b = byId(native(request({ 'main.d2': 'a: "😀"; b\n' })).boards[0], 'b');
  assert.deepEqual(b.references[0].start, { line: 0, column: 9, offset: 9 });
});

test('content roles', () => {
  const src = 't: { shape: sql_table; id: int }\nk: { shape: class; +f: int }\nm: |md # hi |\nl: |`go x := 1 `|\n';
  const board = native(request({ 'main.d2': src })).boards[0];
  assert.deepEqual(['t', 'k', 'm', 'l'].map(id => byId(board, id).content), ['sql_table', 'class', 'markdown', 'code']);
});

test('multi-file workspaces: native equals Node/WASM; imported declarations keep their file', { timeout: 300_000 }, () => {
  for (const name of ['research/identity', 'imports', 'boards']) {
    const directory = join(root, 'examples', name);
    const files = Object.fromEntries(readdirSync(directory).filter(f => f.endsWith('.d2') && !['collision.d2', 'invisible.d2'].includes(f)).map(f => [f, readFileSync(join(directory, f), 'utf8')]));
    const json = request(files);
    const n = native(json);
    assert.equal(n.error, undefined, name);
    assert.deepEqual({ ...wasm(json), millis: 0 }, { ...n, millis: 0 }, name);
    if (name === 'research/identity') assert.equal(byId(n.boards[0], 'imported.child').references.at(-1).path === 'shared.d2' || byId(n.boards[0], 'imported.child').references.some(s => s.path === 'shared.d2'), true);
  }
});

test('a failed compile has no association (and no boards)', () => {
  const r = native(request({ 'main.d2': 'a -> {' }));
  assert.equal(r.boards, undefined);
});

// Spec 0004 section 6: every scene node except the two helper nodes belongs to exactly one object, over the example corpus.
test('every scene node of the example corpus has exactly one owner', { timeout: 600_000 }, () => {
  const helpers = new Set(['root', 'root:background']);
  // Anonymous nodes (empty ID) have no name to list; they belong to the nearest ancestor that is owned or a helper.
  const unowned = (n, owned, covered = false) => {
    const ok = covered || helpers.has(n.ID) || owned.includes(n.ID);
    return [...(ok ? [] : [n.ID]), ...n.Children.flatMap(c => unowned(c, owned, ok))];
  };
  let boards = 0;
  const failures = [], orphans = [];
  for (const file of readdirSync(join(root, 'examples/files')).filter(f => f.endsWith('.d2'))) {
    const text = readFileSync(join(root, 'examples/files', file), 'utf8');
    const r = native(request({ 'main.d2': text }));
    if (r.error) { failures.push(`${file}: ${r.error.message}`); continue; }
    for (const board of r.boards) {
      boards++;
      const owned = board.association.objects.flatMap(o => o.nodes);
      assert.equal(new Set(owned).size, owned.length, `${file}: a scene node has two owners`);
      for (const id of unowned(board.scene.Root, owned)) orphans.push(`${file}${board.path}: ${JSON.stringify(id)}`);
    }
  }
  console.log(`ownership: ${boards} boards, ${failures.length} files did not compile (${failures.slice(0, 3).join(' | ')}), ${orphans.length} unowned nodes ${orphans.slice(0, 5).join(' | ')}`);
  assert(boards >= 70, `only ${boards} boards compiled`);
  assert.deepEqual(orphans, []);
});
