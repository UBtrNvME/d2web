import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paintScene } from '../src/paint.js';

// Safari does not resolve `mask: url(#id)` to an inline SVG <mask> from an HTML element, so D2's connection-label cut-out never applied there.
const ident = { A: 1, B: 0, C: 0, D: 1, E: 0, F: 0 };
const solid = (r, g, b) => ({ $: 'SolidPaint', Color: `rgba(${r},${g},${b},1)` });
const rect = (id, x, y, width, height, paint) => ({ ID: id, Transform: ident, Opacity: 1, Primitive: { $: 'Rect', Box: { X: x, Y: y, Width: width, Height: height }, Fill: paint } });
const scene = {
  ViewBox: { X: 0, Y: 0, Width: 100, Height: 40 }, LogicalWidth: 100, LogicalHeight: 40,
  Root: {
    ID: 'root', Transform: ident, Opacity: 1,
    Children: [{
      ID: 'edge', Transform: ident, Opacity: 1, Mask: { Type: 1, Transform: ident, Root: { ID: 'm', Transform: ident, Opacity: 1, Children: [rect('base', 0, 0, 100, 40, solid(255, 255, 255)), rect('hole', 40, 10, 20, 20, solid(0, 0, 0))] } },
      Children: [rect('line', 0, 19, 100, 2, solid(0, 0, 255))],
    }],
  },
};

for (const cssMasks of ['subtree', true]) {
  test(`an HTML-painted mask is an image mask, not a fragment reference (cssMasks: ${cssMasks})`, () => {
    const { html } = paintScene(scene, { html: true, cssMasks });
    assert.doesNotMatch(html, /mask:\s*url\(#/);
    const style = html.match(/<div data-id="edge"[^>]*style="([^"]*)"/)[1];
    assert.match(style, /(?:^|;)mask-image:url\('data:image\/svg\+xml,/);
    assert.match(style, /-webkit-mask-image:url\('data:image\/svg\+xml,/);
    const image = decodeURIComponent(style.match(/mask-image:url\('data:image\/svg\+xml,([^']*)'\)/)[1]);
    assert.match(image, /<mask [^>]*mask-type:luminance/);
    assert.match(image, /data-id="hole"/);
    assert.doesNotMatch(html, /<mask /); // no inline <mask> definition is left for the HTML to reference
  });
}
