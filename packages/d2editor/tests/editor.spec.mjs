import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync, cpSync } from 'node:fs';
import { join, extname } from 'node:path';
import { buildSync } from 'esbuild';
import { root } from '../../../tests/examples.mjs';

const dist = join(root, 'packages/d2editor/dist');
// Exercise the view through CodeMirror's public API, without adding a test API to the application.
const cmFixture = buildSync({
  stdin: { contents: "export { EditorView } from '@codemirror/view';", resolveDir: join(root, 'packages/d2editor') },
  bundle: true, write: false, format: 'iife', globalName: 'cm',
}).outputFiles[0].text;
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.wasm': 'application/wasm' };
async function open(page, path = '/', { visual = false } = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    const traffic = window.traffic = { requests: [], edits: [], results: [], animations: [] };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', event => {
          const r = event.data;
          if (r.type === 'edited') {
            traffic.edits.push(r);
            if (traffic.hold) { event.stopImmediatePropagation(); traffic.held = { worker: this, data: r }; }
          }
          if (r.type === 'result') {
            traffic.results.push({ revision: r.revision, echo: r.echo, error: r.error });
            if (traffic.holdAbove !== undefined && r.revision > traffic.holdAbove) { event.stopImmediatePropagation(); traffic.heldResult = { worker: this, data: r }; }
          }
        });
      }
      postMessage(message, ...rest) { traffic.requests.push(message); super.postMessage(message, ...rest); }
    };
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      traffic.animations.push({ id: this.getAttribute('data-id'), frames });
      return animate.call(this, frames, options);
    };
  });
  await page.route('http://localhost:5281/**', route => {
    const name = new URL(route.request().url()).pathname.slice(path.length) || 'index.html';
    return route.fulfill({ body: readFileSync(join(dist, name)), contentType: types[extname(name)] ?? 'text/plain' });
  });
  await page.goto(`http://localhost:5281${path}${visual ? '?visual=1' : ''}`);
  await expect(page.locator('#status')).toContainText('compiled in', { timeout: 90_000 });
  expect(errors).toEqual([]);
  return errors;
}

const painted = page => expect(page.locator('#status')).toContainText('compiled in', { timeout: 90_000 });
const object = (page, id) => page.locator(`#host [data-id=${JSON.stringify(id)}]`);
// Object ownership frames can be zero-sized; click their painted child so the real delegated pointer event selects the object.
const select = (page, id) => object(page, id).locator('[data-k="rect"], [data-k="text"], svg').first().click({ position: { x: 5, y: 5 } });
const visible = (page, id) => expect(object(page, id).locator('[data-k]').first()).toBeVisible();
// CodeMirror reads document.body at load, so the helper is a script tag added when needed, not an init script (it would be lost on reload).
const withCm = async page => { if (!await page.evaluate(() => 'cm' in window)) await page.addScriptTag({ content: cmFixture }); };
const source = async page => { await withCm(page); return page.evaluate(() => cm.EditorView.findFromDOM(document.querySelector('#src .cm-editor')).state.doc.toString()); };
const sourceInput = page => page.locator('#src .cm-content');
function expectSource(page, text) {
  const value = expect.poll(() => source(page));
  return typeof text === 'string' ? value.toBe(text) : value.toMatch(text);
}
const caret = async page => { await withCm(page); return page.evaluate(() => cm.EditorView.findFromDOM(document.querySelector('#src .cm-editor')).state.selection.main.head); };
const moveCaret = async (page, anchor) => { await withCm(page); return page.evaluate(anchor => {
  const view = cm.EditorView.findFromDOM(document.querySelector('#src .cm-editor'));
  view.focus();
  view.dispatch({ selection: { anchor } });
}, anchor); };
async function type(page, text) {
  await sourceInput(page).fill(text);
  await painted(page);
}
async function property(page, name, value) {
  await page.locator(`#props [name="${name}"]`).fill(value);
  await page.locator(`#props [name="${name}"]`).press('Tab');
}
async function patch(page, expected, action) {
  const before = await source(page), count = await page.evaluate(() => traffic.edits.length);
  await action();
  await expect.poll(() => page.evaluate(() => traffic.edits.length), { timeout: 90_000 }).toBe(count + 1);
  const result = await page.evaluate(() => traffic.edits.at(-1));
  expect(result.error).toBeUndefined();
  let rebuilt = before;
  for (const edit of [...result.patch.edits].reverse()) rebuilt = rebuilt.slice(0, edit.start) + edit.text + rebuilt.slice(edit.end);
  expect(rebuilt).toBe(expected);
  expect(result.patch.text).toBe(expected);
  await expectSource(page, expected);
  await painted(page);
  return result;
}

test.setTimeout(180_000);

test('built page loads its real worker and wasm and paints the starter diagram', async ({ page }) => {
  await open(page);
  await visible(page, 'api');
  // As the demo: the canvas takes D2's solid scene background and the board's own background rectangle is hidden, so the dots run under the diagram.
  const paper = await object(page, 'root:background').locator('[data-k="rect"]').evaluate(el => getComputedStyle(el).backgroundColor);
  await expect(page.locator('#canvas')).toHaveCSS('background-color', paper);
  await expect(object(page, 'root:background')).toBeHidden();
  await type(page, 'fresh: Typed\n');
  await visible(page, 'fresh');
  await expect(object(page, 'api')).toHaveCount(0);
});

test('the canvas pans by dragging empty space without selecting, zooms with the controls, and a click still selects', async ({ page }) => {
  await open(page);
  const scale = () => page.locator('#host').evaluate(el => +el.style.transform.match(/scale\(([\d.]+)\)/)[1]);
  const box = await object(page, 'api').locator('[data-k="rect"]').first().boundingBox();
  const canvas = await page.locator('#canvas').boundingBox();
  await page.mouse.move(canvas.x + 10, canvas.y + 10);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 85, canvas.y + 50, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('#inspector')).toBeHidden();
  expect(await page.evaluate(() => traffic.edits.length)).toBe(0);
  const moved = await object(page, 'api').locator('[data-k="rect"]').first().boundingBox();
  expect([Math.round(moved.x - box.x), Math.round(moved.y - box.y)]).toEqual([75, 40]);
  // The idle recompile (default seeds) may change the layout's size after load; wait for it, then fit.
  await expect.poll(() => page.evaluate(() => traffic.results.at(-1)?.echo.seeds)).toEqual([1, 2, 3]);
  await painted(page);
  await page.click('#fit');
  const fitted = await page.locator('#zoom').textContent(), k = await scale();
  await page.click('#zoom-in');
  await expect.poll(scale).toBeCloseTo(k * 1.25, 4);
  await expect(page.locator('#zoom')).toHaveText(`${Math.round(k * 125)}%`);
  await page.click('#fit');
  await expect(page.locator('#zoom')).toHaveText(fitted);
  await select(page, 'api');
  await expect(page.locator('#selected')).toHaveText('Shape api');
  // The selection is outlined on the canvas, once, and cleared with Escape.
  await expect(page.locator('#host .selection')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#host .selection')).toHaveCount(0);
  // Zoomed in and panned away, focusing the lowest object brings its own paint into view, not the scene origin its <svg> wrappers sit at.
  for (let i = 0; i < 5; i++) await page.click('#zoom-in');
  await page.locator('#canvas').dispatchEvent('wheel', { deltaX: 0, deltaY: 5000 });
  await object(page, 'db').first().evaluate(el => el.focus());
  const view = await page.locator('#canvas').boundingBox(), shape = await object(page, 'db').locator('path').first().boundingBox();
  expect(shape.y >= view.y && shape.y + shape.height <= view.y + view.height).toBe(true);
});

// Spec 0014: the painted box of the selected object (its outline is drawn at D2's box) and a drag in screen pixels.
const outline = page => page.locator('#host .selection').evaluate(el => ({ X: parseFloat(el.style.left), Y: parseFloat(el.style.top) }));
const zoom = page => page.locator('#host').evaluate(el => +el.style.transform.match(/scale\(([\d.]+)\)/)[1]);
async function drag(page, id, dx, dy) {
  const b = await object(page, id).locator('[data-k]').first().boundingBox();
  await page.mouse.move(b.x + 4, b.y + 4);
  await page.mouse.down();
  await page.mouse.move(b.x + 4 + dx, b.y + 4 + dy, { steps: 6 });
  await page.mouse.up();
}

test('dragging a shape on TALA writes top/left where it was dropped; again adds the distance; Undo restores the text', async ({ page }) => {
  await open(page, '/', { visual: true });
  const text = 'a: A\nb: B\na -> b\n';
  await type(page, text);
  await select(page, 'a');
  const before = await outline(page), k = await zoom(page);
  const count = await page.evaluate(() => traffic.edits.length);
  await drag(page, 'a', 90, 60);
  await expect.poll(() => page.evaluate(() => traffic.edits.length)).toBe(count + 1);
  const left = Math.round(before.X + 90 / k), top = Math.round(before.Y + 60 / k);
  await expectSource(page, new RegExp(`top: ${top}[\\s\\S]*left: ${left}|left: ${left}[\\s\\S]*top: ${top}`));
  await painted(page);
  await expect(page.locator('#selected')).toHaveText('Shape a');
  expect(await outline(page)).toEqual({ X: left, Y: top });
  await drag(page, 'a', -30, 15);
  await expectSource(page, new RegExp(`top: ${top + Math.round(15 / k)}`));
  await painted(page);
  await page.click('#undo');
  await page.click('#undo');
  await expectSource(page, text);
});

