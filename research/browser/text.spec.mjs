import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../../tests/examples.mjs';

test('research: compare the scene font asset with the native SVG font face', async ({ page }) => {
  const directory = join(root, 'artifacts/research-text');
  const report = JSON.parse(readFileSync(join(directory, 'native.json'), 'utf8'));
  const label = report.runs.find(item => item.nodeID === 'source:label:0');
  const family = `d2-probe-${label.run.Font.Family}-${label.run.Font.Style}`;
  const assetNativeFamily = `d2-probe-${label.run.Font.Family}-physical-bold-registered-400`;
  const preEncodedFamily = 'd2-probe-pre-encoded-full-face';
  const convertedWoffFamily = 'd2-probe-full-ttf-converted-woff';
  const fontStyle = label.run.Font.Style === 'italic' ? 'italic' : 'normal';
  const dimensions = report.labelDimensions.source;
  const nativeSVG = report.nativeSVG;
  await page.setContent(`<!doctype html><html><body>
    <section id="html"><h2>HTML</h2><div class="label-box"><span id="html-text"></span></div></section>
    <section id="svg"><h2>SVG</h2><svg id="svg-text" xmlns="http://www.w3.org/2000/svg"><text></text></svg></section>
    <section id="native-face-svg"><h2>Native face SVG control</h2><svg id="native-face-text" xmlns="http://www.w3.org/2000/svg"><text></text></svg></section>
    <section id="asset-400-svg"><h2>Scene bytes at D2 face descriptor control</h2><svg id="asset-400-text" xmlns="http://www.w3.org/2000/svg"><text></text></svg></section>
    <section id="ttf-no-liga-svg"><h2>Scene TTF without ligatures</h2><svg id="ttf-no-liga-text" xmlns="http://www.w3.org/2000/svg"><text></text></svg></section>
    <section id="native-no-liga-svg"><h2>Native SVG face without ligatures</h2><svg id="native-no-liga-text" xmlns="http://www.w3.org/2000/svg"><text></text></svg></section>
    <section id="pre-encoded-svg"><h2>Pre-encoded full face</h2><svg id="pre-encoded-text" xmlns="http://www.w3.org/2000/svg"><text></text></svg></section>
    <section id="full-woff-svg"><h2>Full TTF converted to WOFF</h2><svg id="full-woff-text" xmlns="http://www.w3.org/2000/svg"><text></text></svg></section>
    <section id="native"><h2>Native D2 SVG</h2>${nativeSVG}</section>
    <style>
      body { font: 14px sans-serif; display: flex; gap: 24px; align-items: flex-start; }
      .label-box { width: ${dimensions.width}px; height: ${dimensions.height}px; border: 1px dashed #777; display: flex; align-items: center; justify-content: center; }
      #html-text { white-space: nowrap; user-select: text; font-family: "${family}"; font-size: ${label.run.Font.Size}px; font-weight: ${label.run.Font.Weight}; font-style: ${fontStyle}; line-height: 1; }
      #svg-text, #native-face-text, #asset-400-text, #ttf-no-liga-text, #native-no-liga-text, #pre-encoded-text, #full-woff-text { width: ${dimensions.width}px; height: ${dimensions.height}px; border: 1px dashed #777; overflow: visible; }
      #svg-text text, #native-face-text text, #asset-400-text text, #ttf-no-liga-text text, #native-no-liga-text text, #pre-encoded-text text, #full-woff-text text { user-select: text; text-anchor: middle; }
      #svg-text text { font-family: "${family}"; font-size: ${label.run.Font.Size}px; font-weight: ${label.run.Font.Weight}; font-style: ${fontStyle}; }
      #asset-400-text text { font-family: "${assetNativeFamily}"; font-size: ${label.run.Font.Size}px; font-weight: 400; font-style: ${fontStyle}; }
      #ttf-no-liga-text text { font-family: "${family}"; font-size: ${label.run.Font.Size}px; font-weight: ${label.run.Font.Weight}; font-style: ${fontStyle}; font-variant-ligatures: none; font-feature-settings: "liga" 0, "clig" 0; }
      #pre-encoded-text text { font-family: "${preEncodedFamily}"; font-size: ${label.run.Font.Size}px; font-weight: 400; font-style: normal; }
      #full-woff-text text { font-family: "${convertedWoffFamily}"; font-size: ${label.run.Font.Size}px; font-weight: 400; font-style: normal; }
    </style></body></html>`);

  const fontState = await page.evaluate(async ({ encoded, preEncodedWoff, fullTtfConvertedWoff, family, assetNativeFamily, preEncodedFamily, convertedWoffFamily, fontStyle, fontWeight, fontSize }) => {
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    const bytesFromDataURL = dataURL => Uint8Array.from(atob(dataURL.split(',')[1]), character => character.charCodeAt(0));
    const face = new FontFace(family, bytes, { weight: String(fontWeight), style: fontStyle });
    const assetNativeFace = new FontFace(assetNativeFamily, bytes, { weight: '400', style: fontStyle });
    const preEncodedFace = new FontFace(preEncodedFamily, bytesFromDataURL(preEncodedWoff), { weight: '400', style: 'normal' });
    const convertedWoffFace = new FontFace(convertedWoffFamily, bytesFromDataURL(fullTtfConvertedWoff), { weight: '400', style: 'normal' });
    document.fonts.add(face);
    document.fonts.add(assetNativeFace);
    document.fonts.add(preEncodedFace);
    document.fonts.add(convertedWoffFace);
    await Promise.all([face.load(), assetNativeFace.load(), preEncodedFace.load(), convertedWoffFace.load()]);
    const html = document.querySelector('#html-text');
    const svgNodes = ['#svg-text', '#native-face-text', '#asset-400-text', '#ttf-no-liga-text', '#native-no-liga-text', '#pre-encoded-text', '#full-woff-text'].map(selector => document.querySelector(selector));
    const [svg, nativeFaceSvg, asset400Svg, ttfNoLigaSvg, nativeNoLigaSvg, preEncodedSvg, fullWoffSvg] = svgNodes;
    const svgText = svg.querySelector('text');
    const nativeFaceText = nativeFaceSvg.querySelector('text');
    const asset400Text = asset400Svg.querySelector('text');
    const ttfNoLigaText = ttfNoLigaSvg.querySelector('text');
    const nativeNoLigaText = nativeNoLigaSvg.querySelector('text');
    const preEncodedText = preEncodedSvg.querySelector('text');
    const fullWoffText = fullWoffSvg.querySelector('text');
    html.textContent = 'office affine café';
    const nativeText = document.querySelector('#native svg text');
    const nativeStyle = getComputedStyle(nativeText);
    const nativeFontFamily = nativeStyle.fontFamily;
    const nativeFontWeight = nativeStyle.fontWeight;
    const nativeFontStyle = nativeStyle.fontStyle;
    for (const node of svgNodes) {
      node.setAttribute('viewBox', `0 0 ${node.clientWidth} ${node.clientHeight}`);
      node.querySelector('text').setAttribute('x', String(node.clientWidth / 2));
      node.querySelector('text').setAttribute('y', '16');
      node.querySelector('text').textContent = html.textContent;
    }
    nativeFaceText.style.fontFamily = nativeFontFamily;
    nativeFaceText.style.fontWeight = nativeFontWeight;
    nativeFaceText.style.fontStyle = nativeFontStyle;
    nativeFaceText.style.fontSize = `${fontSize}px`;
    nativeNoLigaText.style.fontFamily = nativeFontFamily;
    nativeNoLigaText.style.fontWeight = nativeFontWeight;
    nativeNoLigaText.style.fontStyle = nativeFontStyle;
    nativeNoLigaText.style.fontSize = `${fontSize}px`;
    nativeNoLigaText.style.fontVariantLigatures = 'none';
    nativeNoLigaText.style.fontFeatureSettings = '"liga" 0, "clig" 0';
    await document.fonts.ready;
    const canvas = document.createElement('canvas').getContext('2d');
    canvas.font = `${fontWeight} ${fontSize}px "${family}"`;
    const measured = canvas.measureText(html.textContent);
    const computed = element => {
      const style = getComputedStyle(element);
      return Object.fromEntries(['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontKerning', 'fontVariantLigatures', 'fontFeatureSettings', 'fontStretch', 'letterSpacing'].map(key => [key, style[key]]));
    };
    const svgMetrics = text => {
      const box = text.getBBox();
      return { advance: text.getComputedTextLength(), ink: { x: box.x, y: box.y, width: box.width, height: box.height }, computed: computed(text) };
    };
    const faceEntries = [...document.fonts].map(item => ({ family: item.family.replaceAll('"', ''), weight: item.weight, style: item.style, status: item.status }));
    return {
      html: { rect: (() => { const value = html.getBoundingClientRect(); return { x: value.x, y: value.y, width: value.width, height: value.height }; })(), range: (() => { const range = document.createRange(); range.selectNodeContents(html); const box = range.getBoundingClientRect(); return { width: box.width, height: box.height }; })(), computed: computed(html) },
      svg: svgMetrics(svgText),
      nativeFaceSVG: svgMetrics(nativeFaceText),
      assetBytes400SVG: svgMetrics(asset400Text),
      ttfNoLigaturesSVG: svgMetrics(ttfNoLigaText),
      nativeNoLigaturesSVG: svgMetrics(nativeNoLigaText),
      preEncodedFullFaceSVG: svgMetrics(preEncodedText),
      fullTtfConvertedWoffSVG: svgMetrics(fullWoffText),
      native: { text: nativeText?.textContent, ...svgMetrics(nativeText) },
      fonts: faceEntries,
      nativeFontFamily,
      nativeFontWeight, nativeFontStyle,
      loadedFaces: { directAsset: faceEntries.some(item => item.family === family && item.weight === String(fontWeight) && item.status === 'loaded'), asset400: faceEntries.some(item => item.family === assetNativeFamily && item.weight === '400' && item.status === 'loaded'), preEncodedFull: faceEntries.some(item => item.family === preEncodedFamily && item.weight === '400' && item.status === 'loaded'), fullTtfConvertedWoff: faceEntries.some(item => item.family === convertedWoffFamily && item.weight === '400' && item.status === 'loaded'), nativeSVG: faceEntries.some(item => nativeFontFamily.split(',')[0].replaceAll('"', '') === item.family && item.status === 'loaded') },
      canvas: { advance: measured.width, inkWidth: measured.actualBoundingBoxLeft + measured.actualBoundingBoxRight, inkHeight: measured.actualBoundingBoxAscent + measured.actualBoundingBoxDescent },
    };
  }, { encoded: label.asset.Data, preEncodedWoff: report.fontControls.fullPreEncodedWoff, fullTtfConvertedWoff: report.fontControls.fullTtfConvertedWoff, family, assetNativeFamily, preEncodedFamily, convertedWoffFamily, fontStyle, fontWeight: label.run.Font.Weight, fontSize: label.run.Font.Size });

  expect(fontState.loadedFaces).toEqual({ directAsset: true, asset400: true, preEncodedFull: true, fullTtfConvertedWoff: true, nativeSVG: true });
  expect(fontState.html.range.width).toBeGreaterThan(0);
  expect(fontState.svg.advance).toBeGreaterThan(0);
  expect(fontState.native.text).toBe('office affine café');
  expect(fontState.native.advance).toBeGreaterThan(0);
  expect(fontState.nativeFaceSVG.advance).toBeGreaterThan(0);
  expect(fontState.assetBytes400SVG.advance).toBeGreaterThan(0);
  expect(fontState.preEncodedFullFaceSVG.advance).toBeGreaterThan(0);
  expect(fontState.fullTtfConvertedWoffSVG.advance).toBeGreaterThan(0);
  expect(fontState.html.range.width).toBeCloseTo(fontState.svg.advance, 2);
  expect(fontState.nativeFaceSVG.advance).toBeCloseTo(fontState.native.advance, 2);
  expect(fontState.assetBytes400SVG.advance).toBeCloseTo(fontState.svg.advance, 2);
  expect(fontState.preEncodedFullFaceSVG.advance).toBeCloseTo(fontState.svg.advance, 2);
  expect(fontState.fullTtfConvertedWoffSVG.advance).toBeCloseTo(fontState.svg.advance, 2);
  expect(fontState.native.advance - fontState.svg.advance, 'native subset face is wider than the scene TTF').toBeCloseTo(1.640625, 2);
  for (const selector of ['#html-text', '#svg-text text']) {
    await page.locator(selector).selectText();
    expect(await page.evaluate(() => getSelection().toString())).toBe('office affine café');
  }
  const payloadInfo = dataURL => {
    const bytes = Buffer.from(dataURL.split(',')[1], 'base64');
    return { bytes: bytes.length, signature: bytes.subarray(0, 4).toString('hex') };
  };
  const nativeBoldFace = [...nativeSVG.matchAll(/font-family:\s*([^;{}]+);\s*src: url\("data:application\/font-woff;base64,([^\"]+)"\)/g)].find(([, embeddedFamily]) => embeddedFamily.includes('-font-bold'));
  const result = {
    source: 'examples/research/text/main.d2',
    browserVersion: page.context().browser()?.version(),
    font: { family: label.run.Font.Family, style: label.run.Font.Style, weight: label.run.Font.Weight, bytes: Buffer.from(label.asset.Data, 'base64').length, mimeType: label.asset.MIMEType },
    fontControls: {
      sceneTtf: { bytes: Buffer.from(label.asset.Data, 'base64').length, signature: Buffer.from(label.asset.Data, 'base64').subarray(0, 4).toString('hex') },
      nativeSubsetWoff: nativeBoldFace ? { family: nativeBoldFace[1], ...payloadInfo(`data:application/font-woff;base64,${nativeBoldFace[2]}`) } : null,
      preEncodedFullFace: payloadInfo(report.fontControls.fullPreEncodedWoff),
      fullTtfConvertedWoff: payloadInfo(report.fontControls.fullTtfConvertedWoff),
    },
    d2: { labelBox: dimensions, ink: label.run.Ink, origin: label.run.Origin, textCharacters: [...label.run.Text].length, glyphCount: label.run.Glyphs.length, glyphAdvance: label.run.Glyphs.reduce((total, glyph) => total + glyph.Advance, 0), glyphs: label.run.Glyphs.map(({ ID, Position, Advance, Ink }) => ({ id: ID, position: Position, advance: Advance, ink: Ink })) },
    browserMetrics: fontState,
    measuredDeltas: {
      nativeSVGMinusSceneTTF: fontState.native.advance - fontState.svg.advance,
      nativeFaceControlMinusReference: fontState.nativeFaceSVG.advance - fontState.native.advance,
      htmlMinusSceneSVG: fontState.html.range.width - fontState.svg.advance,
      preEncodedFullMinusSceneTTF: fontState.preEncodedFullFaceSVG.advance - fontState.svg.advance,
      convertedFullWoffMinusSceneTTF: fontState.fullTtfConvertedWoffSVG.advance - fontState.svg.advance,
      nativeSubsetWoffMinusConvertedFullWoff: fontState.native.advance - fontState.fullTtfConvertedWoffSVG.advance,
    },
    selection: { method: 'Playwright locator.selectText()', html: 'office affine café', svg: 'office affine café' },
    scope: 'One SourceSansPro bold Latin node label. Compares the native subset face, scene TTF, full pre-encoded face and fresh full TTF-to-WOFF conversion under matched normal/400 descriptors. Playwright selectText confirms these elements expose selectable text; no pointer-drag selection, pixel parity, fallback-script, rich-content, accessibility-policy or full D2 text support is claimed.',
  };
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'browser.json'), JSON.stringify(result, null, 2) + '\n');
  expect(fontState.native.ink.width).toBeGreaterThan(0);
});
