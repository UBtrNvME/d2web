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
const markdown = '# Title\n\n## Sub\n\nSome **bold** and *it* and `code` and [link](https://x.test)\n\n- one\n- two\n\n1. first\n2. second\n\n> quote\n\n---\n\n```\nline one\nline two\n```';
const markdownSource = text => 'md: |md\n' + text + '\n|';

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
    // A real selection and copy: drag across the block, then the copy shortcut. d2web rebuilds the text (Firefox and WebKit would copy one token per line).
    await page.evaluate(() => { window.copied = null; document.addEventListener('copy', e => { window.copied = e.clipboardData.getData('text/plain'); }); });
    const tokens = group.locator('pre [data-k="text"]');
    const first = await tokens.first().boundingBox(), last = await tokens.last().boundingBox();
    await page.mouse.move(first.x + 1, first.y + 2);
    await page.mouse.down();
    await page.mouse.move(last.x + last.width - 1, last.y + last.height - 2, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.press('ControlOrMeta+c');
    const out = await group.locator('pre > code').evaluate(el => ({ text: el.textContent, copy: window.copied, lines: [...el.children].map(line => line.textContent),
      ids: [...el.querySelectorAll('[data-id]')].map(e => e.dataset.id) }));
    expect(out.text).toBe(text);
    expect(out.copy, 'the text a copy event carries').toBe(text);
    expect(out.lines).toEqual(text.split('\n').map((line, i, lines) => line + (i + 1 < lines.length ? '\n' : '')));
    expect(out.ids).toEqual(association.objects.find(o => o.id === 'c').nodes.filter(id => id.includes(':code-line:')));
    await page.evaluate(() => { clicked.length = 0; }); // the selecting drag ends in a click as well
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

test('markdown: semantic blocks and inline runs retain D2 text, IDs, names and link focus', async ({ page, browserName }) => {
  const association = await ready(page, markdownSource(markdown));
  const group = page.locator('#a [data-id="md"][role="group"]');
  await expect(group).toHaveAttribute('aria-label', markdown);
  for (const [selector, text] of [['h1', 'Title'], ['h2', 'Sub'], ['strong', 'bold'], ['em', 'it'], ['code:not(pre code)', 'code'], ['blockquote', 'quote']]) {
    expect(await group.locator(selector).evaluate(el => el.innerText.trim())).toBe(text);
  }
  expect((await group.locator('ul > li').allInnerTexts()).map(s => s.trim())).toEqual(['one', 'two']);
  // Keep D2's painted ordered markers as text; display:contents adds no browser markers.
  expect((await group.locator('ol > li').allInnerTexts()).map(s => s.trim().split(/\n+/))).toEqual([['1.', 'first'], ['2.', 'second']]);
  await expect(group.locator('hr')).toHaveCount(1);
  expect(await group.locator('pre > code').evaluate(el => el.innerText.trim().split(/\n+/))).toEqual(['line one', 'line two']);
  const link = group.locator('a[href="https://x.test"]');
  await expect(link).toHaveCount(1);
  expect(await link.evaluate(el => el.innerText.trim())).toBe('link');
  await expect(page.locator('#a a[href="https://x.test"]')).toHaveCount(1);
  await expect(link).toHaveAttribute('aria-label', markdown);
  await expect(link.locator(':scope > span')).toHaveCount(1);
  await page.route('https://x.test/**', route => route.abort());
  await link.evaluate(el => el.addEventListener('click', e => e.preventDefault()));
  await link.locator(':scope > span').click();
  expect(await page.evaluate(() => clicked)).toEqual(['md']);
  await page.evaluate(() => { clicked.length = 0; });
  // Safari leaves links out of the Tab order unless the user enables it (links.spec.mjs).
  if (browserName !== 'webkit') { await group.focus(); await page.keyboard.press('Tab'); await expect(link).toBeFocused(); }
  const out = await group.evaluate(el => ({
    ids: [...el.querySelectorAll('[data-id]')].map(e => e.dataset.id),
    copy: el.innerText.trim().split(/\n+/),
  }));
  expect(out.ids).toEqual(association.objects.find(o => o.id === 'md').nodes.slice(1));
  expect(out.copy).toEqual(['Title', 'Sub', 'Some ', 'bold', ' and ', 'it', ' and ', 'code', ' and ', 'link', 'one', 'two', '1.', 'first', '2.', 'second', 'quote', 'line one', 'line two']);
  await group.locator('strong [data-k="text"]').click({ force: true });
  expect(await page.evaluate(() => clicked)).toEqual(['md']);
});

test('markdown: h3 is 20px; small headings and ambiguous structures stay unwrapped', async ({ page }) => {
  await ready(page, markdownSource('### Third\n\n#### Fourth\n\n##### Fifth\n\n###### Sixth\n\n- outer\n  - nested\n\n- first\n  continuation\n\n~~unknown~~'));
  await expect(page.locator('#a h3')).toHaveText('Third');
  await expect(page.locator('#a h4, #a h5, #a h6, #a ul, #a ol, #a strong, #a em, #a pre')).toHaveCount(0);
  expect(await page.locator('#a [data-id="md:markdown"] [data-k="text"]').allTextContents()).toContain('Fourth\n');
});

test('markdown: missing or contradictory source leaves painted runs unwrapped', async ({ page }) => {
  await ready(page, markdownSource(markdown));
  for (const label of [undefined, 'unrecognised markdown']) {
    await page.evaluate(async label => {
      m.dispose(); result.boards[0].association.objects.find(o => o.id === 'md').label = label;
      m = d2web.mount(document.getElementById('a')); await m.update(result);
    }, label);
    await expect(page.locator('#a h1, #a h2, #a ul, #a ol, #a blockquote, #a hr, #a pre, #a strong, #a em, #a code')).toHaveCount(0);
    await expect(page.locator('#a [data-id="md:markdown"] [data-k="text"]')).toHaveCount(19);
    await expect(page.locator('#a a[href="https://x.test"]')).toHaveCount(1);
  }
});

test('markdown: fenced literals are not headings or emphasis; inline links reuse href safety', async ({ page }) => {
  await ready(page, markdownSource('```\n# literal\n\n**literal**\n```\n\n[link](https://x.test)'));
  await expect(page.locator('#a h1, #a strong')).toHaveCount(0);
  await page.evaluate(async () => {
    m.dispose();
    const board = result.boards[0];
    board.scene.Links[0].URL = 'javascript:alert(1)';
    board.association.objects.find(o => o.id === 'md').label = board.association.objects.find(o => o.id === 'md').label.replace('https://x.test', 'javascript:alert(1)');
    m = d2web.mount(document.getElementById('a')); await m.update(result);
  });
  await expect(page.locator('#a a')).toHaveCount(1);
  await expect(page.locator('#a a')).not.toHaveAttribute('href');
  // An unsafe URL is never wrapped around the text; the region anchor stays, without href, named after its object (links.spec.mjs).
  await expect(page.locator('#a a')).toHaveAttribute('aria-label', /\[link\]\(javascript:alert\(1\)\)/);
});

test('C1: every content, table and shape case matches the checkpoint painter', async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  await open(page, { body: host });
  await page.addScriptTag({ content: beforeBundle });
  const deltas = [];
  for (const entry of [...catalog.filter(e => ['content', 'table', 'shape'].includes(e.family)), { id: 'markdown-semantic-sample', source: markdownSource(markdown) }]) {
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

test('flow markdown: one block with real elements, D2 identity, safe links and one link tab stop', async ({ page, browserName }) => {
  const source = markdown + '\n\n### Third\n\n#### Fourth\n\n##### Fifth\n\n###### Sixth';
  await ready(page, markdownSource(source), { markdown: 'flow' });
  const group = page.locator('#a [data-id="md"][role="group"]');
  await expect(group).toHaveAttribute('aria-label', source);
  const block = group.locator('[data-flow-markdown]');
  await expect(block).toHaveCount(1);
  await expect(group.locator('[data-k="text"]')).toHaveCount(0);
  expect(await block.evaluate(el => [...el.children].map(c => c.tagName.toLowerCase()))).toEqual(['h1', 'h2', 'p', 'ul', 'ol', 'blockquote', 'hr', 'pre', 'h3', 'h4', 'h5', 'h6']);
  for (const [selector, text] of [['h1', 'Title'], ['h2', 'Sub'], ['h3', 'Third'], ['h4', 'Fourth'], ['h5', 'Fifth'], ['h6', 'Sixth'], ['strong', 'bold'], ['em', 'it'], ['p > code', 'code'], ['blockquote > p', 'quote'], ['pre > code', 'line one\nline two\n']]) {
    expect(await block.locator(selector).textContent()).toBe(text);
  }
  expect(await block.locator('ul > li').allTextContents()).toEqual(['one', 'two']);
  expect(await block.locator('ol > li').allTextContents()).toEqual(['first', 'second']);
  expect(await block.locator('p').first().textContent()).toBe('Some bold and it and code and link');
  const link = group.getByRole('link', { name: 'link', exact: true });
  await expect(page.locator('#a a')).toHaveCount(1);
  await expect(link).toHaveAttribute('href', 'https://x.test');
  if (browserName !== 'webkit') { await group.focus(); await page.keyboard.press('Tab'); await expect(link).toBeFocused(); }
  await block.locator('strong').click();
  await link.evaluate(el => el.addEventListener('click', e => e.preventDefault()));
  await link.click();
  expect(await page.evaluate(() => clicked)).toEqual(['md', 'md']);
  const metrics = await block.evaluate(el => ({ fit: JSON.parse(el.dataset.flowFit), width: el.style.width, overflow: getComputedStyle(el).overflow, clip: getComputedStyle(el.parentElement).clipPath }));
  expect(metrics.fit.width).toBeGreaterThan(0);
  expect(metrics.fit.height).toBeGreaterThan(0);
  expect(metrics.overflow).toBe('visible');
  expect(metrics.clip).toBe('none');
  const expected = await page.evaluate(() => {
    const runs = result.boards[0].scene.Root.Children.find(n => n.ID === 'md').Children.find(n => n.ID === 'md:markdown');
    const x = runs.Clip.Path.Commands.filter(c => c.Kind !== 5).map(c => c.P1.X);
    const y = runs.Clip.Path.Commands.filter(c => c.Kind !== 5).map(c => c.P1.Y);
    // D2's box for a markdown object is the clip it applied to it.
    return { width: Math.max(...x) - Math.min(...x), d2: { x: Math.min(...x), y: Math.min(...y), width: Math.max(...x) - Math.min(...x), height: Math.max(...y) - Math.min(...y) } };
  });
  expect(parseFloat(metrics.width)).toBe(expected.width);
  expect(metrics.fit.d2).toEqual(expected.d2);

  await ready(page, markdownSource('[bad](javascript:evil)'), { markdown: 'flow' });
  await expect(group.locator('[data-flow-markdown] a')).toHaveText('bad');
  await expect(page.locator('#a a[href^="javascript:"]')).toHaveCount(0);
});

test('flow markdown: unsupported sources fall back byte for byte; positioned remains the default', async ({ page }) => {
  for (const text of [markdown, '- outer\n  - nested', '- first\n  continuation', '| a | b |\n|---|---|\n| 1 | 2 |', 'plain ~~strike~~', '```\nunfinished', '_underscore_', '<b>raw HTML</b>']) {
    await ready(page, text.includes('|') ? 'md: ||md\n' + text + '\n||' : markdownSource(text), { idPrefix: 'same-' });
    const original = await page.locator('#a').evaluate(el => el.shadowRoot.innerHTML);
    const positioned = await page.evaluate(async () => {
      m.dispose(); m = d2web.mount(document.getElementById('a'), { idPrefix: 'same-', markdown: 'positioned' }); await m.update(result);
      return document.getElementById('a').shadowRoot.innerHTML;
    });
    expect(positioned).toBe(original);
    if (text === markdown) continue;
    const fallback = await page.evaluate(async () => {
      m.dispose(); m = d2web.mount(document.getElementById('a'), { idPrefix: 'same-', markdown: 'flow' }); await m.update(result);
      return document.getElementById('a').shadowRoot.innerHTML;
    });
    expect(fallback, text).toBe(original);
    await expect(page.locator('#a [data-flow-markdown]')).toHaveCount(0);
    await expect(page.locator('#a [data-k="text"]').first()).toBeAttached();
  }
});

test('C2: report flow fit for every catalog markdown object and the semantic sample', async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  await open(page, { body: host });
  const measurements = [];
  try {
    for (const entry of [...catalog, { id: 'markdown-semantic-sample', source: markdownSource(markdown) }]) {
      const rows = await page.evaluate(async entry => {
        const result = await compile(entry.source, { ...entry.render, request: { ...(entry.layout ? { layout: entry.layout } : {}), files: { 'main.d2': entry.source, ...entry.files }, boards: entry.boards ?? [''] } });
        if (result.error) return [{ case: entry.id, error: result.error }];
        const rows = [], host = document.getElementById('a');
        for (const board of result.boards) {
          const objects = board.association.objects.filter(o => o.content === 'markdown');
          if (!objects.length) continue;
          const m = d2web.mount(host, { markdown: 'flow' });
          await m.update(result, board.path);
          for (const object of objects) {
            const group = [...host.shadowRoot.querySelectorAll('[data-id]')].find(el => el.dataset.id === object.id);
            const el = group?.querySelector('[data-flow-markdown]');
            rows.push({ case: entry.id, board: board.path, object: object.id, status: el ? 'flow' : 'positioned-fallback', ...(el ? JSON.parse(el.dataset.flowFit) : {}) });
          }
          m.dispose();
        }
        return rows;
      }, entry);
      measurements.push(...rows);
      for (const row of rows) {
        console.log('markdown flow fit', JSON.stringify(row));
        expect.soft(row.error, `${entry.id}: compiles`).toBeUndefined();
        if (row.status !== 'flow') continue;
        expect.soft(Number.isFinite(row.deltaWidth) && Number.isFinite(row.deltaHeight), `${entry.id}/${row.object}: finite metrics`).toBe(true);
        // C2's literal fit check is diagnostic until measurements establish the first accepted tolerance.
        expect.soft(row.deltaWidth, `${entry.id}/${row.object}: width delta (CSS px)`).toBeLessThanOrEqual(0);
        expect.soft(row.deltaHeight, `${entry.id}/${row.object}: height delta (CSS px)`).toBeLessThanOrEqual(0);
      }
    }
    expect(measurements.some(row => row.status === 'flow')).toBe(true);
  } finally {
    await testInfo.attach('stage-b-flow-fit.json', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
  }
});