test('a nested shape beside a fixed sibling lands where dropped; on other engines a drop in its own parent returns with a hint and no edit', async ({ page }) => {
  await open(page, '/', { visual: true });
  await type(page, 'c: {\n  d: {top: 30; left: 40}\n  e\n}\n');
  await select(page, 'c.e');
  const before = await outline(page), k = await zoom(page);
  await drag(page, 'c.e', 50, 80);
  await expectSource(page, /e: \{|e\.top|top: \d+[\s\S]*top: \d+/);
  await painted(page);
  const after = await outline(page);
  expect(Math.abs(after.X - (before.X + 50 / k))).toBeLessThanOrEqual(1);
  expect(Math.abs(after.Y - (before.Y + 80 / k))).toBeLessThanOrEqual(1);
  // dagre ignores positions, as D2's library does (only the d2 CLI refuses them).
  await page.selectOption('#layout', 'dagre');
  await painted(page);
  await type(page, 'x: X\ny: Y\n');
  const count = await page.evaluate(() => traffic.edits.length);
  const at = await object(page, 'x').locator('[data-k]').first().boundingBox();
  await drag(page, 'x', 60, 0);
  await expect(page.locator('#status')).toContainText('need the TALA layout engine');
  // Spec 0015 §3.3: the shape returns (it no longer pans the canvas).
  const moved = await object(page, 'x').locator('[data-k]').first().boundingBox();
  expect(Math.round(moved.x - at.x)).toBe(0);
  expect(await page.evaluate(() => traffic.edits.length)).toBe(count);
});

// Spec 0015: zones and drag-to-connect (visual editing, behind `?visual=1`).
const box = (page, id) => object(page, id).locator('[data-k]').first().boundingBox();
async function dragTo(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}
const centre = b => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
// Hover a shape and press its right-hand handle (editor chrome in the scene, spec 0015 §3.4).
async function fromHandle(page, id, to) {
  const b = await box(page, id);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  const handle = page.locator('#host .handle').nth(1);
  await expect(handle).toBeVisible();
  await dragTo(page, centre(await handle.boundingBox()), to);
}

test('dropping a shape into a zone moves it there on any engine; out to empty space moves it to the root; leaves are not targets', async ({ page }) => {
  await open(page, '/', { visual: true });
  await page.selectOption('#layout', 'dagre');
  await type(page, 'classes: {zone: {style.stroke-dash: 3}}\nvpc: {class: zone}\nb\nnote: |md # hi |\nb -> note\n');
  const count = await page.evaluate(() => traffic.edits.length);
  await dragTo(page, centre(await box(page, 'b')), centre(await box(page, 'note')));
  await expect(page.locator('#status')).toContainText('need the TALA layout engine');
  expect(await page.evaluate(() => traffic.edits.length)).toBe(count);
  await dragTo(page, centre(await box(page, 'b')), centre(await box(page, 'vpc')));
  await expectSource(page, /vpc: \{\n  class: zone\n  b\n\}[\s\S]*vpc\.b -> note/);
  await painted(page);
  await expect(page.locator('#selected')).toHaveText('Shape vpc.b');
  const view = await page.locator('#canvas').boundingBox();
  await dragTo(page, centre(await box(page, 'vpc.b')), { x: view.x + view.width - 30, y: view.y + 30 });
  await expectSource(page, /\nb -> note|\nb\n/);
  expect(await source(page)).not.toContain('vpc.b');
});

test('a refused move returns the shape and shows the worker’s reason; the text is unchanged', async ({ page }) => {
  await open(page, '/', { visual: true });
  const text = 'classes: {zone: {style.stroke-dash: 3}}\nvpc: {class: zone}\na\nscenarios: {s: {a -> c}}\n';
  await type(page, text);
  await dragTo(page, centre(await box(page, 'a')), centre(await box(page, 'vpc')));
  await expect(page.locator('#status')).toContainText('referenced in scenarios/s');
  await expectSource(page, text);
});

test('drag from a handle connects to a shape, creates a shape on empty space, and Escape cancels', async ({ page }) => {
  await open(page, '/', { visual: true });
  await type(page, 'a\nb\n');
  await fromHandle(page, 'a', centre(await box(page, 'b')));
  await expectSource(page, 'a\nb\na -> b\n');
  await painted(page);
  const view = await page.locator('#canvas').boundingBox();
  await fromHandle(page, 'b', { x: view.x + view.width - 40, y: view.y + 40 });
  await expectSource(page, 'a\nb\na -> b\nshape 2\nb -> shape 2\n');
  await painted(page);
  await expect(page.locator('#rename input')).toBeFocused();
  await page.keyboard.press('Escape');
  // Escape during a handle drag cancels it.
  const count = await page.evaluate(() => traffic.edits.length);
  const b = await box(page, 'a');
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  const handle = centre(await page.locator('#host .handle').nth(1).boundingBox());
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(view.x + 40, view.y + view.height - 40, { steps: 6 });
  await expect(page.locator('#host .rubber-band')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('#host .rubber-band')).toHaveCount(0);
  expect(await page.evaluate(() => traffic.edits.length)).toBe(count);
});

// Spec 0016: a drop past the origin sits at 0 and the container's other shapes move by the overshoot.
// Samples an object's screen left/top on every frame until stopped, so a jump between frames shows.
const sample = (page, ids) => page.evaluate(ids => {
  const seen = window.seen = { stop: false, frames: [] };
  const pos = id => { const el = document.querySelector('#host').shadowRoot.querySelector(`[data-id=${JSON.stringify(id)}] [data-k]`); return el && el.getBoundingClientRect(); };
  const frame = () => { seen.frames.push(Object.fromEntries(ids.map(id => [id, pos(id) && { x: pos(id).x, y: pos(id).y }]))); if (!seen.stop) requestAnimationFrame(frame); };
  frame();
}, ids);
// Pans so the origin lies inside the viewport, then drags `id` inside the canvas but past that origin along one axis.
async function pastOrigin(page, text, id, others, axis, reachOf) {
  await open(page, '/', { visual: true });
  await type(page, text);
  await select(page, id);
  const view = await page.locator('#canvas').boundingBox();
  await page.mouse.move(view.x + view.width / 2, view.y + view.height - 20);
  if (!reachOf) await page.mouse.wheel(axis === 'x' ? -150 : 0, axis === 'y' ? -150 : 0);
  const k = await zoom(page), before = { [id]: await box(page, id) };
  for (const o of others) before[o] = await box(page, o);
  const at = before[id], reach = reachOf ? reachOf(before, k) : axis === 'x' ? at.x - view.x - 40 : at.y - view.y - 40;
  const from = { x: at.x + 4, y: at.y + 4 }, to = axis === 'x' ? { x: from.x - reach, y: from.y } : { x: from.x, y: from.y - reach };
  const host = await page.locator('#host').boundingBox();
  if (!reachOf) expect(axis === 'x' ? at.x - reach : at.y - reach).toBeLessThan(axis === 'x' ? host.x : host.y);
  return { k, before, reach, from, to, view, host };
}
const drop = async (page, { from, to }, ids) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await sample(page, ids);
};

test('dragging past the left origin keeps the layout the author drew; the DOM predicts it before the worker answers, nothing jumps, and the diff is marked', async ({ page }) => {
  const text = 'a: A\n\n# between\n\nb: B\na -> b\n';
  const m = await pastOrigin(page, text, 'a', ['b'], 'x');
  const { k, before, reach } = m;
  const count = await page.evaluate(() => traffic.edits.length);
  await drop(page, m, ['a', 'b']);
  // Mid-drag the shape is painted past the board's own box (the scene no longer clips).
  expect((await box(page, 'a')).x).toBeLessThan(m.host.x - 20);
  await expect(object(page, 'a').locator('[data-k]').first()).toBeVisible();
  // Hold only the compile this edit causes: one already in flight must still finish, or the edit waits behind it.
  await page.evaluate(() => { traffic.holdAbove = Math.max(0, ...traffic.requests.map(q => q.revision ?? 0)); });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => traffic.edits.length)).toBe(count + 1);
  await expectSource(page, /a: A \{[\s\S]*left: 0[\s\S]*b: B \{[\s\S]*left: \d+/);
  await expect(page.locator('#src .patch-mark.side').first()).toBeAttached();
  await expect(page.locator('#src .patch-mark:not(.side)').first()).toBeAttached();
  // Virtual state: with the compile held, the shape is where it was dropped and the sibling has not moved on screen.
  await page.waitForTimeout(300);
  expect(Math.abs((await box(page, 'a')).x - m.to.x + 4)).toBeLessThanOrEqual(3);
  expect(Math.abs((await box(page, 'b')).x - before.b.x)).toBeLessThanOrEqual(3);
  await page.evaluate(() => { traffic.holdAbove = undefined; const h = traffic.heldResult; h.worker.dispatchEvent(new MessageEvent('message', { data: h.data })); });
  await painted(page);
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.seen.stop = true; });
  // No frame from the drop to the settled board moved the dropped shape, and the sibling stays within TALA's drift of where it was.
  const frames = (await page.evaluate(() => window.seen.frames)).filter(f => f.a && f.b);
  expect(frames.length).toBeGreaterThan(10);
  for (const f of frames) {
    expect(Math.abs(f.a.x - (m.to.x - 4))).toBeLessThanOrEqual(3);
    expect(Math.abs(f.b.x - before.b.x)).toBeLessThanOrEqual(6 * k);
  }
  const a1 = await box(page, 'a'), b1 = await box(page, 'b');
  expect(Math.abs((b1.x - a1.x) - ((before.b.x - before.a.x) + reach))).toBeLessThanOrEqual(2 * k + 2);
  expect(Math.abs(a1.y - before.a.y)).toBeLessThanOrEqual(3);
  // One drag rewrote this many lines (spec 0016 section 4).
  const after = await source(page), old = text.split('\n');
  const changed = after.split('\n').filter(l => { const i = old.indexOf(l); if (i < 0) return true; old.splice(i, 1); return false; }).length;
  test.info().annotations.push({ type: 'changed lines', description: String(changed) });
  expect(changed).toBeLessThanOrEqual(10);
  await page.click('#undo');
  await expectSource(page, text);
});

