import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync, cpSync } from 'node:fs';
import { join, extname } from 'node:path';
import { root } from '../../../tests/examples.mjs';

const dist = join(root, 'packages/d2editor/dist');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.wasm': 'application/wasm' };
async function open(page, path = '/') {
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
  await page.goto(`http://localhost:5281${path}`);
  await expect(page.locator('#status')).toContainText('compiled in', { timeout: 90_000 });
  expect(errors).toEqual([]);
  return errors;
}

const painted = page => expect(page.locator('#status')).toContainText('compiled in', { timeout: 90_000 });
const object = (page, id) => page.locator(`#host [data-id=${JSON.stringify(id)}]`);
// Object ownership frames can be zero-sized; click their painted child so the real delegated pointer event selects the object.
const select = (page, id) => object(page, id).locator('[data-k="rect"], [data-k="text"], svg').first().click({ position: { x: 5, y: 5 } });
const visible = (page, id) => expect(object(page, id).locator('[data-k]').first()).toBeVisible();
const source = page => page.inputValue('#src');
async function type(page, text) {
  await page.fill('#src', text);
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
  await expect(page.locator('#src')).toHaveValue(expected);
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
  await open(page);
  const text = 'a: A\nb: B\na -> b\n';
  await type(page, text);
  await select(page, 'a');
  const before = await outline(page), k = await zoom(page);
  const count = await page.evaluate(() => traffic.edits.length);
  await drag(page, 'a', 90, 60);
  await expect.poll(() => page.evaluate(() => traffic.edits.length)).toBe(count + 1);
  const left = Math.round(before.X + 90 / k), top = Math.round(before.Y + 60 / k);
  await expect(page.locator('#src')).toHaveValue(new RegExp(`top: ${top}[\\s\\S]*left: ${left}|left: ${left}[\\s\\S]*top: ${top}`));
  await painted(page);
  await expect(page.locator('#selected')).toHaveText('Shape a');
  expect(await outline(page)).toEqual({ X: left, Y: top });
  await drag(page, 'a', -30, 15);
  await expect(page.locator('#src')).toHaveValue(new RegExp(`top: ${top + Math.round(15 / k)}`));
  await painted(page);
  await page.click('#undo');
  await page.click('#undo');
  await expect(page.locator('#src')).toHaveValue(text);
});

