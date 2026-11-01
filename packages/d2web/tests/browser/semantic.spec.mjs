import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { build } from 'esbuild';
import { diff, open, shot } from './harness.mjs';
import { root } from '../../../../tests/examples.mjs';
import { catalog } from '../../../../tests/features/catalog.mjs';

// A real mount using the checkpoint painter, with the same current client, compiler, fonts and baseline calibration.
const beforePaint = execFileSync('git', ['show', 'checkpoint/before-web-native-contracts:packages/d2web/src/paint.js'], { cwd: root, encoding: 'utf8' });
const beforeBundle = (await build({
  entryPoints: [join(root, 'packages/d2web/src/index.ts')], bundle: true, format: 'iife', globalName: 'before', write: false,
  plugins: [{ name: 'checkpoint-painter', setup(build) {
    build.onLoad({ filter: /\/paint\.js$/ }, () => ({ contents: beforePaint, resolveDir: join(root, 'packages/d2web/src'), loader: 'js' }));
  } }],
})).outputFiles[0].text;
const host = '<div id="a" style="position:absolute;left:0;top:0"></div>';
const code = 'const n = 1;\n  // two';
const codeSource = text => 'c: |`ts\n' + text + '\n`|';

async function ready(page, source, options = {}) {
  await open(page, { body: host });
  return page.evaluate(async ({ source, options }) => {
    window.result = await compile(source);
    if (result.error) throw new Error(JSON.stringify(result.error));
    window.m = d2web.mount(document.getElementById('a'), options);
    window.clicked = [];
    m.on('click', e => clicked.push(e.id));
    await m.update(result);
    return result.boards[0].association;
  }, { source, options });
}

for (const [name, text] of [['two source lines', code], ['blank lines and indentation', 'const n = 1;\n\n    // two']]) {
  test(`code: pre > code, one element per line, selectable ${name}`, async ({ page, browserName }) => {
    const association = await ready(page, codeSource(text));
    const group = page.locator('#a [data-id="c"][role="group"]');
    await expect(group).toHaveAttribute('aria-label', text);
    await expect(group.locator('pre > code > span')).toHaveCount(text.split('\n').length);
    const out = await group.locator('pre > code').evaluate(el => {
      const range = document.createRange(); range.selectNodeContents(el);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      const copy = selection.toString(); selection.removeAllRanges();
      return { text: el.textContent, copy, lines: [...el.children].map(line => line.textContent),
        ids: [...el.querySelectorAll('[data-id]')].map(e => e.dataset.id) };
    });
    expect(out.text).toBe(text);
    // Known gap (spec 0009): Firefox and WebKit serialise each absolutely positioned token as its own block, so a selection copies one token per line.
    if (browserName === 'chromium') expect(out.copy, 'the rendered selection that copy reads').toBe(text);
    expect(out.lines).toEqual(text.split('\n').map((line, i, lines) => line + (i + 1 < lines.length ? '\n' : '')));
    expect(out.ids).toEqual(association.objects.find(o => o.id === 'c').nodes.filter(id => id.includes(':code-line:')));
    await group.locator('[data-k="text"]').first().click({ force: true });
    expect(await page.evaluate(() => clicked)).toEqual(['c']);
  });
}

