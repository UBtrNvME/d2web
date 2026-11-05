import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { ensureSyntaxTree } from '@codemirror/language';
import { d2Completion, d2Language } from '../src/source-language.ts';
import table from '../src/keywords.json' with { type: 'json' };

function complete(text, pos = text.length) {
  const state = EditorState.create({ doc: text, extensions: [d2Language] });
  return d2Completion(new CompletionContext(state, pos, true));
}
const labels = result => result?.options.map(o => o.label).sort();
const styles = shape => table.keywords.filter(k => k.style && (!shape || !k.only || k.only.includes(shape))).map(k => k.name).sort();

test('D2 tokenizer distinguishes syntax and keeps quoted and block content opaque', () => {
  const text = '# comment\na: "escaped \\" # string" {style.fill: "#abcdef"; width: -42.5}\na->b -- c <- d <-> e\na: ||md\n# opaque { shape: circle }\n||\nshape: rectangle';
  const state = EditorState.create({ doc: text, extensions: [d2Language] }), tokens = [];
  ensureSyntaxTree(state, text.length, 1000).iterate({ enter(n) {
    if (!n.type.isTop) tokens.push([n.name, text.slice(n.from, n.to)]);
  } });
  for (const token of [['comment', '# comment'], ['keyword', 'shape'], ['string', '"#abcdef"'], ['number', '-42.5'], ['operator', '->'], ['operator', '--'], ['operator', '<-'], ['operator', '<->'], ['string', '# opaque { shape: circle }'], ['meta', '||md']]) {
    assert.ok(tokens.some(t => t[0] === token[0] && t[1] === token[1]), JSON.stringify(token));
  }
  assert.equal(tokens.filter(t => t[0] === 'comment').length, 1);
  // D2 starts a comment at an unquoted #, so an unquoted hex colour must not look like a value.
  const hex = EditorState.create({ doc: 'a.style.fill: #abcdef', extensions: [d2Language] }), seen = [];
  ensureSyntaxTree(hex, hex.doc.length, 1000).iterate({ enter(n) { if (!n.type.isTop) seen.push([n.name, hex.sliceDoc(n.from, n.to)]); } });
  assert.ok(seen.some(t => t[0] === 'comment' && t[1] === '#abcdef'));
});

test('shape and arrowhead completions use the matching D2 lists', () => {
  assert.deepEqual(labels(complete('a.shape: ')), [...table.shapes].sort());
  for (const side of ['source-arrowhead', 'target-arrowhead']) {
    assert.deepEqual(labels(complete(`a -> b: { ${side}.shape: `)), [...table.arrowheads].sort());
    assert.deepEqual(labels(complete(`a -> b: { ${side}: { shape: `)), [...table.arrowheads].sort());
  }
});

test('style suggestions apply only restrictions to the enclosing explicit shape, including later declarations', () => {
  assert.deepEqual(labels(complete('a.style.')), styles());
  assert.deepEqual(labels(complete('a: { style: { ')), styles());
  assert.deepEqual(labels(complete('a: { shape: circle; style.')), styles('circle'));
  assert.deepEqual(labels(complete('a.shape: circle\na.style.')), styles('circle'));
  assert.deepEqual(labels(complete('a: { shape: "circle"; style.')), styles('circle'));
  const text = 'a: { style: { \n}; shape: circle }';
  assert.deepEqual(labels(complete(text, text.indexOf('\n'))), styles('circle'));
  assert.deepEqual(labels(complete('a: {shape: circle}\nb: {style.')), styles());
  assert.deepEqual(labels(complete('a: {shape: circle\n b: {style.')), styles());
});

test('boolean domains and language lists come from the keyword table', () => {
  for (const keyword of table.keywords.filter(k => k.domain.kind === 'boolean')) {
    assert.deepEqual(labels(complete(`a.style.${keyword.name}: `)), ['false', 'true']);
  }
  for (const text of ['a.language: ', 'a: |', 'a: |py', 'a: ||py']) {
    const result = complete(text);
    assert.deepEqual(labels(result), [...table.languages].sort());
    const preferred = result.options.filter(o => o.boost > 0).sort((a, b) => b.boost - a.boost).map(o => o.label);
    assert.deepEqual(preferred, table.commonLanguages);
  }
});

test('completion replaces only the value or property prefix and ignores comments and strings', () => {
  for (const [text, prefix] of [['a.shape: rect', 'rect'], ['a.style.stro', 'stro'], ['a.language: c++', 'c++'], ['a: |py', 'py']]) {
    assert.equal(complete(text).from, text.length - prefix.length);
  }
  for (const text of ['# a.shape: ', 'a: "shape: ', "a: 'style.", 'a: |md\nshape: ', 'a.label: anything', 'a.style', 'style: { bold: true }\na: ']) {
    assert.equal(complete(text), null, text);
  }
  assert.deepEqual(labels(complete('a: "{shape: circle}"\nb.style.')), styles());
});
