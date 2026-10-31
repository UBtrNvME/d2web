import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { goRun, root } from '../tests/examples.mjs';

// R6 size handshake, native side: a consumer card measured at some size is fed back as `width`/`height` on the D2 node, the
// board is recompiled with TALA, and the resulting node box, edge endpoints and neighbours are checked. Measurement and the
// recompile loop here are test code; this is not a proposed API.
const output = join(root, 'artifacts/research-handshake');
mkdirSync(join(output, 'fonts'), { recursive: true });
const binary = join(output, 'probe');
goRun('go', ['build', '-mod=readonly', '-o', binary, join(root, 'research/census.go')]);
const base = readFileSync(join(root, 'examples/research/handshake/main.d2'), 'utf8');

function compile(extra, allowError = false) {
  const dir = mkdtempSync(join(tmpdir(), 'handshake-'));
  writeFileSync(join(dir, 'main.d2'), base + extra);
  const result = JSON.parse(execFileSync(binary, [dir, 'main.d2', join(output, 'fonts')], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120_000 }));
  if (allowError && result.error) return { error: result.error };
  assert.equal(result.error ?? '', '');
  const scene = result.export.scene;
  const nodes = {}, edges = {};
  for (const group of scene.Root.Children) {
    const primitive = group.Children?.[0]?.Primitive;
    if (!group.ID || !primitive) continue;
    if (primitive.$ === 'Rect' || primitive.$ === 'Ellipse') nodes[group.ID] = primitive.Box ?? primitive;
    else if (primitive.$ === 'Path') {
      const c = primitive.Commands, last = c.at(-1), end = last.Kind === 3 ? last.P3 : last.P1;
      edges[group.ID] = { start: c[0].P1, end, commands: c.length, points: JSON.stringify(c) };
    }
  }
  return { nodes, edges, view: scene.ViewBox };
}

// Distance from a point to the closest point of a box (0 when inside or on the boundary).
const distance = (p, b) => Math.hypot(Math.max(b.X - p.X, 0, p.X - (b.X + b.Width)), Math.max(b.Y - p.Y, 0, p.Y - (b.Y + b.Height)));
const overlap = (a, b) => a.X < b.X + b.Width && b.X < a.X + a.Width && a.Y < b.Y + b.Height && b.Y < a.Y + a.Height;

test('research: measured card sizes round-trip through a TALA recompile', { timeout: 300_000 }, () => {
  const baseline = compile('');
  const cases = {};
  const sizes = { 'smaller 40x30': [40, 30], 'wide 200x90': [200, 90], 'large 320x160': [320, 160], 'tall 60x300': [60, 300] };
  for (const [name, [w, h]] of Object.entries(sizes)) {
    const r = compile(`b.width: ${w}\nb.height: ${h}\n`);
    const box = r.nodes.b;
    const moved = Object.keys(baseline.nodes).filter(id => id !== 'b' && (r.nodes[id].X !== baseline.nodes[id].X || r.nodes[id].Y !== baseline.nodes[id].Y)).length;
    const attached = Object.entries(r.edges).filter(([id]) => id.includes('b')).map(([id, e]) => Math.max(...[e.start, e.end].map(p => Math.min(...Object.values(r.nodes).map(n => distance(p, n))))));
    const overlaps = Object.entries(r.nodes).flatMap(([x, bx]) => Object.entries(r.nodes).filter(([y]) => y > x && overlap(bx, r.nodes[y])).map(([y]) => `${x}/${y}`));
    const changedRoutes = Object.keys(r.edges).filter(id => r.edges[id].points !== baseline.edges[id]?.points).length;
    cases[name] = { requested: [w, h], actual: [box.Width, box.Height], otherNodesMoved: moved, changedRoutes, maxEndpointGap: +Math.max(...attached).toFixed(2), overlaps, view: [r.view.Width, r.view.Height] };
  }
  // Requests D2 may not honour literally: the actual box is recorded, not asserted, except where noted.
  const edge = {};
  const variants = {
    'label wider than width': ['b.label: "a long card title that needs room"\nb.width: 40\nb.height: 30\n'],
    'circle 200x90': ['b.shape: circle\nb.width: 200\nb.height: 90\n'],
    'zero width': ['b.width: 0\nb.height: 40\n'],
    'negative height': ['b.width: 80\nb.height: -40\n'],
    'huge 5000x5000': ['b.width: 5000\nb.height: 5000\n'],
  };
  for (const [name, [extra]] of Object.entries(variants)) {
    const r = compile(extra, true);
    edge[name] = r.error ? { error: r.error.split('\n')[0] } : { actual: [r.nodes.b.Width, r.nodes.b.Height], view: [r.view.Width, r.view.Height] };
  }
  writeFileSync(join(output, 'summary.json'), JSON.stringify({ baseline: { b: baseline.nodes.b, view: baseline.view }, cases, edge }, null, 2) + '\n');
  assert.deepEqual(edge['label wider than width'].actual, [40, 30], 'a fixed size wins over a wider label');
  assert.match(edge['circle 200x90'].error, /width and height must be equal/);
  assert.match(edge['zero width'].error, /between 1 and/);
  assert.match(edge['negative height'].error, /outside the supported range/);
  assert.deepEqual(edge['huge 5000x5000'].actual, [5000, 5000], 'no upper size bound below 1e9');
  console.log(JSON.stringify({ baseline: baseline.nodes.b, cases, edge }));
  for (const [name, c] of Object.entries(cases)) {
    assert.deepEqual(c.actual, c.requested, `${name}: D2 honours the requested size`);
    assert.deepEqual(c.overlaps, [], `${name}: layout keeps nodes apart`);
    assert.ok(c.changedRoutes > 0, `${name}: routes follow the new size`);
    assert.ok(c.maxEndpointGap <= 12, `${name}: edge endpoints stay attached to a node box`);
  }
});
