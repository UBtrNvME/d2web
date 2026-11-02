import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient, SupersededError } from '../src/client.ts';
import { fetchImages } from '../src/images.ts';
import { ProtocolError } from '../src/request.ts';

// Spec 0010 tests 1-5 and 16: the images option, the bundle flow with a scripted worker, limits, latest wins, the cache and fetchImages.
const render = { themeId: 0, sketch: false, pad: 0, scale: 1, center: false };
const input = (revision, source = 'a: { icon: https://i.test/a.svg }') => ({ revision, files: { 'main.d2': source }, entry: 'main.d2', render });
const wait = ms => new Promise(r => setTimeout(r, ms));
const bytes = (...n) => new Uint8Array(n);

// A scripted worker: a preflight answers with `links`; a compile answers with an empty result. Everything it receives is kept in `sent`.
function fakes({ links = [], delay = 0 } = {}) {
  const spawned = [];
  const spawn = () => {
    const w = { sent: [], terminated: false, onmessage: null, onerror: null };
    w.postMessage = m => {
      w.sent.push(m);
      const reply = r => setTimeout(() => { if (!w.terminated) w.onmessage?.({ data: r }); }, delay);
      if (m.type === 'preflight') reply({ v: 2, type: 'images', id: m.id, links });
      if (m.type === 'compile') reply({ v: 2, type: 'result', id: m.id, revision: m.revision, millis: 1, available: [''], boards: [], diagnostics: [], echo: {} });
    };
    w.terminate = () => { w.terminated = true; };
    spawned.push(w);
    setTimeout(() => w.onmessage?.({ data: { v: 2, type: 'ready', d2: '0.9.0', engines: ['tala'], sceneVersion: 1, patched: false } }), 1);
    return w;
  };
  return { spawn, spawned };
}
const link = (source, board = '', id = 'a') => ({ board, id, kind: 'icon', source });
const types = w => w.sent.map(m => m.type);

test('1. the images option is validated when the client is created', () => {
  const { spawn } = fakes();
  const bad = [
    [null, /must be an object/], [{ mode: 'fetch' }, /mode must be/], [{ mode: 'bundle' }, /resolve must be a function/],
    [{ mode: 'bundle', resolve() {}, fallback: 'placeholder' }, /fallback/], [{ mode: 'bundle', resolve() {}, extra: 1 }, /unknown images\.extra/],
    [{ mode: 'bundle', resolve() {}, limits: { bytes: 0 } }, /limits\.bytes must be an integer >= 1/], [{ mode: 'bundle', resolve() {}, limits: { speed: 1 } }, /unknown images\.limits\.speed/],
    [{ mode: 'bundle', resolve() {}, supplied: { 'https://i.test/a.svg': 'text' } }, /supplied/], [{ mode: 'link', resolve() {} }, /unknown images\.resolve/],
  ];
  for (const [images, pattern] of bad) assert.throws(() => createClient({ spawn, images }), error => error instanceof ProtocolError && pattern.test(error.message), JSON.stringify(images));
  createClient({ spawn, images: { mode: 'link' } }).dispose();
  createClient({ spawn, images: { mode: 'bundle', resolve: async () => null } }).dispose();
  assert.equal(fakes().spawned.length, 0);
});

test('2. bundle flow: preflight, one resolve per distinct link (a #fragment adds none), then a compile keyed by the preflight sources', async () => {
  const { spawn, spawned } = fakes({ links: [link('https://i.test/a.svg'), link('https://i.test/a.svg#x', '', 'b'), link('https://i.test/b.png', '/layers/n', 'c'), link('data:image/png;base64,AAAA', '', 'd')] });
  const calls = [];
  const client = createClient({ spawn, images: { mode: 'bundle', resolve: async (s, ctx) => { calls.push(s); assert(ctx.signal instanceof AbortSignal); return new Blob([bytes(1, 2)], { type: 'image/png' }); } } });
  await client.compile({ ...input(1), boards: 'all' });
  assert.deepEqual(types(spawned[0]), ['preflight', 'compile']);
  assert.deepEqual(calls.sort(), ['https://i.test/a.svg', 'https://i.test/b.png']);
  const images = spawned[0].sent[1].images;
  assert.deepEqual(Object.keys(images).sort(), ['https://i.test/a.svg', 'https://i.test/a.svg#x', 'https://i.test/b.png']);
  assert.equal(images['https://i.test/a.svg'].type, 'image/png');
  assert.deepEqual([...images['https://i.test/a.svg#x'].data], [1, 2]);
  client.dispose();
});