test('dragging past the top origin shifts siblings down, and the shape stays under the pointer', async ({ page }) => {
  const text = 'a: A\n\n# between\n\nb: B\na -> b\n';
  const m = await pastOrigin(page, text, 'a', ['b'], 'y');
  await drop(page, m, ['a', 'b']);
  await page.mouse.up();
  await expectSource(page, /a: A \{[\s\S]*top: 0[\s\S]*b: B \{[\s\S]*top: \d+/);
  await painted(page);
  await page.waitForTimeout(400);
  const a1 = await box(page, 'a'), b1 = await box(page, 'b');
  expect(Math.abs(a1.y - (m.to.y - 4))).toBeLessThanOrEqual(3);
  expect(Math.abs((b1.y - a1.y) - ((m.before.b.y - m.before.a.y) + m.reach))).toBeLessThanOrEqual(2 * m.k + 2);
  expect(Math.abs(a1.x - m.before.a.x)).toBeLessThanOrEqual(3);
});

test('a nested shape dragged past its container\'s origin shifts that container\'s other shapes', async ({ page }) => {
  const m = await pastOrigin(page, 'c: {\n  d: {top: 30; left: 40}\n  e\n}\nz: Z\n', 'c.e', ['c.d', 'z'], 'x',
    // Drop 20 px left of the container's origin (d's left edge minus its `left: 40`): inside the container's padding band, so a shift, not a reparent.
    (before, k) => before['c.e'].x - (before['c.d'].x - 40 * k) + 20 * k);
  await drop(page, m, ['c.e', 'c.d', 'z']);
  await page.mouse.up();
  await expectSource(page, /d: \{top: 30; left: (?!40\b)\d+\}[\s\S]*e: \{[\s\S]*left: 0/);
  await painted(page);
  await page.waitForTimeout(400);
  const e1 = await box(page, 'c.e'), d1 = await box(page, 'c.d');
  expect(Math.abs(e1.x - (m.to.x - 4))).toBeLessThanOrEqual(6);
  expect(Math.abs((d1.x - e1.x) - ((m.before['c.d'].x - m.before['c.e'].x) + m.reach))).toBeLessThanOrEqual(2 * m.k + 4);
});

test('a nested shape is shifted, not moved out, while it still overlaps its container, even with the pointer outside the container', async ({ page }) => {
  const m = await pastOrigin(page, 'c: {\n  d: {top: 30; left: 40}\n  e\n}\n', 'c.e', ['c.d', 'c'], 'x',
    // The pointer ends 10 px left of the container's box; the shape (pressed 4 px in) still overlaps it.
    before => (before['c.e'].x + 4) - (before.c.x - 10));
  await drop(page, m, ['c.e']);
  await page.mouse.up();
  await expectSource(page, /^c: \{[\s\S]*\n  e: \{[\s\S]*left: 0[\s\S]*\n\}\n$/);
});

test('restyle, relabel, create, connect, rename and delete use only the exact checked patches', async ({ page }) => {
  const errors = await open(page, '/repo/editor/', { visual: true });
  await type(page, '# services\na: API\nb: DB\n');
  await select(page, 'a');
  await expect(page.locator('#selected')).toHaveText('Shape a');
  const red = '# services\na: API {style.fill: "#ff0000"}\nb: DB\n';
  await patch(page, red, () => property(page, 'fill', '#ff0000'));
  expect(await object(page, 'a').evaluate(el => [el, ...el.querySelectorAll('*')].some(e => getComputedStyle(e).backgroundColor === 'rgb(255, 0, 0)' || getComputedStyle(e).fill === 'rgb(255, 0, 0)'))).toBe(true);
  await expect(page.locator('#src .patch-mark')).not.toHaveCount(0);
  const label = '# services\na: Gateway {style.fill: "#ff0000"}\nb: DB\n';
  await patch(page, label, () => property(page, 'label', 'Gateway'));
  await expect(object(page, 'a')).toContainText('Gateway');
  const created = label;
  await select(page, 'a');
  await page.click('#connect');
  // Connect mode must look pressed: toolbar buttons are otherwise transparent.
  await expect(page.locator('#connect')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const connected = created + 'a -> b\n';
  await patch(page, connected, () => select(page, 'b'));
  await expect(object(page, '(a -> b)[0]').locator('path').first()).toHaveAttribute('d', /M/);
  await select(page, 'b');
  const renamed = '# services\na: Gateway {style.fill: "#ff0000"}\ndatabase: DB\na -> database\n';
  await patch(page, renamed, async () => { await page.fill('#rename input', 'database'); await page.locator('#rename input').press('Enter'); });
  await expect(page.locator('#selected')).toHaveText('Shape database');
  await expect(object(page, '(a -> database)[0]').locator('path').first()).toHaveAttribute('d', /M/);
  await patch(page, '# services\na: Gateway {style.fill: "#ff0000"}\n', () => page.click('#delete'));
  await expect(object(page, 'database')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('unchecked deletion offers the reason, labels and formatted text; cancel and approval preserve user control', async ({ page }) => {
  await open(page);
  const text = 'testing: Scenarios {\n  a\n}\n';
  await type(page, text);
  await select(page, 'testing.a');
  await page.click('#delete');
  await expect(page.locator('#unchecked')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await expect(page.locator('#reason')).toContainText('change labels');
  await expect(page.locator('#labels')).toContainText('Scenarios');
  await expect(page.locator('#formatted')).toHaveText('testing: scenarios\n');
  await expectSource(page, text);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#delete')).toBeFocused();
  await expectSource(page, text);
  await page.click('#delete');
  await expect(page.locator('#unchecked')).toBeVisible();
  await page.click('#use');
  await expectSource(page, 'testing: scenarios\n');
  await painted(page);
});

test('stroke and shape edits use checked patches; invalid values report D2’s refusal without changing text', async ({ page }) => {
  await open(page);
  await type(page, 'a: API\n');
  await select(page, 'a');
  await patch(page, 'a: API {style.stroke: red}\n', () => property(page, 'stroke', 'red'));
  const shaped = 'a: API {\n  style.stroke: red\n  shape: cylinder\n}\n';
  await patch(page, shaped, () => page.selectOption('#props [name="shape"]', 'cylinder'));
  await property(page, 'fill', 'not-a-color');
  await expect(page.locator('#status.error')).toContainText('set a.style.fill');
  await expectSource(page, shaped);
  // The colour picker makes the same edit through its text field.
  await patch(page, shaped.replace('red', '"#00ff00"'), () => page.locator('input[data-for="stroke"]').fill('#00ff00'));
  await expect(page.locator('#props [name="stroke"]')).toHaveValue('#00ff00');
});

test('undo and redo restore exact mixed typed and patched texts with buttons and keyboard, including in CodeMirror', async ({ page }) => {
  await open(page);
  const typed = '# mine\na: API\n';
  await type(page, typed);
  await select(page, 'a');
  const red = '# mine\na: API {style.fill: red}\n';
  await patch(page, red, () => property(page, 'fill', 'red'));
  await page.click('#undo');
  await expectSource(page, typed);
  await painted(page);
  await page.click('#redo');
  await expectSource(page, red);
  await painted(page);
  await sourceInput(page).focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expectSource(page, typed);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expectSource(page, red);
  await painted(page);
});

test('layer edits keep the root text; a nested shape edits with its D2 key', async ({ page }) => {
  await open(page);
  const text = 'a: Root\nlayers: {\n  detail: {\n    a: API\n  }\n}\n';
  await type(page, text);
  await page.selectOption('#board', '/layers/detail');
  await painted(page);
  await select(page, 'a');
  await expect(page.locator('#props [name="label"]')).toHaveValue('API');
  await patch(page, 'a: Root\nlayers: {\n  detail: {\n    a: API {style.fill: red}\n  }\n}\n', () => property(page, 'fill', 'red'));
  expect(await page.evaluate(() => traffic.requests.filter(r => r.type === 'edit').at(-1).board)).toBe('/layers/detail');
  await type(page, 'box: {\n  a\n}\n');
  await painted(page); // removed board falls back to root
  await select(page, 'box.a');
  await patch(page, 'box: {\n  a: Alpha\n}\n', () => property(page, 'label', 'Alpha'));
});

test('Tab selects objects; keyboard reaches inspector, commits a label, renames and deletes', async ({ page }) => {
  await open(page);
  await type(page, 'a: API\n');
  await sourceInput(page).focus();
  await page.keyboard.press('Tab');
  await expect(object(page, 'a')).toBeFocused();
  await expect(page.locator('#selected')).toHaveText('Shape a');
  await page.keyboard.press('Escape');
  await expect(page.locator('#inspector')).toBeHidden();
  await expectSource(page, 'a: API\n');
  await sourceInput(page).focus();
  // The toolbar's buttons, then Element and Node controls, then the Shape section's label.
  for (let n = 0; n < 30 && !(await page.locator('#props [name="label"]').evaluate(el => el === document.activeElement)); n++) await page.keyboard.press('Tab');
  await expect(page.locator('#props [name="label"]')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Keyboard');
  await patch(page, 'a: Keyboard\n', () => page.keyboard.press('Enter'));
  // Continue with Tab only, from the source through the canvas into the rename form.
  await sourceInput(page).focus();
  // a, then the inspector's controls (stroke, opacity, width, fill, label, shape, icon, effects), then name.
  for (let n = 0; n < 80 && !(await page.locator('#rename input').evaluate(el => el === document.activeElement)); n++) await page.keyboard.press('Tab');
  await expect(page.locator('#rename input')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('renamed');
  await patch(page, 'renamed: Keyboard\n', () => page.keyboard.press('Enter'));
  await page.keyboard.press('Tab'); // Rename button
  await page.keyboard.press('Tab'); // Delete
  await expect(page.locator('#delete')).toBeFocused();
  await patch(page, '', () => page.keyboard.press('Enter'));
});

test('a late edit cannot overwrite source typed before its result, even before the debounce fires', async ({ page }) => {
  await open(page);
  await type(page, 'a: API\n');
  await select(page, 'a');
  await page.evaluate(() => { traffic.hold = true; });
  await property(page, 'fill', 'red');
  await expect.poll(() => page.evaluate(() => Boolean(traffic.held))).toBe(true);
  await withCm(page);
  await page.evaluate(() => {
    const view = cm.EditorView.findFromDOM(document.querySelector('#src .cm-editor'));
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'newest: Typed\n' } });
    traffic.hold = false;
    traffic.held.worker.dispatchEvent(new MessageEvent('message', { data: traffic.held.data }));
  });
  await painted(page);
  await expectSource(page, 'newest: Typed\n');
  await visible(page, 'newest');
});

test('layout changes animate surviving nodes, new nodes fade and edits pulse; reduced motion skips all three', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const errors = await open(page);
  await type(page, 'a: API\nb: DB\na -> b\n');
  await select(page, 'a');
  await page.evaluate(() => { traffic.animations = []; });
  await property(page, 'label', 'A much longer label that changes layout');
  await expect.poll(() => page.evaluate(() => traffic.animations.some(a => a.id && a.frames[0].translate))).toBe(true);
  expect(await page.evaluate(() => document.querySelector('#host').shadowRoot.getAnimations().length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => traffic.animations.some(a => a.frames[0].outline))).toBe(true);
  await page.evaluate(() => { traffic.animations = []; });
  await type(page, 'a: API\nb: DB\nshape 2\na -> b\n');
  await expect.poll(() => page.evaluate(() => traffic.animations.some(a => a.id === 'shape 2' && a.frames[0].opacity === 0))).toBe(true);
  await painted(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await select(page, 'a');
  await page.evaluate(() => { traffic.animations = []; });
  await property(page, 'fill', 'red');
  await expect.poll(() => source(page)).toContain('style.fill: red');
  await painted(page);
  expect(await page.evaluate(() => traffic.animations)).toEqual([]);
  expect(errors).toEqual([]);
});

test('theme, sketch and layout menus reach the compile, are restored on reload, and other engines skip the idle TALA compile', async ({ page }) => {
  await open(page);
  const last = () => page.evaluate(() => traffic.requests.filter(r => r.type === 'compile').at(-1));
  await page.selectOption('#theme', '4');
  await expect.poll(async () => (await last()).render.themeId).toBe(4);
  await page.check('#sketch');
  await expect.poll(async () => (await last()).render.sketch).toBe(true);
  await page.selectOption('#layout', 'dagre');
  await expect.poll(async () => (await last()).layout).toBe('dagre');
  await painted(page);
  await visible(page, 'api');
  await type(page, 'a -> b\n');
  const count = await page.evaluate(() => traffic.requests.filter(r => r.type === 'compile').length);
  await page.waitForTimeout(1300);
  expect(await page.evaluate(() => traffic.requests.filter(r => r.type === 'compile').length)).toBe(count);
  await page.reload();
  await painted(page);
  await expect(page.locator('#theme')).toHaveValue('4');
  await expect(page.locator('#layout')).toHaveValue('dagre');
  await expect(page.locator('#sketch')).toBeChecked();
  expect((await last()).layout).toBe('dagre');
  expect((await last()).render.sketch).toBe(true);
});

test('a ?script= link opens on top of the saved text, a bad link keeps it, and Share copies a link that reopens the diagram', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  await type(page, 'mine: My saved text\n');
  // D2's own encoding (lib/urlenc) of a small script, as Go produces it.
  const script = 'x -> y\nI just forgot my whole philosophy of life!!!: {\n  s: TV is chewing gum for the eyes\n}\n';
  await page.goto('http://localhost:5281/?script=FMvBDcIwDEDRe6b4GYAFeuDOHbEAcmKjFFc4VbEQuyMGeG9OZ7JceOwxaf7qPlmTQ30Im9rw8E0TbwxrUmtd-BSIhesNC-4qhz07fV__nqmCpET5lt8A&layout=dagre');
  await painted(page);
  await expectSource(page, script);
  await expect(page.locator('#layout')).toHaveValue('dagre');
  expect(new URL(page.url()).search).toBe('');
  await page.click('#undo');
  await expectSource(page, 'mine: My saved text\n');
  await page.goto('http://localhost:5281/?script=broken!!');
  // The error outlasts the startup compiles (seeds [1], then the idle default seeds).
  await expect.poll(() => page.evaluate(() => traffic.results.filter(r => !r.error).length)).toBeGreaterThanOrEqual(2);
  await expect(page.locator('#status.error')).toContainText('shared link could not be opened');
  await expectSource(page, 'mine: My saved text\n');
  // A link's layout and theme apply to that visit only; the menus are the saved choice.
  await expect(page.locator('#layout')).toHaveValue('tala');
  await page.selectOption('#layout', 'elk');
  await painted(page);
  await page.click('#share');
  await expect(page.locator('#status')).toContainText('Link copied');
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(link).searchParams.get('layout')).toBe('elk');
  await type(page, 'other: text\n');
  await page.goto(link);
  await painted(page);
  await expectSource(page, 'mine: My saved text\n');
});

test('opening, downloading, restore and editing/idle seeds work at /editor/', async ({ page }) => {
  await open(page, '/editor/');
  // No example menu (user, 2 November 2026): files come from Open or the source pane.
  await expect(page.locator('#example')).toHaveCount(0);
  const text = '# opened file\r\na: From file\r\n';
  await page.locator('#open').setInputFiles({ name: 'mine.d2', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await expectSource(page, text.replaceAll('\r\n', '\n'));
  await painted(page);
  expect(await page.evaluate(() => traffic.requests.filter(r => r.type === 'compile').at(-1).files['main.d2'])).toBe(text);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  expect(readFileSync(await download.path(), 'utf8')).toBe(text);
  await expect.poll(() => page.evaluate(() => traffic.results.at(-1)?.echo.seeds)).toEqual([1, 2, 3]);
  const revision = await page.evaluate(() => traffic.requests.filter(r => r.type === 'compile').at(-1).revision);
  expect(await page.evaluate(revision => traffic.requests.filter(r => r.type === 'compile' && r.revision === revision).map(r => r.seeds ?? [1, 2, 3]), revision)).toEqual([[1], [1, 2, 3]]);
  await page.reload();
  await painted(page);
  await expectSource(page, text.replaceAll('\r\n', '\n'));
  await expect(object(page, 'a')).toContainText('From file');
});

test('the editor works when localStorage is denied', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } }));
  await open(page);
  await type(page, 'a: No storage\n');
  await expect(object(page, 'a')).toContainText('No storage');
});

test('assembled Pages site serves the demo at / and the editor and worker dependencies at /editor/', async ({ page }) => {
  const site = join(root, 'artifacts/d2editor/_site');
  mkdirSync(site, { recursive: true });
  for (const file of ['index.js', 'worker.js', 'wasm_exec.js', 'd2web.wasm', 'NOTICE.txt']) cpSync(join(root, 'packages/d2web/dist', file), join(site, file));
  cpSync(join(root, 'packages/d2web/demo/index.html'), join(site, 'index.html'));
  cpSync(dist, join(site, 'editor'), { recursive: true });
  await page.route('https://pages.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    const file = path.endsWith('/') ? path + 'index.html' : path;
    return route.fulfill({ body: readFileSync(join(site, file)), contentType: types[extname(file)] ?? 'text/plain' });
  });
  await page.goto('https://pages.test/');
  await painted(page);
  await page.goto('https://pages.test/editor/');
  await painted(page);
  await visible(page, 'api');
});

test('the inspector shows the inheritance chain and only the controls D2 honours; a toggle is one edit and unchecking removes it (spec 0018)', async ({ page }) => {
  const errors = await open(page, '/repo/editor/');
  await type(page, 'a: A\nb: B\n');
  await select(page, 'a');
  for (const gone of ['#fields', '#actions', '#interactions', '#sources']) await expect(page.locator(gone)).toHaveCount(0);
  await expect(page.locator('#props [data-section]:not([hidden]) > h3')).toHaveText(['Element', 'Node', 'Shape']);
  const field = k => page.locator(`#props [data-path="a.style.${k}"]`);
  await expect(field('opacity')).toHaveAttribute('type', 'range');
  await expect(field('opacity')).toHaveAttribute('max', '1');
  await expect(field('3d')).toHaveAttribute('type', 'checkbox');
  // Nothing outside the curated set is offered.
  await expect(page.locator('#props [data-path="a.style.fill-pattern"]')).toHaveCount(0);
  await expect(page.locator('#props [data-path="a.top"]')).toHaveCount(0);

  const edits = () => page.evaluate(() => traffic.edits.length);
  const change = async action => {
    const n = await edits();
    await action();
    await expect.poll(edits, { timeout: 90_000 }).toBe(n + 1);
    await painted(page);
  };
  await change(() => field('3d').check());
  await expect.poll(() => source(page)).toContain('3d: true');
  await change(() => field('3d').uncheck());
  await expect.poll(() => source(page)).not.toContain('3d');
  await change(async () => { await field('opacity').fill('0.5'); await field('opacity').press('Tab'); });
  await expect.poll(() => source(page)).toContain('opacity: 0.5');
  await change(() => page.locator('#props [data-reset="a.style.opacity"]').click());
  await expect.poll(() => source(page)).not.toContain('opacity');

  // 3d is D2's rectangle, square and hexagon only: for a circle the control is absent, not disabled.
  await change(() => page.locator('#props [name="shape"]').selectOption('circle'));
  await expect(field('3d')).toHaveCount(0);
  await expect(field('double-border')).toHaveAttribute('type', 'checkbox');
  expect(errors).toEqual([]);
});

test('a connection shows the Element and Edge sections with its ends and both arrowheads, and no shape controls; an arrowhead edit is one patch (spec 0018)', async ({ page }) => {
  const errors = await open(page, '/repo/editor/');
  await type(page, 'a -> b\n');
  await page.locator('#host [data-id="(a -> b)[0]"]').focus();
  await expect(page.locator('#selected')).toHaveText('Connection (a -> b)[0]');
  await expect(page.locator('#props [data-section]:not([hidden]) > h3')).toHaveText(['Element', 'Edge']);
  await expect(page.locator('#endpoints button')).toHaveText(['From: a', 'To: b']);
  const head = page.locator('#props [data-path="(a -> b)[0].target-arrowhead.shape"]');
  await expect(head.locator('option')).toHaveText(["D2's default", 'arrow', 'box', 'cf-many', 'cf-many-required', 'cf-one', 'cf-one-required', 'circle', 'cross', 'diamond', 'none', 'triangle']);
  await expect(page.locator('#props [name="shape"]')).toBeHidden();
  const n = await page.evaluate(() => traffic.edits.length);
  await head.selectOption('diamond');
  await expect.poll(() => page.evaluate(() => traffic.edits.length), { timeout: 90_000 }).toBe(n + 1);
  await painted(page);
  await expect.poll(() => source(page)).toContain('target-arrowhead');
  await expect(head).toHaveValue('diamond');
  await expect(page.locator('#props [data-section="edge"] .fields label > span:first-child')).toHaveText(['Start', 'End', 'Dashed']);
  const dashed = page.locator('#props [data-path="(a -> b)[0].style.stroke-dash"]');
  const m = await page.evaluate(() => traffic.edits.length);
  await dashed.check();
  await expect.poll(() => page.evaluate(() => traffic.edits.length), { timeout: 90_000 }).toBe(m + 1);
  await painted(page);
  await expect.poll(() => source(page)).toContain('stroke-dash: 5');
  await dashed.uncheck();
  await expect.poll(() => source(page)).not.toContain('stroke-dash');
  await page.locator('#endpoints button', { hasText: 'To: b' }).click();
  await expect(page.locator('#selected')).toHaveText('Shape b');
  await expect(page.locator('#endpoints')).toBeHidden();
  expect(errors).toEqual([]);
});

test('a node with no kind yet (a hierarchy) shows Element and Node only; a text node shows Content and no shape controls (spec 0018)', async ({ page }) => {
  const errors = await open(page, '/repo/editor/');
  await type(page, 't: { shape: hierarchy }\nn: |md # Hi |\n');
  await object(page, 't').focus();
  await expect(page.locator('#selected')).toHaveText('Node t');
  await expect(page.locator('#props [data-section]:not([hidden]) > h3')).toHaveText(['Element', 'Node']);
  await object(page, 'n').focus();
  await expect(page.locator('#selected')).toHaveText('Text n');
  await expect(page.locator('#props [data-section]:not([hidden]) > h3')).toHaveText(['Element', 'Node', 'Text']);
  await expect(page.locator('#props [name="content"]')).toHaveValue('# Hi');
  await expect(page.locator('#props [name="label"]')).toBeHidden();
  await expect(page.locator('#props [name="shape"]')).toBeHidden();
  expect(errors).toEqual([]);
});

test('arrow keys move a focused shape on TALA by one checked edit, Undo restores it; other engines say positions need TALA; (spec 0017)', async ({ page }) => {
  const errors = await open(page, '/repo/editor/', { visual: true });
  await type(page, 'a\nb\n');
  await object(page, 'a').focus();
  const edits = () => page.evaluate(() => traffic.edits.length);
  const n = await edits();
  await page.keyboard.press('ArrowRight');
  await expect.poll(edits, { timeout: 90_000 }).toBe(n + 1);
  await painted(page);
  await expect.poll(() => source(page)).toMatch(/left: 10/);
  const moved = await source(page);
  await page.keyboard.press('ArrowRight');
  await expect.poll(edits, { timeout: 90_000 }).toBe(n + 2);
  await painted(page);
  await page.click('#undo');
  await expect.poll(() => source(page)).toBe(moved);
  await page.selectOption('#layout', 'dagre');
  await painted(page);
  await object(page, 'a').focus();
  const m = await edits();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#status')).toContainText('TALA');
  expect(await edits()).toBe(m);
  expect(errors).toEqual([]);
});

test('the Type picker turns a shape into a text node and back as one edit each, keeping style and children; Undo restores it (spec 0018)', async ({ page }) => {
  const errors = await open(page, '/repo/editor/');
  await type(page, 'a: A {style.fill: red}\na.child\nt: { shape: hierarchy }\n');
  await select(page, 'a');
  await expect(page.locator('#type button')).toHaveText(['Shape', 'Text', 'Image', 'Sequence', 'Grid', 'Table', 'Class']);
  await expect(page.locator('#type [aria-pressed="true"]')).toHaveText('Shape');
  const edits = () => page.evaluate(() => traffic.edits.length);
  const n = await edits();
  await page.locator('#type button', { hasText: 'Text' }).click();
  await expect.poll(edits, { timeout: 90_000 }).toBe(n + 1);
  await painted(page);
  await expect.poll(() => source(page)).toMatch(/a: \|md[\s\S]*A[\s\S]*\| \{style\.fill: red\}/);
  expect(await source(page)).toContain('a.child');
  await expect(page.locator('#selected')).toHaveText('Text a');
  await expect(page.locator('#type [aria-pressed="true"]')).toHaveText('Text');
  await page.locator('#type button', { hasText: 'Shape' }).click();
  await expect.poll(edits, { timeout: 90_000 }).toBe(n + 2);
  await painted(page);
  await expect(page.locator('#selected')).toHaveText('Shape a');
  expect(await source(page)).toContain('a: A {style.fill: red}');
  await page.click('#undo');
  await expect(page.locator('#selected')).toHaveText('Text a');
  // A kind with no descriptor yet and a connection have no picker.
  await object(page, 't').focus();
  await expect(page.locator('#type')).toBeHidden();
  expect(errors).toEqual([]);
});

test('a text node edits as multi-line text: Enter is a new line, Cmd+Enter saves, Escape cancels, the switch changes the format (spec 0018)', async ({ page }) => {
  const errors = await open(page, '/repo/editor/');
  await type(page, 'n: |md\n  # Hi\n|\n');
  await select(page, 'n');
  const area = page.locator('#props [name="content"]');
  await expect(page.locator('#text-tag [aria-pressed="true"]')).toHaveText('Markdown');
  await expect(page.locator('#props [name="language"]')).toBeHidden();
  const edits = () => page.evaluate(() => traffic.edits.length);
  const n = await edits();
  await area.click();
  await area.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('second paragraph');
  expect(await edits()).toBe(n);
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect.poll(edits, { timeout: 90_000 }).toBe(n + 1);
  await painted(page);
  await expect.poll(() => source(page)).toMatch(/\|md\n\s+# Hi\n\s+second paragraph\n\|/);
  // Escape cancels: the typed words are dropped, no edit is made and the selection clears.
  await select(page, 'n');
  await area.click();
  await page.keyboard.type('discard me');
  await page.keyboard.press('Escape');
  await expect(page.locator('#inspector')).toBeHidden();
  expect(await edits()).toBe(n + 1);
  expect(await source(page)).not.toContain('discard');
  // The switch rewrites the block with another tag; a code block then shows its language.
  await select(page, 'n');
  await page.locator('#text-tag button', { hasText: 'Code' }).click();
  await expect.poll(edits, { timeout: 90_000 }).toBe(n + 2);
  await painted(page);
  await expect.poll(() => source(page)).toContain('|python');
  await expect(page.locator('#props [name="language"]')).toHaveValue('python');
  await page.locator('#text-tag button', { hasText: 'LaTeX' }).click();
  await expect.poll(() => source(page)).toContain('|latex');
  expect(errors).toEqual([]);
});

test('the code language is searched in the list D2 highlights, the common ones first; another tag still goes through (spec 0018)', async ({ page }) => {
  const errors = await open(page, '/repo/editor/');
  await type(page, 'c: |python\n  x = 1\n|\n');
  await object(page, 'c').focus();
  const options = await page.locator('#languages option').evaluateAll(os => os.map(o => o.value));
  expect(options.slice(0, 3)).toEqual(['python', 'go', 'javascript']);
  expect(options).toContain('rust');
  expect(options.length).toBeGreaterThan(100);
  const edits = () => page.evaluate(() => traffic.edits.length);
  const n = await edits();
  await property(page, 'language', 'rust');
  await expect.poll(edits, { timeout: 90_000 }).toBe(n + 1);
  await painted(page);
  await expect.poll(() => source(page)).toMatch(/\|rust\b/);
  expect(await source(page)).toContain('x = 1');
  await property(page, 'language', 'mydsl');
  await expect.poll(() => source(page)).toMatch(/\|mydsl\b/);
  expect(errors).toEqual([]);
});

test('turning a shape with children into an Image asks first; Cancel changes nothing, confirming removes them and Undo restores them (spec 0018)', async ({ page }) => {
  const errors = await open(page, '/repo/editor/');
  await type(page, 'a: A\na.child\nb: B\n');
  await select(page, 'a');
  await page.locator('#type button', { hasText: 'Image' }).click();
  await expect(page.locator('#confirm')).toBeVisible();
  await expect(page.locator('#confirm-body')).toContainText('1 child shape');
  const before = await source(page);
  await page.locator('#confirm button[value="cancel"]').click();
  await expect(page.locator('#confirm')).toBeHidden();
  expect(await source(page)).toBe(before);
  await page.locator('#type button', { hasText: 'Image' }).click();
  await page.locator('#confirm-ok').click();
  await expect.poll(() => source(page), { timeout: 90_000 }).toContain('shape: image');
  expect(await source(page)).not.toContain('child');
  await painted(page);
  await expect(page.locator('#selected')).toHaveText('Image a');
  await page.click('#undo');
  await expect.poll(() => source(page)).toBe(before);
  // A shape without children converts straight away, to the placeholder icon.
  await select(page, 'b');
  await page.locator('#type button', { hasText: 'Image' }).click();
  await expect(page.locator('#confirm')).toBeHidden();
  await expect.poll(() => source(page), { timeout: 90_000 }).toContain('112-server.svg');
  expect(errors).toEqual([]);
});

test('double-click edits a label on the canvas; the toolbar sits on the selection and sets colours and deletes (spec 0018)', async ({ page }) => {
  const errors = await open(page, '/repo/editor/', { visual: true });
  await type(page, 'a: A\nb: B\n');
  await expect(page.locator('#toolbar')).toBeHidden();
  await select(page, 'a');
  await expect(page.locator('#toolbar')).toBeVisible();
  await expect(page.locator('#toolbar [data-tool="fill"]')).toBeVisible();
  const edits = () => page.evaluate(() => traffic.edits.length);
  let n = await edits();
  // Escape in the field cancels; Enter saves as one edit.
  await object(page, 'a').locator('[data-k="rect"], [data-k="text"], svg').first().dblclick({ position: { x: 5, y: 5 } });
  const field = page.locator('#host .label-edit, .label-edit').first();
  await expect(field).toBeVisible();
  await field.fill('discard');
  await page.keyboard.press('Escape');
  await expect(field).toHaveCount(0);
  expect(await edits()).toBe(n);
  expect(await source(page)).toBe('a: A\nb: B\n');
  await expect(page.locator('#toolbar')).toBeVisible();
  await object(page, 'a').locator('[data-k="rect"], [data-k="text"], svg').first().dblclick({ position: { x: 5, y: 5 } });
  await field.fill('Renamed');
  await page.keyboard.press('Enter');
  await expect.poll(edits, { timeout: 90_000 }).toBe(n + 1);
  await painted(page);
  await expect.poll(() => source(page)).toBe('a: Renamed\nb: B\n');
  n = await edits();
  await page.locator('#toolbar [data-tool="fill"] input').fill('#ff0000');
  await expect.poll(edits, { timeout: 90_000 }).toBe(n + 1);
  await painted(page);
  await expect.poll(() => source(page)).toContain('fill: "#ff0000"');
  await page.click('#tool-delete');
  await expect.poll(() => source(page), { timeout: 90_000 }).not.toContain('Renamed');
  await painted(page);
  await expect(page.locator('#toolbar')).toBeHidden();
  expect(errors).toEqual([]);
});

test('a sequence diagram offers Add actor, an actor inside it offers Add note, and a plain shape offers neither (spec 0018)', async ({ page }) => {
  const errors = await open(page, '/repo/editor/');
  await type(page, 'd: {\n  shape: sequence_diagram\n  a -> b: hi\n}\nplain\n');
  await object(page, 'd').focus();
  await expect(page.locator('#selected')).toHaveText('Sequence d');
  await expect(page.locator('#props [data-section="sequence"] .actions button')).toHaveText(['Add actor']);
  const edits = () => page.evaluate(() => traffic.edits.length);
  const n = await edits();
  await page.locator('#props [data-section="sequence"] .actions button').click();
  await expect.poll(edits, { timeout: 90_000 }).toBe(n + 1);
  await painted(page);
  await expect.poll(() => source(page)).toContain('actor');
  await object(page, 'd.a').focus();
  await expect(page.locator('#props .actions button')).toHaveText(['Add note']);
  await object(page, 'plain').focus();
  await expect(page.locator('#props .actions button')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a grid shows Columns, Rows and Gap; dragging a cell onto a sibling reorders it by one edit; turning it into a Shape removes the grid keywords (spec 0018)', async ({ page }) => {
  const errors = await open(page, '/repo/editor/', { visual: true });
  await type(page, 'g: {\n  grid-columns: 2\n  a\n  b\n  c\n}\n');
  await object(page, 'g').focus();
  await expect(page.locator('#selected')).toHaveText('Grid g');
  await expect(page.locator('#props [data-section="grid"] .fields label > span:first-child')).toHaveText(['Columns', 'Rows', 'Gap']);
  const edits = () => page.evaluate(() => traffic.edits.length);
  let n = await edits();
  await page.locator('#props [data-path="g.grid-columns"]').fill('3');
  await page.locator('#props [data-path="g.grid-columns"]').press('Tab');
  await expect.poll(edits, { timeout: 90_000 }).toBe(n + 1);
  await painted(page);
  await expect.poll(() => source(page)).toContain('grid-columns: 3');
  // Drag c onto a: it goes first.
  n = await edits();
  const from = await object(page, 'g.c').locator('[data-k]').first().boundingBox(), to = await object(page, 'g.a').locator('[data-k]').first().boundingBox();
  await page.mouse.move(from.x + 4, from.y + 4);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(edits, { timeout: 90_000 }).toBe(n + 1);
  await painted(page);
  await expect.poll(() => source(page)).toMatch(/grid-columns: 3\n\s+c\n\s+a\n\s+b/);
  expect((await page.evaluate(() => traffic.edits.at(-1))).patch.text).not.toMatch(/top|left/);
  await object(page, 'g').focus();
  await page.locator('#type button', { hasText: 'Shape' }).click();
  await expect.poll(() => source(page), { timeout: 90_000 }).not.toContain('grid-columns');
  await expect(page.locator('#selected')).toHaveText('Shape g');
  expect(errors).toEqual([]);
});

test('a selected connection has an end dot on each side; dragging one onto another shape retargets it; Reverse swaps the ends, each one edit (spec 0018)', async ({ page }) => {
  const errors = await open(page, '/repo/editor/', { visual: true });
  await type(page, 'a -> b\nc\n');
  await page.locator('#host [data-id="(a -> b)[0]"]').focus();
  await expect(page.locator('#host .end-dot')).toHaveCount(2);
  const edits = () => page.evaluate(() => traffic.edits.length);
  let n = await edits();
  await page.locator('#props [data-section="edge"] .actions button', { hasText: 'Reverse' }).click();
  await expect.poll(edits, { timeout: 90_000 }).toBe(n + 1);
  await painted(page);
  await expect.poll(() => source(page)).toContain('b -> a');
  await expect(page.locator('#selected')).toHaveText('Connection (b -> a)[0]');
  await expect(page.locator('#host .end-dot')).toHaveCount(2);
  // The target end (a) goes to c.
  n = await edits();
  const dot = await page.locator('#host .end-dot[data-end="target"]').boundingBox(), c = await object(page, 'c').locator('[data-k]').first().boundingBox();
  await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
  await page.mouse.down();
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(edits, { timeout: 90_000 }).toBe(n + 1);
  await painted(page);
  await expect.poll(() => source(page)).toContain('b -> c');
  await expect(page.locator('#selected')).toHaveText('Connection (b -> c)[0]');
  expect(errors).toEqual([]);
});

test('a table edits its columns in place: type, constraint chips, rename, add, delete, drag to reorder; each is one edit; Table to Class keeps the columns (spec 0018)', async ({ page }) => {
  const errors = await open(page, '/repo/editor/');
  await type(page, 't: {\n  shape: sql_table\n  id: int {constraint: primary_key}\n  name: varchar\n}\n');
  await object(page, 't').focus();
  await expect(page.locator('#selected')).toHaveText('Table t');
  const rows = page.locator('#props [data-section="table"] .row-line');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('.chips [aria-pressed="true"]')).toHaveText(['PK']);
  const edits = () => page.evaluate(() => traffic.edits.length);
  const once = async action => {
    const n = await edits();
    await action();
    await expect.poll(edits, { timeout: 90_000 }).toBe(n + 1);
    await painted(page);
  };
  await once(async () => { await rows.nth(1).locator('.r-type').fill('text'); await rows.nth(1).locator('.r-type').press('Tab'); });
  await expect.poll(() => source(page)).toContain('name: text');
  expect(await source(page)).not.toMatch(/name: varchar/);
  await once(() => rows.nth(1).locator('.chips button', { hasText: 'UNQ' }).click());
  await expect.poll(() => source(page)).toMatch(/name: text[^\n]*unique/);
  await once(async () => { await rows.nth(1).locator('.r-name').fill('title'); await rows.nth(1).locator('.r-name').press('Tab'); });
  await expect.poll(() => source(page)).toContain('title: text');
  await once(() => page.locator('#props .r-add').click());
  await expect(rows).toHaveCount(3);
  await once(() => rows.nth(2).locator('.r-del').click());
  await expect(rows).toHaveCount(2);
  // Drag the second column above the first.
  await once(() => rows.nth(1).dragTo(rows.nth(0)));
  await expect.poll(() => source(page)).toMatch(/title: text[\s\S]*id: int/);
  await expect(rows.nth(0).locator('.r-name')).toHaveValue('title');
  // To a Class: the columns stay (as members); its constraints are named in the sheet.
  await page.locator('#type button', { hasText: 'Class' }).click();
  await expect(page.locator('#confirm-body')).toContainText("the columns' constraints");
  await page.locator('#confirm-ok').click();
  await expect.poll(() => source(page), { timeout: 90_000 }).toContain('shape: class');
  await painted(page);
  await expect(page.locator('#selected')).toHaveText('Class t');
  await expect(page.locator('#props [data-section="class"] .row-line')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('dragging a message down a sequence diagram reorders it by one edit (spec 0018)', async ({ page }) => {
  const errors = await open(page, '/repo/editor/', { visual: true });
  await type(page, 's: {\n  shape: sequence_diagram\n  a\n  b\n  a -> b: one\n  b -> a: two\n}\n');
  const edits = () => page.evaluate(() => traffic.edits.length);
  const n = await edits();
  const first = await object(page, 's.(a -> b)[0]').locator('path').first().boundingBox();
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2 + 120, { steps: 8 });
  await page.mouse.up();
  await expect.poll(edits, { timeout: 90_000 }).toBe(n + 1);
  await painted(page);
  await expect.poll(() => source(page)).toMatch(/b -> a: two\n\s+a -> b: one/);
  expect(errors).toEqual([]);
});

// Spec 0020 slice 1: CodeMirror is a view of the same D2 text and history.
test('source pane underlines D2 diagnostics and clears them after fixing the syntax', async ({ page }) => {
  await open(page);
  await expect(page.locator('#src .cm-content')).toHaveAttribute('aria-label', 'D2 source');
  await sourceInput(page).fill('# 😀\na -> {');
  await expect(page.locator('#status.error')).toContainText('offset');
  await expect(page.locator('#src .cm-lintRange-error').first()).toBeAttached();
  const diagnostic = await page.evaluate(() => traffic.results.at(-1).error.diagnostics[0]);
  const marker = page.locator('#src .cm-lintRange-error').first();
  await withCm(page);
  expect(await marker.evaluate(el => {
    const view = cm.EditorView.findFromDOM(document.querySelector('#src .cm-editor'));
    return { start: view.posAtDOM(el), end: view.posAtDOM(el, el.childNodes.length) };
  })).toEqual(diagnostic.range);
  await marker.hover();
  await expect(page.locator('.cm-tooltip-lint')).toContainText(diagnostic.message);
  await type(page, 'a: Fixed\n');
  await expect(page.locator('#src .cm-lintRange-error')).toHaveCount(0);
});

test('source caret selects the innermost object; canvas selection reveals its first reference without taking focus', async ({ page }) => {
  await open(page);
  await page.selectOption('#layout', 'dagre');
  const text = '# 😀 UTF-16\n' + '# spacer\n'.repeat(70) + 'a: {\n  b: Child\n}\nz: Other\n';
  await type(page, text);
  await moveCaret(page, text.indexOf('Child') + 2);
  await expect(page.locator('#selected')).toHaveText('Shape a.b');
  await expect(sourceInput(page)).toBeFocused();
  await moveCaret(page, 0);
  await expect(page.locator('#inspector')).toBeHidden();
  // A keyboard canvas selection uses the same path as a pointer click, and keeps focus on that object.
  await object(page, 'a.b').first().evaluate(el => el.focus());
  await expect(object(page, 'a.b').first()).toBeFocused();
  await expect.poll(() => caret(page)).toBe(text.indexOf('b: Child'));
  await expect.poll(() => page.locator('#src .cm-scroller').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  // Clicking a different shape updates the caret too, with no reference feedback changing the canvas selection.
  await select(page, 'z');
  await expect.poll(() => caret(page)).toBe(text.indexOf('z: Other'));
  await expect(page.locator('#selected')).toHaveText('Shape z');
  await expect(sourceInput(page)).not.toBeFocused();
});

test('source and canvas linking is off during a pending compile and after a failed compile', async ({ page }) => {
  await open(page);
  await page.selectOption('#layout', 'dagre');
  await type(page, 'a: A\nb: B\n');
  await select(page, 'b');
  const revision = await page.evaluate(() => traffic.requests.filter(r => r.type === 'compile').at(-1).revision);
  await page.evaluate(revision => { traffic.holdAbove = revision; }, revision);
  // A typing transaction disables the link immediately, before its debounce or result.
  await sourceInput(page).fill('a: A\nb: B\n# pending\n');
  await moveCaret(page, 1);
  await expect(page.locator('#selected')).toHaveText('Shape b');
  await expect.poll(() => page.evaluate(() => Boolean(traffic.heldResult))).toBe(true);
  await select(page, 'a');
  await expect.poll(() => caret(page)).toBe(1);
  await page.evaluate(() => {
    traffic.holdAbove = undefined;
    traffic.heldResult.worker.dispatchEvent(new MessageEvent('message', { data: traffic.heldResult.data }));
  });
  await painted(page);
  await moveCaret(page, 6);
  await expect(page.locator('#selected')).toHaveText('Shape b');
  await sourceInput(page).fill('a -> {');
  await expect(page.locator('#status.error')).toContainText('offset');
  await moveCaret(page, 1);
  await expect(page.locator('#selected')).toHaveText('Shape b');
  await select(page, 'a');
  await expect.poll(() => caret(page)).toBe(1);
  await type(page, 'a: A\nb: B\n');
  await moveCaret(page, 6);
  await expect(page.locator('#selected')).toHaveText('Shape b');
});

test('typing then dragging uses one undo stack and source shortcuts do not zoom the canvas', async ({ page }) => {
  await open(page, '/', { visual: true });
  const original = 'a: A\nb: B\na -> b\n';
  await type(page, original);
  const k = await zoom(page);
  await sourceInput(page).press('ControlOrMeta+End');
  await page.keyboard.insertText('# typed +-=!\n');
  const typed = original + '# typed +-=!\n';
  await expectSource(page, typed);
  await painted(page);
  expect(await zoom(page)).toBe(k);
  await select(page, 'a');
  await drag(page, 'a', 70, 40);
  await expect.poll(() => source(page)).not.toBe(typed);
  await painted(page);
  const dragged = await source(page);
  await sourceInput(page).focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expectSource(page, typed);
  await page.keyboard.press('ControlOrMeta+z');
  await expectSource(page, original);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expectSource(page, typed);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expectSource(page, dragged);
  const beforeKey = await zoom(page);
  await page.keyboard.press('+');
  expect(await zoom(page)).toBe(beforeKey);
});

test('CRLF source links use UTF-16 offsets and the original endings survive until typing and undo', async ({ page }) => {
  await open(page);
  await page.selectOption('#layout', 'dagre');
  const text = '# 😀\r\na: A\r\nb: B\r\n';
  await page.locator('#open').setInputFiles({ name: 'crlf.d2', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await painted(page);
  const displayed = text.replaceAll('\r\n', '\n');
  await expectSource(page, displayed);
  await select(page, 'b');
  await expect.poll(() => caret(page)).toBe(displayed.indexOf('b: B'));
  await moveCaret(page, displayed.indexOf('b: B') + 1);
  await expect(page.locator('#selected')).toHaveText('Shape b');
  await sourceInput(page).press('ControlOrMeta+End');
  await page.keyboard.insertText('# typed');
  await painted(page);
  expect(await page.evaluate(() => traffic.requests.filter(r => r.type === 'compile').at(-1).files['main.d2'])).toBe(displayed + '# typed');
  await page.keyboard.press('ControlOrMeta+z');
  await painted(page);
  expect(await page.evaluate(() => traffic.requests.filter(r => r.type === 'compile').at(-1).files['main.d2'])).toBe(text);
});

test('source decorations cover patch replacements, show deletions, and clear on typing', async ({ page }) => {
  await open(page);
  await type(page, '# 😀\na: A\nb: B\n');
  await select(page, 'a');
  const result = await patch(page, '# 😀\na: A {style.fill: red}\nb: B\n', () => property(page, 'fill', 'red'));
  expect(await page.locator('#src .patch-mark').allTextContents()).not.toHaveLength(0);
  expect((await page.locator('#src .patch-mark').allTextContents()).join('')).toBe(result.patch.edits.map(e => e.text.replace(/\r\n?|\n/g, '')).join(''));
  await select(page, 'b');
  await patch(page, '# 😀\na: A {style.fill: red}\n', () => page.click('#delete'));
  await expect(page.locator('#src .patch-mark[aria-hidden="true"]')).toHaveCount(1);
  await sourceInput(page).press('ControlOrMeta+End');
  await page.keyboard.insertText('# typed');
  await expect(page.locator('#src .patch-mark')).toHaveCount(0);
});

// Spec 0021: highlighting and suggestions remain projections of the source text.
test('source syntax has distinct token classes and follows the page theme', async ({ page }) => {
  await open(page);
  await sourceInput(page).fill('# comment\na: "quoted" {shape: rectangle; style.fill: "#abcdef"; width: 42}\na -> b\nb -- c\nc <- d\nd <-> e\nnote: |md\n# block content\n|\nz: Z\n');
  for (const [kind, text] of [['comment', '# comment'], ['string', '"quoted"'], ['keyword', 'shape'], ['arrow', '->'], ['string', '"#abcdef"'], ['number', '42']]) {
    await expect(page.locator(`#src .d2-${kind}`).filter({ hasText: text }).first()).toBeVisible();
  }
  await expect(page.locator('#src .d2-arrow')).toHaveText(['->', '--', '<-', '<->']);
  await expect(page.locator('#src .d2-string').filter({ hasText: '# block content' })).toHaveCount(1);
  const comment = page.locator('#src .d2-comment').first();
  const light = await comment.evaluate(el => getComputedStyle(el).color);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => comment.evaluate(el => getComputedStyle(el).color)).not.toBe(light);
});

test('source completion offers shapes, style keywords and boolean values from D2', async ({ page }) => {
  await open(page);
  const table = JSON.parse(readFileSync(join(root, 'packages/d2editor/src/keywords.json'), 'utf8'));
  for (const [text, expected] of [
    ['a.shape: ', table.shapes],
    ['a.style.', table.keywords.filter(k => k.style).map(k => k.name)],
    ['a.style.bold: ', ['true', 'false']],
  ]) {
    await sourceInput(page).fill(text);
    await sourceInput(page).press('Control+Space');
    const labels = page.locator('.cm-tooltip-autocomplete .cm-completionLabel');
    await expect(labels).toHaveCount(expected.length);
    expect((await labels.allTextContents()).sort()).toEqual([...expected].sort());
    await page.keyboard.press('Escape');
    await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0);
    await expectSource(page, text);
  }
});

test('accepting a source completion is one shared history step and never an edit API call', async ({ page }) => {
  await open(page);
  const original = await source(page), text = 'a.shape: rect';
  await sourceInput(page).fill(text);
  const edits = await page.evaluate(() => traffic.edits.length);
  await sourceInput(page).press('Control+Space');
  await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible();
  await page.waitForTimeout(100); // CodeMirror ignores acceptance keys immediately after the list opens.
  await page.keyboard.press('Enter');
  await expectSource(page, 'a.shape: rectangle');
  await painted(page);
  expect(await page.evaluate(() => traffic.edits.length)).toBe(edits);
  await page.keyboard.press('ControlOrMeta+z');
  await expectSource(page, text);
  await page.keyboard.press('ControlOrMeta+z');
  await expectSource(page, original);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expectSource(page, text);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expectSource(page, 'a.shape: rectangle');
});

// Spec 0022: native controls write exactly the D2 literal and share history.ts.
const widgetText = '# 😀\na: {style.fill: red; style.bold: false; style.font-size: 24; style.opacity: 0.5; shape: rectangle}\nb: {style.stroke: blue}\n';
async function valuePopover(page, literal, name) {
  const text = await source(page);
  await moveCaret(page, text.indexOf(literal) + 1);
  await page.keyboard.press('ControlOrMeta+.');
  const popover = page.getByRole('dialog', { name, exact: true });
  await expect(popover).toBeVisible();
  await expect(popover).toHaveAttribute('popover', 'auto');
  return popover;
}

test('source values have swatches and underlines; a touched range disappears while other last-good ranges survive errors', async ({ page }) => {
  const errors = await open(page);
  await type(page, widgetText);
  await expect(page.locator('#src .source-swatch')).toHaveCount(2);
  await expect(page.locator('#src .source-swatch').first()).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#src .source-value')).toHaveCount(6);
  // Click a mark as well as using the keyboard path in the other tests.
  await page.locator('#src .source-value').filter({ hasText: /^red$/ }).click();
  await expect(page.getByRole('dialog', { name: 'fill', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await withCm(page);
  await page.evaluate(() => {
    const view = cm.EditorView.findFromDOM(document.querySelector('#src .cm-editor'));
    const from = view.state.doc.toString().indexOf('red');
    view.dispatch({ changes: { from, to: from + 3, insert: 'not-a-color' } });
  });
  await expect(page.locator('#src .source-swatch')).toHaveCount(1);
  await expect(page.locator('#src .source-value')).toHaveCount(5);
  await expect(page.locator('#status.error')).toBeVisible();
  await expect(page.locator('#src .source-swatch')).toHaveCount(1);
  await expect(page.locator('#src .source-value').filter({ hasText: /^blue$/ })).toBeVisible();
  // An unrelated edit maps the surviving range even though this compile also fails.
  await page.evaluate(() => cm.EditorView.findFromDOM(document.querySelector('#src .cm-editor')).dispatch({ changes: { from: 0, insert: '# added\n' } }));
  await page.locator('#src .source-value').filter({ hasText: /^blue$/ }).click();
  const popover = page.getByRole('dialog', { name: 'stroke', exact: true });
  await popover.getByRole('textbox', { name: 'Hex color' }).fill('#112233');
  await page.keyboard.press('Enter');
  await expectSource(page, '# added\n' + widgetText.replace('red', 'not-a-color').replace('blue', '"#112233"'));
  await type(page, widgetText);
  await expect(page.locator('#src .source-swatch')).toHaveCount(2);
  expect(errors).toEqual([]);
});

for (const [name, literal, replacement] of [
  ['fill', 'red', '"#112233"'],
  ['bold', 'false', 'true'],
  ['shape', 'rectangle', 'circle'],
  ['font-size', '24', '32'],
]) test(`source ${name} popover edits only its value, repaints, and closes as one undo step`, async ({ page }) => {
  const errors = await open(page);
  await type(page, widgetText);
  const edits = await page.evaluate(() => traffic.edits.length);
  const popover = await valuePopover(page, literal, name);
  if (name === 'fill') {
    await expect(popover.locator('input[type=color]')).toHaveCount(1);
    await popover.getByRole('textbox', { name: 'Hex color' }).fill('#445566');
    await painted(page);
    await popover.locator('input[type=color]').fill('#112233');
  } else if (name === 'bold') {
    await popover.getByRole('checkbox').check();
  } else if (name === 'shape') {
    await expect(popover.getByRole('listbox')).toBeVisible();
    await popover.getByRole('listbox').selectOption('circle');
  } else {
    await expect(popover.getByRole('slider')).toHaveAttribute('min', '8');
    await expect(popover.getByRole('slider')).toHaveAttribute('max', '100');
    await popover.getByRole('spinbutton').fill('30');
    await painted(page);
    await popover.getByRole('spinbutton').fill('32');
  }
  await expectSource(page, widgetText.replace(literal, replacement));
  await painted(page);
  if (name === 'fill') expect(await object(page, 'a').evaluate(el => [el, ...el.querySelectorAll('*')].some(e => getComputedStyle(e).backgroundColor === 'rgb(17, 34, 51)' || getComputedStyle(e).fill === 'rgb(17, 34, 51)'))).toBe(true);
  // Outside dismissal must commit before a subsequent Undo button click reads history.
  if (name === 'bold') await page.locator('.pane-title').first().click();
  else await page.keyboard.press('Enter');
  await expect(popover).toHaveCount(0);
  expect(await page.evaluate(() => traffic.edits.length)).toBe(edits);
  await page.locator('#undo').click();
  await expectSource(page, widgetText);
  await page.locator('#redo').click();
  await expectSource(page, widgetText.replace(literal, replacement));
  expect(errors).toEqual([]);
});

test('Escape after live source previews restores the original text and adds no history step', async ({ page }) => {
  const errors = await open(page), previous = await source(page);
  await type(page, widgetText);
  const popover = await valuePopover(page, 'red', 'fill');
  await popover.getByRole('textbox', { name: 'Hex color' }).fill('#112233');
  await painted(page);
  await popover.getByRole('textbox', { name: 'Hex color' }).fill('#abcdef');
  await painted(page);
  await page.keyboard.press('Escape');
  await expectSource(page, widgetText);
  await expect(sourceInput(page)).toBeFocused();
  await painted(page);
  await page.keyboard.press('ControlOrMeta+z');
  await expectSource(page, previous);
  expect(errors).toEqual([]);
});

test('class-owned source literal announces all affected shapes and changes the declaration once', async ({ page }) => {
  await open(page);
  const text = 'classes: {kit: {style.fill: red}}\na: {class: kit}\nb: {class: kit}\n';
  await type(page, text);
  await expect(page.locator('#src .source-swatch')).toHaveCount(1);
  const popover = await valuePopover(page, 'red', 'fill');
  await expect(popover).toContainText('Used by 2 shapes');
  await popover.getByRole('textbox', { name: 'Hex color' }).fill('#123456');
  await page.keyboard.press('Enter');
  await expectSource(page, text.replace('red', '"#123456"'));
  await painted(page);
});

test('Alt arrows step style numbers with table bounds; canvas dimensions have no widget', async ({ page }) => {
  await open(page);
  const text = 'a: {width: 100; height: 80; top: 0; left: 0; style.opacity: 0.95; style.font-size: 24}\n';
  await type(page, text);
  await expect(page.locator('#src .source-value')).toHaveCount(2);
  await moveCaret(page, text.indexOf('0.95') + 1);
  await page.keyboard.press('Alt+ArrowUp');
  await expectSource(page, text.replace('0.95', '1'));
  await page.keyboard.press('Alt+ArrowUp');
  await expectSource(page, text.replace('0.95', '1'));
  await page.keyboard.press('Alt+ArrowDown');
  await expectSource(page, text);
  await page.keyboard.press('ControlOrMeta+z');
  await expectSource(page, text.replace('0.95', '1'));
  await expect(page.locator('.source-value-popover')).toHaveCount(0);
});

test('slider bursts schedule one compile per frame and never overlap worker compiles', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker, active = new Set();
    window.compilePeak = 0;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', e => { if (e.data.type === 'result') active.delete(this); });
      }
      postMessage(message, ...rest) {
        if (message.type === 'compile') { active.add(this); window.compilePeak = Math.max(window.compilePeak, active.size); }
        super.postMessage(message, ...rest);
      }
      terminate() { active.delete(this); super.terminate(); }
    };
  });
  const errors = await open(page);
  await page.selectOption('#layout', 'dagre');
  await type(page, widgetText);
  const popover = await valuePopover(page, '0.5', 'opacity');
  await expect(popover.getByRole('slider')).toHaveAttribute('step', '0.05');
  await expect(popover.getByRole('slider')).toHaveAttribute('min', '0');
  await expect(popover.getByRole('slider')).toHaveAttribute('max', '1');
  const before = await page.evaluate(() => traffic.requests.filter(r => r.type === 'compile').length);
  await popover.getByRole('slider').evaluate(el => {
    for (let i = 1; i <= 18; i++) { el.value = String(i * 0.05); el.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await expectSource(page, widgetText.replace('0.5', '0.9'));
  await painted(page);
  expect(await page.evaluate(() => traffic.requests.filter(r => r.type === 'compile').length)).toBe(before + 1);
  expect(await page.evaluate(() => window.compilePeak)).toBe(1);
  await page.keyboard.press('Enter');
  await page.locator('#undo').click();
  await expectSource(page, widgetText);
  expect(errors).toEqual([]);
});

test('source popover keeps CRLF bytes outside the literal and undo restores the exact file', async ({ page }) => {
  await open(page);
  const text = '# 😀\r\na.style.fill: red\r\nb: Other\r\n';
  await page.locator('#open').setInputFiles({ name: 'widgets.d2', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await painted(page);
  const popover = await valuePopover(page, 'red', 'fill');
  await popover.getByRole('textbox', { name: 'Hex color' }).fill('#112233');
  await page.keyboard.press('Enter');
  await painted(page);
  const compiledText = () => page.evaluate(() => traffic.requests.filter(r => r.type === 'compile').at(-1).files['main.d2']);
  expect(await compiledText()).toBe(text.replace('red', '"#112233"'));
  await page.locator('#undo').click();
  await painted(page);
  expect(await compiledText()).toBe(text);
});

test('source completion respects style scopes, known shapes, arrowheads and common languages', async ({ page }) => {
  await open(page);
  const table = JSON.parse(readFileSync(join(root, 'packages/d2editor/src/keywords.json'), 'utf8'));
  const cases = [
    ['a: { style: { ', table.keywords.filter(k => k.style).map(k => k.name)],
    ['a: {shape: circle; style.', table.keywords.filter(k => k.style && (!k.only || k.only.includes('circle'))).map(k => k.name)],
    ['a -> b: {source-arrowhead.shape: ', table.arrowheads],
    ['a -> b: {target-arrowhead: {shape: ', table.arrowheads],
  ];
  for (const [text, expected] of cases) {
    await sourceInput(page).fill(text);
    await sourceInput(page).press('Control+Space');
    const labels = page.locator('.cm-tooltip-autocomplete .cm-completionLabel');
    await expect(labels).toHaveCount(expected.length);
    expect((await labels.allTextContents()).sort()).toEqual([...expected].sort());
    await page.keyboard.press('Escape');
  }
  for (const text of ['a.language: ', 'a: |']) {
    await sourceInput(page).fill(text);
    await sourceInput(page).press('Control+Space');
    const labels = page.locator('.cm-tooltip-autocomplete .cm-completionLabel');
    await expect(labels.first()).toHaveText(table.commonLanguages[0]);
    expect((await labels.allTextContents()).slice(0, table.commonLanguages.length)).toEqual(table.commonLanguages);
    await page.keyboard.press('Escape');
  }
});

const outlineRow = (page, id) => page.locator(`#outline [role=treeitem][data-id=${JSON.stringify(id)}]`);
const outlineJump = (page, id) => outlineRow(page, id).locator(':scope > .outline-row > button:not(.outline-toggle)');
const foldMarkers = page => page.locator('#src .cm-foldGutter [title="Fold line"]:visible');
const folded = page => page.locator('#src .cm-foldPlaceholder');
const outlineText = 'group: Group {\n  child: Child\n  other: Other\n}\nz: Last\ngroup.child -> z: requests\n';
const foldText = 'a: {\n  label: Alpha\n  style.fill: red\n}\nz: {label: Z}\n';
async function releaseCompile(page, diagnostic) {
  await expect.poll(() => page.evaluate(() => Boolean(traffic.heldResult))).toBe(true);
  await page.evaluate(diagnostic => {
    const held = traffic.heldResult;
    delete traffic.holdAbove;
    delete traffic.heldResult;
    if (diagnostic) held.data.diagnostics = [diagnostic];
    held.worker.dispatchEvent(new MessageEvent('message', { data: held.data }));
  }, diagnostic);
}

test('outline lists declaration nesting and connections, and links the caret and canvas both ways', async ({ page }) => {
  const errors = await open(page);
  await type(page, outlineText);
  const rows = page.locator('#outline [role=treeitem]');
  expect(await rows.evaluateAll(els => els.map(el => el.getAttribute('aria-label')))).toEqual(['Group', 'Child', 'Other', 'Last', 'group.child -> z']);
  await expect(outlineRow(page, 'group').locator(':scope > [role=group] > [role=treeitem]')).toHaveCount(2);
  await outlineJump(page, 'group.child').click();
  expect(await caret(page)).toBe(outlineText.indexOf('child:'));
  await expect(page.locator('#selected')).toContainText('group.child');
  await expect(outlineRow(page, 'group.child')).toHaveAttribute('aria-current', 'true');
  await moveCaret(page, outlineText.indexOf('other:') + 2);
  await expect(outlineRow(page, 'group.other')).toHaveAttribute('aria-current', 'true');
  await expect(outlineRow(page, 'group.child')).not.toHaveAttribute('aria-current', 'true');
  await select(page, 'z');
  await expect(outlineRow(page, 'z')).toHaveAttribute('aria-current', 'true');
  await expectSource(page, outlineText);
  expect(errors).toEqual([]);
});

test('outline retains the last good tree and ignores jumps during pending and failed compiles', async ({ page }) => {
  await open(page);
  await page.selectOption('#layout', 'dagre');
  await painted(page);
  await type(page, outlineText);
  await page.evaluate(() => { traffic.holdAbove = -1; });
  await sourceInput(page).fill(outlineText + 'extra: Extra\n');
  const pendingCaret = await caret(page);
  await outlineJump(page, 'group.child').click();
  expect(await caret(page)).toBe(pendingCaret);
  await releaseCompile(page);
  await painted(page);
  const landed = await page.locator('#outline [role=treeitem]').allTextContents();
  expect(landed).toContain('Extra');
  await sourceInput(page).fill(outlineText + 'broken: {\n');
  await expect(page.locator('#status')).toHaveClass('error');
  const failedCaret = await caret(page);
  await outlineJump(page, 'group.child').click();
  expect(await caret(page)).toBe(failedCaret);
  await expect(outlineRow(page, 'extra')).toHaveCount(1);
  expect(await page.locator('#outline [role=treeitem]').allTextContents()).toEqual(landed);
});

test('outline roves with arrows, collapses only its tree, and Enter jumps', async ({ page }) => {
  await open(page);
  await type(page, outlineText);
  const group = outlineRow(page, 'group'), child = outlineRow(page, 'group.child');
  await group.focus();
  await page.keyboard.press('ArrowDown');
  await expect(child).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(group).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  await expect(child).toBeHidden();
  await page.keyboard.press('ArrowDown');
  await expect(outlineRow(page, 'z')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowRight');
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(child).toBeFocused();
  await expect(page.locator('#outline [role=treeitem][tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('Enter');
  expect(await caret(page)).toBe(outlineText.indexOf('child:'));
  await expectSource(page, outlineText);
});

test('only multiline association bodies fold, leaving braces around the placeholder', async ({ page }) => {
  const errors = await open(page);
  await type(page, foldText);
  await expect(foldMarkers(page)).toHaveCount(1);
  await foldMarkers(page).click();
  await expect(folded(page)).toHaveText('…');
  await expect(page.locator('#src .cm-line').filter({ has: page.locator('.cm-foldPlaceholder') })).toHaveText('a: {…}');
  await expectSource(page, foldText);
  await folded(page).click();
  await expect(folded(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('an edit inside a fold unfolds and drops its gutter range until the next good compile', async ({ page }) => {
  await open(page);
  await page.selectOption('#layout', 'dagre');
  await painted(page);
  await type(page, foldText);
  await foldMarkers(page).click();
  await withCm(page);
  await page.evaluate(from => {
    traffic.holdAbove = -1;
    cm.EditorView.findFromDOM(document.querySelector('#src .cm-editor')).dispatch({ changes: { from, to: from + 5, insert: 'Beta' } });
  }, foldText.indexOf('Alpha'));
  await expect(folded(page)).toHaveCount(0);
  await expect(foldMarkers(page)).toHaveCount(0);
  await releaseCompile(page);
  await painted(page);
  await expect(foldMarkers(page)).toHaveCount(1);
  await expectSource(page, foldText.replace('Alpha', 'Beta'));
});

test('a worker diagnostic inside an unchanged folded body unfolds it', async ({ page }) => {
  await open(page);
  await page.selectOption('#layout', 'dagre');
  await painted(page);
  await type(page, foldText);
  await foldMarkers(page).click();
  await page.evaluate(() => { traffic.holdAbove = -1; });
  await page.selectOption('#theme', '1');
  // Deliver a diagnostic without a text edit so this exercises diagnose, rather than edit invalidation.
  await releaseCompile(page, { severity: 'error', message: 'Body diagnostic', file: 'main.d2', range: { start: foldText.indexOf('Alpha'), end: foldText.indexOf('Alpha') + 5 } });
  await expect(folded(page)).toHaveCount(0);
  await expect(page.locator('#src .cm-lintRange-error')).toHaveCount(1);
  await expectSource(page, foldText);
});

test('current outline provenance lists inherited values with keyword names and literal jumps only', async ({ page }) => {
  await open(page);
  const text = 'classes: {kit: {label: Class; style.fill: red; style.font-size: 24}}\na: {class: kit; style.stroke: blue}\nb: Own {style.fill: green}\n';
  await type(page, text);
  await outlineJump(page, 'a').click();
  const provenance = outlineRow(page, 'a').locator(':scope > .provenance');
  await provenance.locator('summary').click();
  await expect(provenance).toContainText('fill: red (line 1)');
  await expect(provenance).toContainText('font-size: 24 (line 1)');
  await expect(provenance).not.toContainText('stroke:');
  await expect(provenance).toContainText('label: Class (line 1)');
  await provenance.getByRole('button', { name: 'fill: red (line 1)', exact: true }).click();
  expect(await caret(page)).toBe(text.indexOf('red;'));
  await outlineJump(page, 'b').click();
  await expect(page.locator('#outline .provenance')).toHaveCount(0);
  await expectSource(page, text);
});

test('folding and outline navigation leave whole-text undo and redo unchanged', async ({ page }) => {
  await open(page);
  const previous = await source(page);
  await type(page, foldText);
  await foldMarkers(page).click();
  await outlineJump(page, 'z').click();
  await page.locator('#undo').click();
  await expectSource(page, previous);
  await page.locator('#redo').click();
  await expectSource(page, foldText);
  await painted(page);
  await expect(folded(page)).toHaveCount(0);
});

test('outline is collapsed initially on narrow screens and CRLF bodies still fold correctly', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 900 });
  await open(page);
  await expect(page.locator('#outline')).not.toHaveAttribute('open', '');
  const text = '# 😀\r\n' + foldText.replaceAll('\n', '\r\n');
  await page.locator('#open').setInputFiles({ name: 'folds.d2', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await painted(page);
  await foldMarkers(page).click();
  await expect(folded(page)).toHaveCount(1);
  await page.locator('#outline > summary').click();
  await outlineJump(page, 'a').click();
  expect(await caret(page)).toBe(text.replaceAll('\r\n', '\n').indexOf('a:'));
});

test('without the flag the canvas selects and pans only: no connect tool, handles, toolbar or label editor, and drags and arrow keys write nothing', async ({ page }) => {
  await open(page);
  await type(page, 'a: A\nb: B\na -> b\n');
  const text = await source(page);
  await expect(page.locator('#visual-tools')).toBeHidden();
  await expect(page.locator('[data-entry], #add, #classes')).toHaveCount(0);
  await select(page, 'a');
  await expect(page.locator('#selected')).toContainText('a');
  await expect(page.locator('#toolbar')).toBeHidden();
  await drag(page, 'a', 70, 40);
  await object(page, 'a').locator('[data-k]').first().dblclick();
  await expect(page.locator('#host .label-edit, #host .handle, #host .end-dot')).toHaveCount(0);
  await page.locator('#host').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  expect(await source(page)).toBe(text);
  expect(await page.evaluate(() => traffic.requests.filter(r => r.type === 'edit').length)).toBe(0);
  // The inspector still edits through the same checked patches.
  await select(page, 'a');
  await patch(page, 'a: Alpha\nb: B\na -> b\n', () => property(page, 'label', 'Alpha'));
});

test('with ?visual=1 the connect tool appears', async ({ page }) => {
  await open(page, '/', { visual: true });
  await expect(page.locator('#visual-tools #connect')).toBeVisible();
});

test('the outline and inspector are panes of one side bar, and opening, closing or selecting never moves the source editor or the canvas', async ({ page }) => {
  await open(page);
  await type(page, outlineText);
  await expect(page.locator('#sidebar > #outline')).toHaveCount(1);
  await expect(page.locator('#sidebar > #inspector-pane')).toHaveCount(1);
  await expect(page.locator('aside.source-pane #outline')).toHaveCount(0);
  const editor = () => page.locator('#src').boundingBox(), canvas = () => page.locator('#canvas').boundingBox();
  const [editorBox, canvasBox] = [await editor(), await canvas()];
  await expect(page.locator('#no-selection')).toBeVisible();
  await select(page, 'z');
  await expect(page.locator('#inspector')).toBeVisible();
  await expect(page.locator('#no-selection')).toBeHidden();
  expect(await editor()).toEqual(editorBox);
  expect(await canvas()).toEqual(canvasBox);
  await page.locator('#outline > summary').click();
  await expect(page.locator('#outline')).not.toHaveAttribute('open', '');
  expect(await editor()).toEqual(editorBox);
  await page.locator('#outline > summary').click();
  await page.locator('#inspector-pane > summary').click();
  await expect(page.locator('#inspector')).toBeHidden();
  expect(await editor()).toEqual(editorBox);
  // A long tree scrolls inside its own pane instead of pushing the inspector off the side bar.
  const bar = await page.locator('#sidebar').boundingBox();
  const lower = await page.locator('#inspector-pane').boundingBox();
  expect(lower.y + lower.height).toBeLessThanOrEqual(bar.y + bar.height + 1);
});
