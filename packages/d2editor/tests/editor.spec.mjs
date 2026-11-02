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
          if (r.type === 'result') traffic.results.push({ revision: r.revision, echo: r.echo, error: r.error });
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

test('built page loads its real worker and wasm and paints the start example', async ({ page }) => {
  await open(page);
  await visible(page, 'api');
  await type(page, 'fresh: Typed\n');
  await visible(page, 'fresh');
  await expect(object(page, 'api')).toHaveCount(0);
});

test('the canvas pans by dragging without selecting, zooms with the controls, and a click still selects', async ({ page }) => {
  await open(page);
  const transform = () => page.locator('#host').evaluate(el => el.style.transform);
  const box = await object(page, 'api').locator('[data-k="rect"]').first().boundingBox();
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 45, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('#inspector')).toBeHidden();
  const moved = await object(page, 'api').locator('[data-k="rect"]').first().boundingBox();
  expect([Math.round(moved.x - box.x), Math.round(moved.y - box.y)]).toEqual([75, 40]);
  await page.click('#zoom-in');
  await expect(page.locator('#zoom')).toHaveText('125%');
  await expect.poll(transform).toContain('scale(1.25)');
  await page.click('#fit');
  await expect(page.locator('#zoom')).toHaveText('100%');
  await select(page, 'api');
  await expect(page.locator('#selected')).toHaveText('Shape api');
  // Zoomed in and panned away, focusing the lowest object brings its own paint into view, not the scene origin its <svg> wrappers sit at.
  for (let i = 0; i < 5; i++) await page.click('#zoom-in');
  await page.locator('#canvas').dispatchEvent('wheel', { deltaX: 0, deltaY: 5000 });
  await object(page, 'db').first().evaluate(el => el.focus());
  const view = await page.locator('#canvas').boundingBox(), shape = await object(page, 'db').locator('path').first().boundingBox();
  expect(shape.y >= view.y && shape.y + shape.height <= view.y + view.height).toBe(true);
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

test('examples, opening, downloading, restore and editing/idle seeds work at /editor/', async ({ page }) => {
  await open(page, '/editor/');
  await page.selectOption('#example', 'Container');
  await painted(page);
  await visible(page, 'services.api');
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