test('2. only the links of the requested boards are resolved; supplied bytes are tried first and skip resolve', async () => {
  const { spawn } = fakes({ links: [link('https://i.test/root.svg'), link('https://i.test/layer.svg', '/layers/n'), link('relative/icon.png')] });
  const calls = [];
  const client = createClient({ spawn, images: { mode: 'bundle', resolve: async s => { calls.push(s); return bytes(9); }, supplied: { 'relative/icon.png': bytes(5, 5) } } });
  await client.compile(input(1));
  assert.deepEqual(calls, ['https://i.test/root.svg'], 'the layer is not requested; the supplied relative path never reaches resolve');
  client.dispose();
});

test('a source with no icon asks the worker nothing and still sends an (empty) images field', async () => {
  const { spawn, spawned } = fakes();
  const client = createClient({ spawn, images: { mode: 'bundle', resolve: async () => bytes(1) } });
  await client.compile(input(1, 'a -> b'));
  assert.deepEqual(types(spawned[0]), ['compile']);
  assert.deepEqual(spawned[0].sent[0].images, {});
  client.dispose();
});

test('without the option there is no preflight, no images field and no resolve (test 10 at the client)', async () => {
  const { spawn, spawned } = fakes({ links: [link('https://i.test/a.svg')] });
  const client = createClient({ spawn });
  await client.compile(input(1));
  assert.deepEqual(types(spawned[0]), ['compile']);
  assert.equal('images' in spawned[0].sent[0], false);
  client.dispose();
});

test('a D2 error from the preflight skips the fetch; the compile still goes out', async () => {
  const { spawn, spawned } = fakes();
  spawned.length = 0;
  const failing = () => { const w = spawn(); const post = w.postMessage; w.postMessage = m => m.type === 'preflight' ? (w.sent.push(m), setTimeout(() => w.onmessage({ data: { v: 2, type: 'images', id: m.id, links: [], error: 'syntax' } }), 0)) : post(m); return w; };
  let called = 0;
  const client = createClient({ spawn: failing, images: { mode: 'bundle', resolve: async () => { called++; return bytes(1); } } });
  await client.compile(input(1));
  assert.equal(called, 0);
  client.dispose();
});

test('3. a link that throws, returns null, times out, is empty or too large is unresolved and the compile still happens', async () => {
  const links = ['throws', 'null', 'slow', 'empty', 'big', 'good'].map(n => link(`https://i.test/${n}.svg`));
  const { spawn, spawned } = fakes({ links });
  const answers = { throws: () => { throw new Error('boom'); }, null: async () => null, slow: () => new Promise(() => {}), empty: async () => bytes(), big: async () => new Uint8Array(33), good: async () => bytes(1, 2, 3) };
  const client = createClient({ spawn, images: { mode: 'bundle', limits: { bytes: 32, timeoutMs: 30 }, resolve: (s, ctx) => answers[s.match(/\/(\w+)\.svg/)[1]](ctx) } });
  await client.compile(input(1));
  assert.deepEqual(Object.keys(spawned[0].sent[1].images), ['https://i.test/good.svg']);
  client.dispose();
});

test('3. concurrency never exceeds the limit, and the count limit leaves the rest unresolved', async () => {
  const links = Array.from({ length: 9 }, (_, i) => link(`https://i.test/${i}.svg`));
  const { spawn, spawned } = fakes({ links });
  let live = 0, peak = 0, calls = 0;
  const resolve = async () => { calls++; peak = Math.max(peak, ++live); await wait(5); live--; return bytes(1); };
  const client = createClient({ spawn, images: { mode: 'bundle', resolve, limits: { concurrency: 2, count: 7 } } });
  await client.compile(input(1));
  assert.equal(peak, 2);
  assert.equal(calls, 7);
  assert.equal(Object.keys(spawned[0].sent[1].images).length, 7);
  client.dispose();
});

test('4. a newer compile aborts the older one\'s resolve signals and its result is discarded', async () => {
  const { spawn, spawned } = fakes({ links: [link('https://i.test/a.svg')] });
  const signals = [];
  const client = createClient({ spawn, images: { mode: 'bundle', resolve: (s, { signal }) => { signals.push(signal); return new Promise(() => {}); } } });
  const first = client.compile(input(1)).then(() => 'ok', e => e);
  await wait(30);
  assert.equal(signals.length, 1);
  const second = client.compile(input(2)).then(r => r.revision, e => e);
  assert((await first) instanceof SupersededError);
  assert.equal(signals[0].aborted, true);
  assert.equal(spawned.length, 1, 'no worker respawn: nothing had been compiled');
  assert.equal(spawned[0].sent.filter(m => m.type === 'compile').length, 0, 'the first revision never reached the compile');
  await wait(20);
  client.dispose();
  assert.equal((await second) instanceof Error, true); // disposed while its own resolve hangs
});

