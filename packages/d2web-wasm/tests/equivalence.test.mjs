import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { goEnv, goRun, root } from '../../../tests/examples.mjs';
import { normalizeCompileRequest } from '../../d2web/src/request.ts';
import { paintScene } from '../../d2web/src/paint.js';

// Slice 1 step 5: the product worker's scene equals the scene the research census painter was validated on, board for board, so the
// census thresholds (139 of 145 root boards within 5% of native) carry over to the product encoder. Single-file, image-free cases.
const output = join(root, 'artifacts/d2web-wasm');
mkdirSync(join(output, 'fonts'), { recursive: true });
const opts = { cwd: join(root, 'packages/d2web-wasm'), env: { ...goEnv, GOFLAGS: '-mod=readonly' } };
goRun('go', ['build', '-o', join(output, 'd2web'), './cmd/d2web'], opts);
goRun('go', ['build', '-o', join(output, 'census'), join(root, 'research/census.go')], { env: { ...goEnv, GOFLAGS: '-mod=readonly' } });

const render = { themeId: 0, sketch: false, pad: 0, scale: 1, center: false };
const cases = ['geometry', 'chess', 'animation', 'arrowhead_scaling', 'unfilled_triangle', 'vector-grid', 'centered_horizontal_connections'];

for (const name of cases) {
  test(`product scene equals the census scene: ${name}`, () => {
    const source = readFileSync(join(root, `examples/files/${name}.d2`), 'utf8');
    const product = JSON.parse(goRun(join(output, 'd2web'), [JSON.stringify(normalizeCompileRequest({ v: 1, type: 'compile', id: 1, revision: 1, files: { 'main.d2': source }, entry: 'main.d2', render }))], opts));
    assert.equal(product.error, undefined, product.error?.message);
    const dir = mkdtempSync(join(tmpdir(), 'equiv-'));
    writeFileSync(join(dir, 'main.d2'), source);
    const census = JSON.parse(execFileSync(join(output, 'census'), [dir, 'main.d2', join(output, 'fonts')], { encoding: 'utf8', maxBuffer: 256 << 20 }));
    assert.equal(census.error ?? '', '');
    assert.deepEqual(product.boards[0].scene, census.export.scene);
    assert(paintScene(product.boards[0].scene).svg.startsWith('<svg'), 'the painter accepts the product scene (SVG)');
    assert(paintScene(product.boards[0].scene, { html: true }).html.includes('data-d2-scene'), 'and the HTML-first painter');
  });
}
