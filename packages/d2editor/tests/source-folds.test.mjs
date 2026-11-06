import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorState } from '@codemirror/state';
import { foldEffect, foldedRanges, foldable } from '@codemirror/language';
import { bodyRanges, foldField, replaceFolds, sourceFolds, diagnosticUnfolds } from '../src/source-folds.ts';

const text = '# 😀\r\na: {\r\n  b: B\r\n}\r\nz: Z\r\n';
const association = text => ({ objects: [{ bodies: [{ path: 'main.d2', start: { offset: text.indexOf('{') }, end: { offset: text.indexOf('}') + 1 } }] }] });
function setup() {
  let state = EditorState.create({ doc: text, extensions: sourceFolds });
  state = state.update({ effects: replaceFolds.of(bodyRanges(association(text), 'main.d2', text)) }).state;
  return state;
}
test('body folds address normalized UTF-16 text and omit single-line and foreign maps', () => {
  const state = setup(), range = state.field(foldField)[0];
  assert.equal(state.doc.sliceString(range.from - 1, range.to + 1), '{\n  b: B\n}');
  assert.deepEqual(foldable(state, state.doc.line(2).from, state.doc.line(2).to), range);
  assert.deepEqual(bodyRanges(association('a: {}'), 'main.d2', 'a: {}'), []);
  assert.deepEqual(bodyRanges(association(text), 'other.d2', text), []);
  assert.deepEqual(bodyRanges(undefined, 'main.d2', text), []);
});

test('an edit anywhere on a body line unfolds and invalidates it until refresh', () => {
  let state = setup(), range = state.field(foldField)[0];
  state = state.update({ effects: foldEffect.of(range) }).state;
  assert.equal(foldedRanges(state).size, 1);
  state = state.update({ changes: { from: state.doc.line(2).from, insert: 'x' } }).state;
  assert.equal(foldedRanges(state).size, 0);
  assert.deepEqual(state.field(foldField), []);
  const next = state.doc.toString();
  state = state.update({ effects: replaceFolds.of(bodyRanges(association(next), 'main.d2', next)) }).state;
  assert.equal(state.field(foldField).length, 1);
});

test('unrelated edits map folds and diagnostics inside them unfold without changing text', () => {
  let state = setup(), range = state.field(foldField)[0];
  state = state.update({ effects: foldEffect.of(range) }).state;
  state = state.update({ changes: { from: 0, insert: '# new\n' } }).state;
  range = state.field(foldField)[0];
  assert.equal(foldedRanges(state).size, 1);
  const before = state.doc.toString();
  state = state.update({ effects: diagnosticUnfolds(state, [{ from: range.from + 1, to: range.from + 1 }]) }).state;
  assert.equal(foldedRanges(state).size, 0);
  assert.equal(state.doc.toString(), before);
  assert.equal(state.field(foldField).length, 1);
});

test('edits on either fold boundary unfold; switching away from the root clears folds', () => {
  for (const boundary of ['from', 'to']) {
    let state = setup(), range = state.field(foldField)[0];
    state = state.update({ effects: foldEffect.of(range) }).state;
    state = state.update({ changes: { from: range[boundary], insert: ' ' } }).state;
    assert.equal(foldedRanges(state).size, 0, boundary);
    assert.equal(state.field(foldField).length, 0);
  }
  let state = setup();
  state = state.update({ effects: foldEffect.of(state.field(foldField)[0]) }).state;
  state = state.update({ effects: replaceFolds.of([]) }).state;
  assert.equal(foldedRanges(state).size, 0);
});

test('nested and repeated declarations fold independently, while touching an inner line invalidates its ancestors', () => {
  const text = 'a: {\n b: {\n  c\n }\n}\na: {\n d\n}\nz: {\n Z\n}\n';
  const body = (from, to) => ({ path: 'main.d2', start: { offset: from }, end: { offset: to } });
  const outerEnd = text.indexOf('\n}\n') + 2, again = text.indexOf('a:', outerEnd), z = text.indexOf('z:');
  const assoc = { objects: [
    { bodies: [body(text.indexOf('{'), outerEnd), body(text.indexOf('{', again), text.indexOf('}', again) + 1)] },
    { bodies: [body(text.indexOf('{', text.indexOf('b:')), text.indexOf('}') + 1)] },
    { bodies: [body(text.indexOf('{', z), text.indexOf('}', z) + 1)] },
  ] };
  let state = EditorState.create({ doc: text, extensions: sourceFolds });
  const ranges = bodyRanges(assoc, 'main.d2', text);
  assert.equal(ranges.length, 4);
  state = state.update({ effects: replaceFolds.of(ranges) }).state;
  state = state.update({ effects: ranges.map(r => foldEffect.of(r)) }).state;
  state = state.update({ changes: { from: text.indexOf('c'), insert: 'x' } }).state;
  assert.equal(foldedRanges(state).size, 2);
  assert.equal(state.field(foldField).length, 2);
});
