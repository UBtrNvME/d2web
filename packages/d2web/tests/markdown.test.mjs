import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/markdown.js';
import { paintScene } from '../src/paint.js';

const render = html => renderMarkdown(html, url => url.startsWith('javascript:') ? '' : url);
test('flow source is D2 HTML with the page link policy applied to each href', () => {
  // Shaped like the worker's serialisation: D2's elements, href first, Go html escaping.
  const result = render('<h1>T</h1>\n<p><a href="https://x.test/?a=1&amp;b=&#34;2&#34;" title="t">x</a> <a href="javascript:evil">bad</a> <a title="only">t</a></p>\n<pre><code>&lt;a href=&#34;javascript:x&#34;&gt;\n</code></pre>\n');
  assert.equal(result.html, '<h1>T</h1>\n<p><a href="https://x.test/?a=1&amp;b=&quot;2&quot;" title="t">x</a> <a>bad</a> <a title="only">t</a></p>\n<pre><code>&lt;a href=&#34;javascript:x&#34;&gt;\n</code></pre>\n');
  assert.deepEqual(result.links, ['https://x.test/?a=1&b="2"', 'javascript:evil']);
  assert.equal(render(''), null);
  for (const unsafe of ['<img src=x onerror=alert(1)>', '<A HREF="javascript:alert(1)">x</A>', '<a href=javascript:alert(1)>x</a>', '<svg onload=alert(1)>', '<p onclick="x()">p</p>', '<a href="x" onclick="y">a</a>', '<p>a</p><script>alert(1)</script>', '<p><a title="t" href="javascript:alert(1)">x</a></p>', '<a href="https://x.test" href="javascript:alert(2)">x</a>', '<p href="x">p</p>', '<br>']) {
    assert.equal(render(unsafe), null, unsafe);
  }
  assert.equal(render('<p>a<br/>b</p>\n<table>\n<tr>\n<td align="right">1</td>\n</tr>\n</table>\n<ol start="2" type="a">\n<li>x</li>\n</ol>\n').links.length, 0);
  assert.equal(render(undefined), null);
});

test('flow painting keeps object identity, consumes link overlays, and falls back without changing positioned output', () => {
  const identity = { A: 1, B: 0, C: 0, D: 1, E: 0, F: 0 };
  const node = (ID, Children = [], Primitive = null) => ({ ID, Children, Primitive, Transform: identity, Opacity: 1 });
  const run = { $: 'TextRun', Text: 'plain', Font: { Asset: 'font:SourceSansPro:regular', Size: 16 }, Origin: { X: 0, Y: 12 }, Anchor: 0, Fill: { $: 'SolidPaint', Color: 'rgba(0,0,0,1)' }, Ink: { Valid: true, Min: { X: 0, Y: -3 }, Max: { X: 40, Y: 16 } } };
  const markdown = node('md:markdown', [node('md:markdown:primitive:0', [], run)]);
  markdown.Clip = { Transform: identity, Path: { $: 'Path', Commands: [[0, 0, 0], [1, 100, 0], [1, 100, 100], [1, 0, 100], [5, 0, 0]].map(([Kind, X, Y]) => ({ Kind, P1: { X, Y } })) } };
  const scene = { Root: node('root', [node('md', [markdown])]), ViewBox: { X: 0, Y: 0, Width: 100, Height: 100 }, LogicalWidth: 100, LogicalHeight: 100, Assets: { 'font:SourceSansPro:regular': {} }, Links: [{ URL: 'https://x.test', Box: { X: 0, Y: 0, Width: 40, Height: 16 } }] };
  const options = { html: true, cssMasks: 'subtree', a11y: true, association: [{ id: 'md', content: 'markdown', label: '[plain](https://x.test)', html: '<p><a href="https://x.test">plain</a></p>\n' }] };
  const positioned = paintScene(scene, options).html;
  assert.equal(paintScene(scene, { ...options, flow: false }).html, positioned);
  const flow = paintScene(scene, { ...options, flow: true }).html;
  assert.match(flow, /data-id="md"[^>]*role="group"/);
  assert.match(flow, /data-flow-markdown/);
  assert.match(flow, /<p><a href="https:\/\/x.test">plain<\/a><\/p>/);
  assert.equal((flow.match(/<a\b/g) ?? []).length, 1);
  assert.doesNotMatch(flow, /data-k="(?:text|link)"|clip-path:url/);
  assert.match(flow, /&quot;width&quot;:100,&quot;height&quot;:100/);
  assert.match(flow, /width:100px/);
  // No D2 HTML (the worker found an image or an element outside D2's list), or a heading the runs do not paint: stays positioned.
  for (const html of [undefined, '<h1>plain</h1>\n']) {
    options.association[0].html = html;
    assert.equal(paintScene(scene, { ...options, flow: true }).html, paintScene(scene, options).html);
  }
  options.association[0].html = '<p>plain</p>\n';
  markdown.Children.push(node('md:markdown:primitive:1', [], { ...run, Fallbacks: ['font:consumer:regular'] }));
  assert.equal(paintScene(scene, { ...options, flow: true }).html, paintScene(scene, options).html, 'different per-run fallback stacks stay positioned');
});

test('a run D2 painted past its own clip keeps the object positioned (D2 measure and paint disagree)', () => {
  const identity = { A: 1, B: 0, C: 0, D: 1, E: 0, F: 0 };
  const node = (ID, Children = [], Primitive = null) => ({ ID, Children, Primitive, Transform: identity, Opacity: 1 });
  const run = (Text, y) => ({ $: 'TextRun', Text, Font: { Asset: 'font:SourceSansPro:regular', Size: 16 }, Origin: { X: 0, Y: y }, Anchor: 0, Fill: { $: 'SolidPaint', Color: 'rgba(0,0,0,1)' }, Ink: { Valid: true, Min: { X: 0, Y: y - 12 }, Max: { X: 40, Y: y + 4 } } });
  const markdown = node('md:markdown', [node('md:markdown:primitive:0', [], run('seen', 12)), node('md:markdown:primitive:1', [], run('clipped', 40))]);
  markdown.Clip = { Transform: identity, Path: { $: 'Path', Commands: [[0, 0, 0], [1, 100, 0], [1, 100, 24], [1, 0, 24], [5, 0, 0]].map(([Kind, X, Y]) => ({ Kind, P1: { X, Y } })) } };
  const scene = { Root: node('root', [node('md', [markdown])]), ViewBox: { X: 0, Y: 0, Width: 100, Height: 24 }, LogicalWidth: 100, LogicalHeight: 24, Assets: { 'font:SourceSansPro:regular': {} } };
  const options = { html: true, a11y: true, association: [{ id: 'md', content: 'markdown', label: 'seen\nclipped', html: '<p>seen\nclipped</p>\n' }] };
  assert.equal(paintScene(scene, { ...options, flow: true }).html, paintScene(scene, options).html);
});
