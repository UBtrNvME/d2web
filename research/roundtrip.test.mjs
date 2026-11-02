import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { goProbe, root } from '../tests/examples.mjs';

// docs/ideas/d2editor.md, first assumption: editing through d2oracle keeps the author's text. Native only; the measurements are about D2.
test('research: d2oracle edits published as patches to the author\'s text keep it; printed whole they reformat some files', { timeout: 300_000 }, () => {
  const output = join(root, 'artifacts/research-roundtrip');
  mkdirSync(join(output, 'demo'), { recursive: true });
  // The demo's examples, written out as files.
  const html = readFileSync(join(root, 'packages/d2web/demo/index.html'), 'utf8');
  const start = html.indexOf('const examples = {') + 'const examples = '.length;
  let depth = 0, end = start;
  for (; end < html.length; end++) if (html[end] === '{') depth++; else if (html[end] === '}' && !--depth) break;
  const examples = new Function(`return (${html.slice(start, end + 1)})`)();
  const demo = Object.entries(examples).filter(([, v]) => typeof v === 'string').map(([name, text]) => {
    const file = join(output, 'demo', `${name.replace(/[^a-z0-9]+/gi, '_')}.d2`);
    writeFileSync(file, text);
    return file;
  });
  const corpus = readdirSync(join(root, 'examples/files')).filter(f => f.endsWith('.d2')).map(f => join(root, 'examples/files', f));
  // d2format lowercases keyword-spelled labels; a patch must leave the author's `Scenarios` alone when the edit is elsewhere.
  const keyword = join(output, 'keyword-labels.d2');
  writeFileSync(keyword, 'testing: Scenarios {\n  a\n}\nx: Layers\nx -> testing.a\n');
  const probe = goProbe(join(root, 'research/roundtrip.go'), join(output, 'probe'), false);
  const files = JSON.parse(probe.native([...demo, ...corpus, keyword]));
  writeFileSync(join(output, 'result.json'), JSON.stringify(files, null, 2));

  const editable = files.filter(f => !f.error);
  assert.ok(editable.length >= 80, `${editable.length} editable files`);
  for (const f of editable) for (const e of f.edits) {
    assert.ok(!e.error || e.error === 'no edge', `${f.file} ${e.name}: ${e.error}`); // no oracle error or panic on these edits
    if (e.error) continue;
    if (f.format === 0) assert.equal(e.damage, 0, `${f.file} ${e.name} changed lines outside the edit`);
    // Patch publishing: always means what the edit API produced; on files in d2fmt form it is exactly the edit.
    assert.ok(e.equivalent, `${f.file} ${e.name}: patched text is not equivalent to the edit`);
    if (f.format === 0) assert.equal(e.extra, 0, `${f.file} ${e.name}: patch changed lines outside the edit`);
    if (e.name !== 'relabel' && f.file !== keyword) assert.deepEqual(e.labelChanges ?? [], [], `${f.file} ${e.name}: labels it did not target changed`);
  }
  // Recorded 2 November 2026: 9 of 782 edits change one extra line, all in the demo's Layers example (d2fmt adds a blank line beside the edit).
  const extra = editable.flatMap(f => f.edits.filter(e => e.extra).map(e => [f.file.split('/').pop(), e.name, e.extra]));
  console.log('patches changing lines beyond the edit:', JSON.stringify(extra));
  assert.ok(extra.every(([, , n]) => n <= 1), 'a patch changed more than one line beyond its edit');
  const kw = editable.find(f => f.file === keyword);
  assert.ok(kw.format > 0, 'd2format still lowercases keyword-spelled labels');
  // Edits elsewhere keep `Scenarios`; deleting the block's only child rewrites that very line, and only the label guard catches it.
  assert.deepEqual(Object.fromEntries(kw.edits.filter(e => e.labelChanges).map(e => [e.name, e.labelChanges])), { 'delete-shape': ['testing: "Scenarios" -> "scenarios"'] });
  // Recorded 2 November 2026: 80 of 90 editable files print unchanged; the other 10 are reformatted by the first edit, whatever it is.
  const reformatted = editable.filter(f => f.format > 0).map(f => f.file.split('/').pop()).sort();
  console.log('reformatted by d2format:', reformatted.join(', '));
  assert.ok(reformatted.includes('tpmjs_architecture.d2'), 'keyword-like labels are lowercased by d2format (see the idea doc)');
});