for (const [kind, source, header, rows] of [
  ['sql_table', 't: {shape: sql_table; id: int {constraint: primary_key}; name: text}', 't', [['id', 'int', 'PK'], ['name', 'text', '']]],
  ['class', 't: Klass {shape: class; +field: int; -secret: string; +method(): string}', 'Klass', [['+', 'field', 'int'], ['-', 'secret', 'string'], ['+', 'method()', 'string']]],
]) {
  test(`${kind}: table, header and cells retain D2 order, IDs, group name and events`, async ({ page }) => {
    const association = await ready(page, source);
    const group = page.locator('#a [data-id="t"][role="group"]');
    await expect(group).toHaveAttribute('aria-label', header);
    const table = group.getByRole('table', { name: header, exact: true });
    await expect(table).toHaveCount(1);
    await expect(table.getByRole('columnheader')).toHaveText(header);
    await expect(table.getByRole('row')).toHaveCount(rows.length + 1);
    const out = await table.evaluate(el => ({
      rows: [...el.querySelectorAll('[role="row"]')].slice(1).map(row => [...row.querySelectorAll('[role="cell"]')].map(cell => cell.innerText.trimEnd())),
      ids: [...el.querySelectorAll('[data-id]')].map(e => e.dataset.id),
    }));
    expect(out.rows).toEqual(rows);
    expect(out.ids).toEqual(association.objects.find(o => o.id === 't').nodes.filter(id => id !== 't'));
    await table.getByRole('cell').first().locator('[data-k="text"]').click({ force: true });
    expect(await page.evaluate(() => clicked)).toEqual(['t']);
    expect(association.objects.find(o => o.id === 't').references).not.toHaveLength(0);
  });
}

test('multiline class header stays one columnheader; accessibility opt-out keeps the runs', async ({ page }) => {
  const source = 't: "First\\nSecond" {shape: class; +field: int}';
  await ready(page, source);
  await expect(page.locator('#a').getByRole('columnheader')).toHaveCount(1);
  expect(await page.locator('#a').getByRole('columnheader').locator('[data-k="text"]').allTextContents()).toEqual(['First\n', 'Second\n']);
  await page.evaluate(async () => { m.dispose(); m = d2web.mount(document.getElementById('a'), { a11y: false }); await m.update(result); });
  await expect(page.locator('#a [role]')).toHaveCount(0);
  await expect(page.locator('#a [data-id="t:class-field:0:name"] [data-k="text"]')).toHaveText('field');
});

test('C1: every content, table and shape case matches the checkpoint painter', async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  await open(page, { body: host });
  await page.addScriptTag({ content: beforeBundle });
  const deltas = [];
  for (const entry of catalog.filter(e => ['content', 'table', 'shape'].includes(e.family))) {
    await page.evaluate(async entry => {
      window.result = await compile(entry.source, { ...entry.render, request: { ...(entry.layout ? { layout: entry.layout } : {}), files: { 'main.d2': entry.source, ...entry.files } } });
      if (result.error) throw new Error(JSON.stringify(result.error));
      window.m = before.mount((() => { const h = document.getElementById('a'), c = h.cloneNode(false); h.replaceWith(c); return c; })()); await m.update(result);
    }, entry);
    const previous = await shot(page, '#a');
    const oldBox = await page.evaluate(() => result.boards[0].association.objects.filter(o => o.kind === 'shape').map(o => m.nodeBox(o.id)));
    await page.evaluate(async () => { m.dispose(); m = d2web.mount((() => { const h = document.getElementById('a'), c = h.cloneNode(false); h.replaceWith(c); return c; })()); await m.update(result); });
    const current = await shot(page, '#a');
    const newBox = await page.evaluate(() => result.boards[0].association.objects.filter(o => o.kind === 'shape').map(o => m.nodeBox(o.id)));
    expect.soft(newBox, `${entry.id}: D2 boxes`).toEqual(oldBox);
    const delta = await diff(page, previous, current);
    deltas.push({ id: entry.id, ...delta });
    expect.soft(delta, `${entry.id}: checkpoint pixel delta`).toEqual({ ratio: 0 });
    if (delta.ratio !== 0) {
      await testInfo.attach(entry.id + '.before.png', { body: Buffer.from(previous, 'base64'), contentType: 'image/png' });
      await testInfo.attach(entry.id + '.after.png', { body: Buffer.from(current, 'base64'), contentType: 'image/png' });
    }
    await page.evaluate(() => m.dispose());
  }
  await testInfo.attach('stage-a-pixel-deltas.json', { body: JSON.stringify(deltas, null, 2), contentType: 'application/json' });
});
