import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorState } from '@codemirror/state';
import { literalDecorations, valueField, replaceValues, valueEdit } from '../src/source-values.ts';

const pos = offset => ({ offset, line: 0, column: offset });
function association(text) {
  const prop = (value, key, kind = 'unquoted', path = 'main.d2') => {
    const start = text.indexOf(value);
    return [key, { value, source: { path }, literal: { start: pos(start), end: pos(start + value.length), kind } }];
  };
  return { objects: [
    { id: 'a', properties: Object.fromEntries([prop('red', 'fill'), prop('24', 'fontSize', 'number'), prop('40', 'width', 'number'), prop('blue', 'stroke', 'unquoted', 'import.d2')]) },
    { id: 'b', properties: Object.fromEntries([prop('red', 'fill')]) },
  ] };
}
const ranges = state => {
  const found = [];
  for (let i = state.field(valueField).iter(); i.value; i.next()) if (i.value.spec.literal) found.push({ from: i.from, to: i.to, item: i.value.spec.literal });
  return found;
};
test('association decorations use D2 property names, deduplicate owners, and exclude imported and layout numbers', () => {
  const text = 'a: {style.fill: red; style.font-size: 24; width: 40; style.stroke: blue}';
  const state = EditorState.create({ doc: text, extensions: valueField });
  const next = state.update({ effects: replaceValues.of(literalDecorations(association(text), 'main.d2', text)) }).state;
  const values = ranges(next);
  assert.deepEqual(values.map(v => v.item.name), ['fill', 'font-size']);
  assert.equal(values[0].item.used, 2);
});

test('ranges map through unrelated edits, drop only touched literals, and replace on a good compile', () => {
  const text = 'red 24 40 blue';
  let state = EditorState.create({ doc: text, extensions: valueField });
  const marks = literalDecorations(association(text), 'main.d2', text);
  state = state.update({ effects: replaceValues.of(marks) }).state;
  state = state.update({ changes: { from: 0, insert: '# 😀\n' } }).state;
  // Inserting on the literal boundary conservatively invalidates that literal, but keeps the other.
  assert.deepEqual(ranges(state).map(v => v.item.name), ['font-size']);
  assert.equal(ranges(state)[0].from, 9);
  state = state.update({ effects: replaceValues.of(literalDecorations(association(state.doc.toString()), 'main.d2', state.doc.toString())) }).state;
  assert.equal(ranges(state).length, 2);
  state = state.update({ changes: { from: 6, to: 7, insert: 'x' } }).state;
  assert.deepEqual(ranges(state).map(v => v.item.name), ['font-size']);
});

test('widget edits keep their own mapped range until a fresh association arrives', () => {
  const text = 'red 24 40 blue';
  let state = EditorState.create({ doc: text, extensions: valueField });
  state = state.update({ effects: replaceValues.of(literalDecorations(association(text), 'main.d2', text)) }).state;
  const id = ranges(state)[0].item.id;
  state = state.update({ changes: { from: 0, to: 3, insert: '"#112233"' }, annotations: valueEdit.of(id) }).state;
  assert.deepEqual(ranges(state).map(v => [v.from, v.to]), [[0, 9], [10, 12]]);
  // A typing/undo replacement of that range invalidates it, along with its swatch.
  state = state.update({ changes: { from: 0, to: 9, insert: 'red' } }).state;
  assert.deepEqual(ranges(state).map(v => v.item.name), ['font-size']);
  assert.equal(state.field(valueField).size, 1);
});

test('arrowhead JSON names and filled properties reuse the keyword domains; absent literal metadata stays undecorated', () => {
  const text = 'triangle true red';
  const source = { path: 'main.d2' }, literal = (start, end, kind) => ({ start: pos(start), end: pos(end), kind });
  const assoc = { objects: [{ id: '(a -> b)[0]', properties: {
    'source-arrowhead': { value: 'triangle', source, literal: literal(0, 8, 'unquoted') },
    'source-arrowhead.filled': { value: 'true', source, literal: literal(9, 13, 'bool') },
    fill: { value: 'red', source },
  } }] };
  let state = EditorState.create({ doc: text, extensions: valueField });
  state = state.update({ effects: replaceValues.of(literalDecorations(assoc, 'main.d2', text)) }).state;
  assert.deepEqual(ranges(state).map(v => [v.item.name, v.item.domain.kind]), [['source-arrowhead', 'enum'], ['filled', 'boolean']]);
});

test('untouched ranges map through multiple disjoint edits, and CRLF ranges address the normalized view', () => {
  const text = '# 😀\r\nred 24 40 blue\r\n';
  let state = EditorState.create({ doc: text, extensions: valueField });
  state = state.update({ effects: replaceValues.of(literalDecorations(association(text), 'main.d2', text)) }).state;
  const original = ranges(state).map(v => [v.from, v.to]);
  assert.deepEqual(original, [[5, 8], [9, 11]]);
  state = state.update({ changes: [{ from: 0, insert: '# new\n' }, { from: state.doc.length, insert: '# tail' }] }).state;
  assert.deepEqual(ranges(state).map(v => [v.from, v.to]), original.map(([from, to]) => [from + 6, to + 6]));
  assert.equal(ranges(state)[0].item.used, 2);
});
