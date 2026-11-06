import assert from 'node:assert/strict';
import { test } from 'node:test';
import { valueSources } from '../src/outline-view.ts';

const source = { path: 'main.d2', start: { line: 2, column: 4, offset: 20 }, end: { line: 2, column: 20, offset: 36 } };
test('provenance trusts D2 inherited flags, uses keyword names and prefers literal jumps', () => {
  const object = { properties: {
    fill: { value: 'red', source, inherited: true, literal: { start: { offset: 32 } } },
    fontSize: { value: '24', source, inherited: true },
    stroke: { value: 'blue', source },
    label: { value: 'Own', source, inherited: false },
    unknown: { value: 'value', source, inherited: true },
    bold: { value: 'true', source: null, inherited: true },
  } };
  assert.deepEqual(valueSources(object), [
    { name: 'fill', value: 'red', path: 'main.d2', line: 3, offset: 32 },
    { name: 'font-size', value: '24', path: 'main.d2', line: 3, offset: 20 },
    { name: 'unknown', value: 'value', path: 'main.d2', line: 3, offset: 20 },
  ]);
  assert.deepEqual(valueSources({ properties: { fill: { value: 'red', source } } }), []);
});
