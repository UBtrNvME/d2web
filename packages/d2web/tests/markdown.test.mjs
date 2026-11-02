import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/markdown.js';
import { paintScene } from '../src/paint.js';

const render = source => renderMarkdown(source, url => url.startsWith('javascript:') ? '' : url);
test('flow subset renders blocks, inline text and escaped fence contents', () => {
  const result = render('# Heading\n\nA **bold** and *italic* `code` [link](https://x.test)\nsoft line\n\n- one\n- two\n\n3. third\n4. fourth\n\n> quote\n> continued\n\n---\n\n```js\n<&>\n```');
  assert.equal(result.html, '<h1>Heading</h1><p>A <strong>bold</strong> and <em>italic</em> <code>code</code> <a href="https://x.test">link</a>\nsoft line</p><ul><li>one</li><li>two</li></ul><ol start="3"><li>third</li><li>fourth</li></ol><blockquote><p>quote\ncontinued</p></blockquote><hr><pre><code>&lt;&amp;&gt;\n</code></pre>');
  assert.deepEqual(result.links, ['https://x.test']);
  assert.equal(render('#### Four\n##### Five\n###### Six').html, '<h4>Four</h4><h5>Five</h5><h6>Six</h6>');
  assert.equal(render('[bad](javascript:evil)').html, '<p><a>bad</a></p>');
});

test('underscore emphasis and strikethrough render; intraword underscores do not', () => {
  assert.equal(render('_em_ and __strong__ and ~~gone~~').html, '<p><em>em</em> and <strong>strong</strong> and <del>gone</del></p>');
});

test('unsupported or ambiguous syntax rejects the entire object', () => {
  for (const source of ['- one\n  - nested', '- one\ncontinued', '- one\n\n- loose', '- # heading', '- - -', '- + nested', '> + nested', '> quote  \n> break', 'a*?*b', '~strike~', 'snake_case_name', 'a ~~b~~c', '~~ spaced ~~', '__*mix*__', '<b>html</b>', '&amp;', '![alt](x)', '[x](url "title")', '[x](a(b)c)', 'a | b\n---|---', 'title\n===', 'title\n---', '```\nopen', '```\nx\n````\ny\n```', '***both***', 'a  \nb', '    indented', '[reference][id]', '\\*escape*', '---\ntrailing\n~~~']) {
    assert.equal(render(source), null, source);
  }
});

test('flow painting keeps object identity, consumes link overlays, and falls back without changing positioned output', () => {
  const identity = { A: 1, B: 0, C: 0, D: 1, E: 0, F: 0 };
  const node = (ID, Children = [], Primitive = null) => ({ ID, Children, Primitive, Transform: identity, Opacity: 1 });
  const run = { $: 'TextRun', Text: 'plain', Font: { Asset: 'font:SourceSansPro:regular', Size: 16 }, Origin: { X: 0, Y: 12 }, Anchor: 0, Fill: { $: 'SolidPaint', Color: 'rgba(0,0,0,1)' }, Ink: { Valid: true, Min: { X: 0, Y: -3 }, Max: { X: 40, Y: 16 } } };
  const markdown = node('md:markdown', [node('md:markdown:primitive:0', [], run)]);
  markdown.Clip = { Transform: identity, Path: { $: 'Path', Commands: [[0, 0, 0], [1, 100, 0], [1, 100, 100], [1, 0, 100], [5, 0, 0]].map(([Kind, X, Y]) => ({ Kind, P1: { X, Y } })) } };
  const scene = { Root: node('root', [node('md', [markdown])]), ViewBox: { X: 0, Y: 0, Width: 100, Height: 100 }, LogicalWidth: 100, LogicalHeight: 100, Assets: { 'font:SourceSansPro:regular': {} }, Links: [{ URL: 'https://x.test', Box: { X: 0, Y: 0, Width: 40, Height: 16 } }] };
  const options = { html: true, cssMasks: 'subtree', a11y: true, association: [{ id: 'md', content: 'markdown', label: '[plain](https://x.test)' }] };
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
  for (const unsupported of ['snake_case_word', '- outer\n  - nested']) {
    options.association[0].label = unsupported;
    assert.equal(paintScene(scene, { ...options, flow: true }).html, paintScene(scene, options).html);
  }
  options.association[0].label = 'plain';
  markdown.Children.push(node('md:markdown:primitive:1', [], { ...run, Fallbacks: ['font:consumer:regular'] }));
  assert.equal(paintScene(scene, { ...options, flow: true }).html, paintScene(scene, options).html, 'different per-run fallback stacks stay positioned');
});