test('a nested shape beside a fixed sibling lands where dropped; empty space pans; other engines pan with a hint and no edit', async ({ page }) => {
  await open(page);
  await type(page, 'c: {\n  d: {top: 30; left: 40}\n  e\n}\n');
  await select(page, 'c.e');
  const before = await outline(page), k = await zoom(page);
  await drag(page, 'c.e', 50, 80);
  await expect(page.locator('#src')).toHaveValue(/e: \{|e\.top|top: \d+[\s\S]*top: \d+/);
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
  const moved = await object(page, 'x').locator('[data-k]').first().boundingBox();
  expect(Math.round(moved.x - at.x)).toBe(60);
  expect(await page.evaluate(() => traffic.edits.length)).toBe(count);
});

// Spec 0015: a drop past the origin sits at 0 and the container's other shapes move by the overshoot.
const box = (page, id) => object(page, id).locator('[data-k]').first().boundingBox();
// Samples an object's screen left/top on every frame until stopped, so a jump between frames shows.
const sample = (page, ids) => page.evaluate(ids => {
  const seen = window.seen = { stop: false, frames: [] };
  const pos = id => { const el = document.querySelector('#host').shadowRoot.querySelector(`[data-id=${JSON.stringify(id)}] [data-k]`); return el && el.getBoundingClientRect(); };
  const frame = () => { seen.frames.push(Object.fromEntries(ids.map(id => [id, pos(id) && { x: pos(id).x, y: pos(id).y }]))); if (!seen.stop) requestAnimationFrame(frame); };
  frame();
}, ids);
// Pans so the origin lies inside the viewport, then drags `id` inside the canvas but past that origin along one axis.
async function pastOrigin(page, text, id, others, axis, reachOf) {
  await open(page);
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
  await expect(page.locator('#src')).toHaveValue(/a: A \{[\s\S]*left: 0[\s\S]*b: B \{[\s\S]*left: \d+/);
  await expect(page.locator('#marks mark.side').first()).toBeAttached();
  await expect(page.locator('#marks mark:not(.side)').first()).toBeAttached();
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
  // One drag rewrote this many lines (spec 0015 section 4).
  const after = await page.inputValue('#src'), old = text.split('\n');
  const changed = after.split('\n').filter(l => { const i = old.indexOf(l); if (i < 0) return true; old.splice(i, 1); return false; }).length;
  test.info().annotations.push({ type: 'changed lines', description: String(changed) });
  expect(changed).toBeLessThanOrEqual(10);
  await page.click('#undo');
  await expect(page.locator('#src')).toHaveValue(text);
});

test('dragging past the top origin shifts siblings down, and the shape stays under the pointer', async ({ page }) => {
  const text = 'a: A\n\n# between\n\nb: B\na -> b\n';
  const m = await pastOrigin(page, text, 'a', ['b'], 'y');
  await drop(page, m, ['a', 'b']);
  await page.mouse.up();
  await expect(page.locator('#src')).toHaveValue(/a: A \{[\s\S]*top: 0[\s\S]*b: B \{[\s\S]*top: \d+/);
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
  await expect(page.locator('#src')).toHaveValue(/d: \{top: 30; left: (?!40\b)\d+\}[\s\S]*e: \{[\s\S]*left: 0/);
  await painted(page);
  await page.waitForTimeout(400);
  const e1 = await box(page, 'c.e'), d1 = await box(page, 'c.d');
  expect(Math.abs(e1.x - (m.to.x - 4))).toBeLessThanOrEqual(6);
  expect(Math.abs((d1.x - e1.x) - ((m.before['c.d'].x - m.before['c.e'].x) + m.reach))).toBeLessThanOrEqual(2 * m.k + 4);
});

test('a shape dropped fully outside its container makes no edit and says why', async ({ page }) => {
  await open(page);
  await type(page, 'c: {\n  d\n}\n');
  const count = await page.evaluate(() => traffic.edits.length);
  const c = await box(page, 'c');
  await drag(page, 'c.d', c.width + 200, 0);
  await expect(page.locator('#status')).toContainText('out of its container');
  expect(await page.evaluate(() => traffic.edits.length)).toBe(count);
  await visible(page, 'c.d');
});

test('restyle, relabel, create, connect, rename and delete use only the exact checked patches', async ({ page }) => {
  const errors = await open(page, '/repo/editor/');
  await type(page, '# services\na: API\nb: DB\n');
  await select(page, 'a');
  await expect(page.locator('#selected')).toHaveText('Shape a');
  await expect(page.locator('#sources')).toContainText('main.d2 line 2');
  const red = '# services\na: API {style.fill: "#ff0000"}\nb: DB\n';
  await patch(page, red, () => property(page, 'fill', '#ff0000'));
  expect(await object(page, 'a').evaluate(el => [el, ...el.querySelectorAll('*')].some(e => getComputedStyle(e).backgroundColor === 'rgb(255, 0, 0)' || getComputedStyle(e).fill === 'rgb(255, 0, 0)'))).toBe(true);
  await expect(page.locator('#marks mark')).not.toHaveCount(0);
  const label = '# services\na: Gateway {style.fill: "#ff0000"}\nb: DB\n';
  await patch(page, label, () => property(page, 'label', 'Gateway'));
  await expect(object(page, 'a')).toContainText('Gateway');
  const created = label + 'shape 2\n';
  await patch(page, created, () => page.click('#add'));
  await expect(page.locator('#rename input')).toBeFocused();
  await expect(page.locator('#rename input')).toHaveValue('shape 2');
  await visible(page, 'shape 2');
  await select(page, 'a');
  await page.click('#connect');
  // Connect mode must look pressed: toolbar buttons are otherwise transparent.
  await expect(page.locator('#connect')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const connected = created + 'a -> b\n';
  await patch(page, connected, () => select(page, 'b'));
  await expect(object(page, '(a -> b)[0]').locator('path').first()).toHaveAttribute('d', /M/);
  await select(page, 'b');
  const renamed = '# services\na: Gateway {style.fill: "#ff0000"}\ndatabase: DB\nshape 2\na -> database\n';
  await patch(page, renamed, async () => { await page.fill('#rename input', 'database'); await page.locator('#rename input').press('Enter'); });
  await expect(page.locator('#selected')).toHaveText('Shape database');
  await expect(object(page, '(a -> database)[0]').locator('path').first()).toHaveAttribute('d', /M/);
  await patch(page, '# services\na: Gateway {style.fill: "#ff0000"}\n\nshape 2\n', () => page.click('#delete'));
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
  await expect(page.locator('#src')).toHaveValue(text);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#delete')).toBeFocused();
  await expect(page.locator('#src')).toHaveValue(text);
  await page.click('#delete');
  await expect(page.locator('#unchecked')).toBeVisible();
  await page.click('#use');
  await expect(page.locator('#src')).toHaveValue('testing: scenarios\n');
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
  await expect(page.locator('#src')).toHaveValue(shaped);
  // The colour picker makes the same edit through its text field.
  await patch(page, shaped.replace('red', '"#00ff00"'), () => page.locator('input[data-for="stroke"]').fill('#00ff00'));
  await expect(page.locator('#props [name="stroke"]')).toHaveValue('#00ff00');
});

test('undo and redo restore exact mixed typed and patched texts with buttons and keyboard, including in the textarea', async ({ page }) => {
  await open(page);
  const typed = '# mine\na: API\n';
  await type(page, typed);
  await select(page, 'a');
  const red = '# mine\na: API {style.fill: red}\n';
  await patch(page, red, () => property(page, 'fill', 'red'));
  await page.click('#undo');
  await expect(page.locator('#src')).toHaveValue(typed);
  await painted(page);
  await page.click('#redo');
  await expect(page.locator('#src')).toHaveValue(red);
  await painted(page);
  await page.locator('#src').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#src')).toHaveValue(typed);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.locator('#src')).toHaveValue(red);
  await painted(page);
});

test('layer edits keep the root text; adding inside a selected container uses D2 keys', async ({ page }) => {
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
  await select(page, 'box');
  await patch(page, 'box: {\n  a\n  shape 2\n}\n', () => page.click('#add'));
  await visible(page, 'box.shape 2');
});

test('Tab selects objects; keyboard reaches inspector, commits a label, renames and deletes', async ({ page }) => {
  await open(page);
  await type(page, 'a: API\n');
  await page.locator('#src').focus();
  await page.keyboard.press('Tab');
  await expect(object(page, 'a')).toBeFocused();
  await expect(page.locator('#selected')).toHaveText('Shape a');
  await page.keyboard.press('Escape');
  await expect(page.locator('#inspector')).toBeHidden();
  await expect(page.locator('#src')).toHaveValue('a: API\n');
  await page.locator('#src').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.locator('#props [name="label"]')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Keyboard');
  await patch(page, 'a: Keyboard\n', () => page.keyboard.press('Enter'));
  // Continue with Tab only, from the source through the canvas into the rename form.
  await page.locator('#src').focus();
  for (let n = 0; n < 6; n++) await page.keyboard.press('Tab');
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
  await page.evaluate(() => {
    const src = document.querySelector('#src');
    src.value = 'newest: Typed\n';
    src.dispatchEvent(new Event('input', { bubbles: true }));
    traffic.hold = false;
    traffic.held.worker.dispatchEvent(new MessageEvent('message', { data: traffic.held.data }));
  });
  await painted(page);
  await expect(page.locator('#src')).toHaveValue('newest: Typed\n');
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
  await page.click('#add');
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

test('theme and layout menus reach the compile, are restored on reload, and other engines skip the idle TALA compile', async ({ page }) => {
  await open(page);
  const last = () => page.evaluate(() => traffic.requests.filter(r => r.type === 'compile').at(-1));
  await page.selectOption('#theme', '4');
  await expect.poll(async () => (await last()).render.themeId).toBe(4);
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
  expect((await last()).layout).toBe('dagre');
});

test('a ?script= link opens on top of the saved text, a bad link keeps it, and Share copies a link that reopens the diagram', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  await type(page, 'mine: My saved text\n');
  // D2's own encoding (lib/urlenc) of a small script, as Go produces it.
  const script = 'x -> y\nI just forgot my whole philosophy of life!!!: {\n  s: TV is chewing gum for the eyes\n}\n';
  await page.goto('http://localhost:5281/?script=FMvBDcIwDEDRe6b4GYAFeuDOHbEAcmKjFFc4VbEQuyMGeG9OZ7JceOwxaf7qPlmTQ30Im9rw8E0TbwxrUmtd-BSIhesNC-4qhz07fV__nqmCpET5lt8A&layout=dagre');
  await painted(page);
  await expect(page.locator('#src')).toHaveValue(script);
  await expect(page.locator('#layout')).toHaveValue('dagre');
  expect(new URL(page.url()).search).toBe('');
  await page.click('#undo');
  await expect(page.locator('#src')).toHaveValue('mine: My saved text\n');
  await page.goto('http://localhost:5281/?script=broken!!');
  // The error outlasts the startup compiles (seeds [1], then the idle default seeds).
  await expect.poll(() => page.evaluate(() => traffic.results.filter(r => !r.error).length)).toBeGreaterThanOrEqual(2);
  await expect(page.locator('#status.error')).toContainText('shared link could not be opened');
  await expect(page.locator('#src')).toHaveValue('mine: My saved text\n');
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
  await expect(page.locator('#src')).toHaveValue('mine: My saved text\n');
});

test('opening, downloading, restore and editing/idle seeds work at /editor/', async ({ page }) => {
  await open(page, '/editor/');
  // No example menu (user, 2 November 2026): files come from Open or the source pane.
  await expect(page.locator('#example')).toHaveCount(0);
  const text = '# opened file\r\na: From file\r\n';
  await page.locator('#open').setInputFiles({ name: 'mine.d2', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await expect(page.locator('#src')).toHaveValue(text.replaceAll('\r\n', '\n'));
  await painted(page);
  expect(await page.evaluate(() => traffic.requests.filter(r => r.type === 'compile').at(-1).files['main.d2'])).toBe(text);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  expect(readFileSync(await download.path(), 'utf8')).toBe(text);
  await expect.poll(() => page.evaluate(() => traffic.results.at(-1)?.echo.seeds)).toEqual([1, 2, 3]);
  const revision = await page.evaluate(() => traffic.requests.filter(r => r.type === 'compile').at(-1).revision);
  expect(await page.evaluate(revision => traffic.requests.filter(r => r.type === 'compile' && r.revision === revision).map(r => r.seeds ?? [1, 2, 3]), revision)).toEqual([[1], [1, 2, 3]]);
  await page.reload();
  await painted(page);
  await expect(page.locator('#src')).toHaveValue(text.replaceAll('\r\n', '\n'));
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
