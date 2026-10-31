import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { goProbe, root } from '../tests/examples.mjs';

test('research: export native label runs, measured ink and resolved font assets', { timeout: 300_000 }, () => {
  const output = join(root, 'artifacts/research-text');
  mkdirSync(output, { recursive: true });
  const source = join(root, 'examples/research/text/main.d2');
  const probe = goProbe(join(root, 'research/text.go'), join(output, 'probe'), false);
  const report = JSON.parse(probe.native([source]));
  assert.equal(report.runs.length, 3, 'the case exercises two node labels and one connection label');
  for (const { run, asset } of report.runs) {
    assert.equal(run.Text, 'office affine café');
    assert(run.Ink.Valid, 'native shaping supplies measured ink bounds');
    assert(run.Glyphs.length > 0, 'native shaping supplies positioned glyphs');
    assert(asset.Data.length > 1000, 'the scene includes the resolved font bytes as base64');
    assert.equal(asset.MIMEType, 'font/ttf');
  }
  assert(report.labelDimensions.source.width > 0 && report.labelDimensions.source.height > 0);
  assert.match(report.fontControls.fullPreEncodedWoff, /^data:application\/font-woff;base64,/);
  assert.match(report.fontControls.fullTtfConvertedWoff, /^data:application\/font-woff;base64,/);
  const preEncodedBytes = Buffer.from(report.fontControls.fullPreEncodedWoff.split(',')[1], 'base64');
  const fullConvertedBytes = Buffer.from(report.fontControls.fullTtfConvertedWoff.split(',')[1], 'base64');
  assert.equal(preEncodedBytes.subarray(0, 4).toString('hex'), '00010000', 'the pre-encoded data URI contains an SFNT face');
  assert.equal(fullConvertedBytes.subarray(0, 4).toString('hex'), '774f4646', 'the fresh full conversion contains WOFF bytes');
  const nativeFaces = [...report.nativeSVG.matchAll(/font-family:\s*([^;{}]+);\s*src: url\("data:application\/font-woff;base64,([^\"]+)"\)/g)];
  const nativeBoldFace = nativeFaces.find(([, family]) => family.includes('-font-bold'));
  assert(nativeBoldFace, 'native SVG embeds the bold WOFF subset');
  const nativeSubsetBytes = Buffer.from(nativeBoldFace[2], 'base64');
  assert.equal(nativeSubsetBytes.subarray(0, 4).toString('hex'), '774f4646');
  assert.match(report.nativeSVG, /<text[\s>]/, 'native SVG includes text elements');
  assert.match(report.nativeSVG, /@font-face/, 'native SVG embeds its font face');
  writeFileSync(join(output, 'native.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(output, 'native.svg'), report.nativeSVG);
  writeFileSync(join(output, 'summary.json'), JSON.stringify({
    source: 'examples/research/text/main.d2',
    engine: 'D2 v0.9.0 / TALA seed 1',
    labels: report.runs.map(({ nodeID, run, asset }) => ({
      nodeID, text: run.Text, font: run.Font, fontMIMEType: asset.MIMEType,
      fontBytes: Buffer.from(asset.Data, 'base64').length,
      nativeInk: run.Ink, nativeOrigin: run.Origin,
      shapedGlyphs: run.Glyphs.map(({ ID, Position, Advance, Ink }) => ({ id: ID, position: Position, advance: Advance, ink: Ink })),
      labelDimensions: report.labelDimensions[nodeID] ?? null,
    })),
    fontControls: Object.fromEntries(Object.entries(report.fontControls).map(([name, dataURL]) => {
      const bytes = Buffer.from(dataURL.split(',')[1], 'base64');
      return [name, { bytes: bytes.length, signature: bytes.subarray(0, 4).toString('hex') }];
    })),
    nativeBoldSubset: { bytes: nativeSubsetBytes.length, signature: nativeSubsetBytes.subarray(0, 4).toString('hex') },
    scope: 'One Latin label repeated on two shapes and one connection. Native label dimensions, shaped glyph positions, measured ink, and actual embedded font bytes are exported for browser comparison; this does not establish cross-browser or full D2 text parity.',
  }, null, 2) + '\n');
});
