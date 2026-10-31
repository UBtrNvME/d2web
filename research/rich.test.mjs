import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { goProbe, root } from '../tests/examples.mjs';

// R2: what the native scene gives a web renderer for rich content. Diagnostic observations on named cases.
test('research: rich content in the native scene (markdown, code, latex, unicode, multiline)', { timeout: 300_000 }, () => {
  const output = join(root, 'artifacts/research-rich');
  mkdirSync(output, { recursive: true });
  const probe = goProbe(join(root, 'research/rich.go'), join(output, 'probe'));
  const run = (name, ...flags) => {
    const args = [join(root, 'examples/research/rich', name + '.d2'), ...flags];
    const result = JSON.parse(probe.native(args));
    assert.deepEqual(JSON.parse(probe.wasm(args)), result, `${name}: native/WASM equivalence`);
    return result;
  };
  const runs = r => r.nodes.filter(n => n.kind === 'd2scene.TextRun');
  const assets = r => new Set(runs(r).map(n => n.asset));
  const report = {};

  const md = report.markdown = run('markdown');
  assert(!md.error, md.error);
  for (const font of ['SourceSansPro:regular', 'SourceSansPro:bold', 'SourceSansPro:italic', 'SourceSansPro:semibold', 'SourceCodePro:regular']) assert(assets(md).has('font:' + font), font);
  assert.equal(Math.max(...runs(md).map(n => n.size)), 32, 'heading is only a larger semibold run');
  assert(md.nodes.some(n => n.kind === 'd2scene.Rect' && n.id.startsWith('m:markdown')), 'rules and bullets are plain rects');
  assert.equal(md.links, 1, 'one link region');
  assert(runs(md).some(n => n.text === 'link') && !md.nodes.some(n => /link|heading|list|strong|em/.test(n.id.replace('m:markdown:primitive:', ''))), 'no semantic element IDs, just indexed primitives');

  const code = report.code = run('code');
  assert(!code.error, code.error);
  assert([...assets(code)].every(a => a === 'font:SourceCodePro:regular'));
  const line0 = code.nodes.filter(n => n.id.startsWith('c:code-line:0:token:')).map(n => +n.id.split(':').pop());
  assert.deepEqual(line0, [0, 2, 3, 4, 6], 'whitespace tokens are omitted, indentation is positional');

  const latex = report.latex = run('latex');
  assert.match(latex.error, /SVG import limits/, 'latex is rejected without explicit import limits');
  const latexOK = report.latexWithLimits = run('latex', '--assets');
  assert(!latexOK.error, latexOK.error);
  assert.equal(runs(latexOK).length, 0, 'latex has no text runs');
  assert(latexOK.nodes.some(n => n.kind === 'd2scene.Image' && n.id === 'l:label:0'), 'latex is an Image node');
  assert(Object.values(latexOK.assets).includes('d2scene.VectorAsset'), 'backed by a vector asset');

  const uni = report.unicode = run('unicode');
  assert(!uni.error, uni.error);
  assert([...assets(uni)].every(a => a === 'font:SourceSansPro:bold'), 'no fallback fonts without a configured resolver');
  report.unicode.notdefGlyphs = runs(uni).map(n => [n.text, n.glyphs, n.notdef ?? 0]);

  // Fallback resolution reads host fonts (native only); counts depend on this machine, so they are recorded, not asserted.
  const file = join(root, 'examples/research/rich/unicode.d2');
  const nativeFallback = JSON.parse(probe.native([file, '--fallback']));
  const wasmFallback = JSON.parse(probe.wasm([file, '--fallback']));
  assert(!nativeFallback.error && !wasmFallback.error);
  const fallbackAssets = r => Object.keys(r.assets).filter(a => a.startsWith('font:fallback:'));
  assert.deepEqual(fallbackAssets(wasmFallback), [], 'WASM has no host filesystem, so it resolves no fallback fonts');
  report.unicodeFallback = { nativeFallbackAssets: fallbackAssets(nativeFallback).length, wasmFallbackAssets: 0, nativeGlyphAssets: runs(nativeFallback).map(n => [n.text, n.glyphAssets]) };

  const wrapped = report.wrapped = run('wrapped');
  assert(!wrapped.error, wrapped.error);
  assert.deepEqual(runs(wrapped).map(n => n.id), ['a:label:0', 'a:label:1'], 'each explicit line is its own run');
  assert(/ 253x/.test(wrapped.targetText.a), 'width: 120 does not wrap the label (253 wide)');

  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
});
