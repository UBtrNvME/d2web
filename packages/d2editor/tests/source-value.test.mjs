import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeLiteral, textChange, rawOffset } from '../src/source-value.ts';
import table from '../src/keywords.json' with { type: 'json' };

const domain = name => table.keywords.find(k => k.name === name).domain;
test('color writer preserves quotes and alpha and quotes a named color replacement', () => {
  const write = (text, kind, value) => writeLiteral(text, kind, domain('fill'), value);
  assert.equal(write('red', 'unquoted', '#AAbbCC'), '"#aabbcc"');
  assert.equal(write('"red"', 'double-quoted', '#123456'), '"#123456"');
  assert.equal(write("'#12345680'", 'single-quoted', '#abcdef'), "'#abcdef80'");
  assert.equal(write('"#abcd"', 'double-quoted', '#123456'), '"#123456dd"');
  assert.equal(write('red', 'unquoted', '#abc'), '"#aabbcc"');
  assert.equal(write('red', 'unquoted', 'invalid'), 'red');
});

test('numbers use table bounds; bool and enum replacements are bare', () => {
  for (const [name, input, expected] of [['opacity', 2, '1'], ['opacity', -1, '0'], ['opacity', 0.35, '0.35'], ['font-size', 2, '8'], ['stroke-width', 99, '15'], ['border-radius', 500, '500']]) {
    assert.equal(writeLiteral('1', 'number', domain(name), input), expected);
  }
  for (const input of ['', NaN, Infinity, 'oops']) assert.equal(writeLiteral('12', 'number', domain('font-size'), input), '12');
  assert.equal(writeLiteral('true', 'bool', domain('bold'), false), 'false');
  assert.equal(writeLiteral('false', 'bool', domain('bold'), true), 'true');
  assert.equal(writeLiteral('"rectangle"', 'double-quoted', domain('shape'), 'circle'), 'circle');
  assert.equal(writeLiteral('rectangle', 'unquoted', domain('shape'), 'invented'), 'rectangle');
});

test('text replacement leaves other literals and CRLF source intact, including UTF-16 offsets', () => {
  const text = '# 😀\r\na.style.fill: red\r\nb.style.fill: blue\r\n';
  const shown = text.replaceAll('\r\n', '\n'), from = shown.indexOf('red');
  assert.equal(rawOffset(text, from), text.indexOf('red'));
  const after = text.replace('red', '"#112233"');
  const change = textChange(shown, after.replaceAll('\r\n', '\n'));
  assert.deepEqual(change, { from, to: from + 3, insert: '"#112233"' });
  assert.equal(shown.slice(0, change.from) + change.insert + shown.slice(change.to), after.replaceAll('\r\n', '\n'));
  assert.deepEqual(textChange('same', 'same'), { from: 4, to: 4, insert: '' });
});