test('5. the cache: a second compile with the same links makes no resolve call; it is bounded by count', async () => {
  const { spawn } = fakes({ links: [link('https://i.test/a.svg')] });
  let calls = 0;
  const client = createClient({ spawn, images: { mode: 'bundle', resolve: async () => { calls++; return bytes(1); } } });
  await client.compile(input(1));
  await client.compile(input(2));
  assert.equal(calls, 1);
  client.dispose();

  const many = Array.from({ length: 4 }, (_, i) => link(`https://i.test/${i}.svg`));
  const shown = [many[0], many[1]];
  const bounded = fakes({ links: shown });
  calls = 0;
  const small = createClient({ spawn: bounded.spawn, images: { mode: 'bundle', limits: { count: 2 }, resolve: async () => { calls++; return bytes(1); } } });
  await small.compile(input(1)); // 0 and 1 resolved
  await small.compile(input(2));
  assert.equal(calls, 2, 'the same two links are served from the cache');
  shown.splice(0, 2, many[2], many[3]);
  await small.compile(input(3)); // 2 and 3 resolved, which evicts the two oldest
  shown.splice(0, 2, many[0], many[1]);
  await small.compile(input(4));
  assert.equal(calls, 6, 'the cache holds at most the count limit, so 0 and 1 had to be asked for again');
  small.dispose();
});

test('5. a failed link is remembered briefly, so a hanging link does not stall every compile', async () => {
  const { spawn } = fakes({ links: [link('https://i.test/a.svg')] });
  let calls = 0;
  const client = createClient({ spawn, images: { mode: 'bundle', limits: { timeoutMs: 20 }, resolve: () => { calls++; return new Promise(() => {}); } } });
  await client.compile(input(1));
  const t = Date.now();
  await client.compile(input(2));
  assert.equal(calls, 1);
  assert(Date.now() - t < 15);
  client.dispose();
});

test('16. fetchImages: allowed origins with credentials omitted by default; null outside allow, for non-2xx and for failures; never throws', async () => {
  const seen = [];
  const doFetch = async (url, init) => { seen.push([url, init]); if (url.includes('boom')) throw new TypeError('network'); return url.includes('missing') ? new Response('no', { status: 404 }) : new Response(new Blob([bytes(7)], { type: 'image/png' })); };
  const resolve = fetchImages({ allow: ['https://icons.test', 'https://other.test/ignored/path'], fetch: doFetch });
  const signal = new AbortController().signal;
  const blob = await resolve('https://icons.test/a.png#frag', { signal });
  assert.equal(blob.type, 'image/png');
  assert.equal(seen[0][1].credentials, 'omit'); assert.equal(seen[0][1].signal, signal); assert.equal(seen[0][1].referrerPolicy, 'no-referrer');
  assert.equal(await resolve('https://evil.test/a.png', { signal }), null);
  assert.equal(await resolve('https://icons.test.evil.test/a.png', { signal }), null);
  assert.equal(await resolve('relative/a.png', { signal }), null);
  assert.equal(await resolve('https://icons.test/missing.png', { signal }), null);
  assert.equal(await resolve('https://icons.test/boom.png', { signal }), null);
  assert.equal(await resolve('https://other.test/x.png', { signal }) instanceof Blob, true);
  assert.equal(seen.length, 4, 'nothing outside allow was requested');
  await fetchImages({ allow: ['https://icons.test'], credentials: 'include', fetch: doFetch })('https://icons.test/c.png', { signal });
  assert.equal(seen.at(-1)[1].credentials, 'include');
  assert.throws(() => fetchImages({ allow: ['not an origin'] }), ProtocolError);
});

test('link mode: no preflight, no images field, no resolve; the worker is asked to report links', async () => {
  const { spawn, spawned } = fakes({ links: [link('https://i.test/a.svg')] });
  const client = createClient({ spawn, images: { mode: 'link' } });
  await client.compile(input(1));
  assert.deepEqual(types(spawned[0]), ['compile']);
  assert.equal('images' in spawned[0].sent[0], false);
  assert.equal(spawned[0].sent[0].linkImages, true);
  client.dispose();
});

test('17. bundle with fallback "link" sends the bytes it has and asks for links of the rest; without fallback it does not', async () => {
  for (const fallback of [undefined, 'link']) {
    const { spawn, spawned } = fakes({ links: [link('https://i.test/a.svg'), link('https://i.test/b.svg', '', 'b')] });
    const client = createClient({ spawn, images: { mode: 'bundle', fallback, resolve: async s => (s.endsWith('a.svg') ? bytes(1) : null) } });
    await client.compile(input(1));
    const compile = spawned[0].sent.find(m => m.type === 'compile');
    assert.deepEqual(Object.keys(compile.images), ['https://i.test/a.svg']);
    assert.equal(compile.linkImages, fallback ? true : undefined);
    client.dispose();
  }
});
