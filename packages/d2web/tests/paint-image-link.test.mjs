import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paintScene } from '../src/paint.js';

// Spec 0010 2.3 (test 11 at the painter): an image the scene could not carry is shown as a real image element at D2's box, from the association's link.
const ident = { A: 1, B: 0, C: 0, D: 1, E: 0, F: 0 };
const placeholder = { $: 'VectorAsset', ViewBox: { X: 0, Y: 0, Width: 8, Height: 8 }, Root: { ID: 'ph', Transform: ident, Opacity: 1, Primitive: { $: 'Rect', Box: { X: 0, Y: 0, Width: 8, Height: 8 }, Fill: { $: 'SolidPaint', Color: 'rgba(0,0,0,1)' } } } };
const raster = { $: 'RasterAsset', MIMEType: 'image/png', Data: 'AAAA' };
const imageNode = (id, asset, aspect = { Align: 5, Fit: false }) => ({ ID: id, Transform: ident, Opacity: 1, Primitive: { $: 'Image', Asset: asset, Box: { X: 4, Y: 6, Width: 32, Height: 24 }, Aspect: aspect } });
const scene = (children, assets) => ({
  ViewBox: { X: 0, Y: 0, Width: 100, Height: 60 }, LogicalWidth: 100, LogicalHeight: 60,
  Assets: { 'image:unavailable': placeholder, 'image:real': raster, ...assets },
  Root: { ID: 'root', Transform: ident, Opacity: 1, Children: children },
});
const entry = (node, source, id = 'a') => ({ id, kind: 'shape', image: { source, role: 'icon', node } });

test('a placeholder with a link in the association becomes an <img> at D2\'s box and aspect', () => {
  const { html, stats } = paintScene(scene([imageNode('a:icon', 'image:unavailable')]), { html: true, association: [entry('a:icon', 'https://i.test/a.svg')] });
  const img = html.match(/<img [^>]*>/)[0];
  assert.match(img, /src="https:\/\/i\.test\/a\.svg"/);
  assert.match(img, /referrerpolicy="no-referrer"/);
  assert.match(img, /decoding="async"/);
  assert.match(img, /left:4px;top:6px;width:32px;height:24px;object-fit:contain;object-position:center/);
  assert.equal(stats['html:linked-image'], 1);
  assert.doesNotMatch(html, /<svg [^>]*viewBox="0 0 8 8"/, 'the placeholder is replaced, not drawn as well');
});

test('only http, https and image data URLs become an element; everything else keeps the placeholder', () => {
  for (const source of ['javascript:alert(1)', 'java\tscript:alert(1)', 'file:///etc/passwd', 'relative/icon.png', '//host/icon.png', 'data:text/html,<script>alert(1)</script>', 'ftp://i.test/a.png', 'blob:https://i.test/x', '']) {
    const { html } = paintScene(scene([imageNode('a:icon', 'image:unavailable')]), { html: true, association: [entry('a:icon', source)] });
    assert.doesNotMatch(html, /<img /, JSON.stringify(source));
  }
  const data = 'data:image/png;base64,AAAA';
  assert.match(paintScene(scene([imageNode('a:icon', 'image:unavailable')]), { html: true, association: [entry('a:icon', data)] }).html, /<img [^>]*src="data:image\/png;base64,AAAA"/);
});

test('a real asset is never replaced, and an entry whose node is another keeps the placeholder elsewhere', () => {
  const real = paintScene(scene([imageNode('a:icon', 'image:real')]), { html: true, association: [entry('a:icon', 'https://i.test/a.svg')] }).html;
  assert.match(real, /src="data:image\/png;base64,AAAA"/);
  assert.doesNotMatch(real, /i\.test/);
  const other = paintScene(scene([imageNode('b:icon', 'image:unavailable')]), { html: true, association: [entry('a:icon', 'https://i.test/a.svg')] }).html;
  assert.doesNotMatch(other, /<img /);
});

test('the SVG painter emits an <image> with the link and a no-referrer policy; the quote in a URL is escaped', () => {
  const { svg } = paintScene(scene([imageNode('p:image', 'image:unavailable', { Align: 5, Fit: true })]), { association: [entry('p:image', 'https://i.test/a"b.svg', 'p')] });
  assert.match(svg, /<image x="4" y="6" width="32" height="24" preserveAspectRatio="xMidYMid slice" href="https:\/\/i\.test\/a%22b\.svg" referrerpolicy="no-referrer"\/>/);
});
