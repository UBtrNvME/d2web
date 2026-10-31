import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient, FontError, SupersededError, TimeoutError, VersionError } from '../src/client.ts';
import { createHash } from 'node:crypto';

const render = { themeId: 0, sketch: false, pad: 0, scale: 1, center: false };
const input = (revision, source = 'a') => ({ revision, files: { 'main.d2': source }, entry: 'main.d2', render });
const wait = ms => new Promise(r => setTimeout(r, ms));

// A scripted worker: replies come from `behave(message, reply)`; `ready` is sent on the next tick like the real one.
function fakes(behave, ready = {}) {
  const spawned = [];
  const spawn = () => {
    const w = { sent: [], terminated: false, onmessage: null, onerror: null };
    w.postMessage = m => { w.sent.push(m); behave(m, reply => { if (!w.terminated) w.onmessage?.({ data: reply }); }, w); };
    w.terminate = () => { w.terminated = true; };
    spawned.push(w);
    setTimeout(() => w.onmessage?.({ data: { v: 1, type: 'ready', d2: '0.9.0', engines: ['tala'], sceneVersion: 1, patched: false, ...ready } }), 1);
    return w;
  };
  return { spawn, spawned };
}
const result = (m, extra = {}) => ({ v: 1, type: 'result', id: m.id, revision: m.revision, millis: 1, available: [''], boards: [], diagnostics: [], echo: {}, ...extra });
const answer = (ms = 0) => (m, reply) => setTimeout(() => reply(result(m)), ms);

test('compile resolves with the worker result after ready', async () => {
  const { spawn, spawned } = fakes(answer());
  const client = createClient({ spawn });
  const r = await client.compile(input(5));
  assert.equal(r.revision, 5);
  assert.equal(spawned[0].sent.length, 1);
  assert.equal(spawned[0].sent[0].type, 'compile');
  assert.equal(spawned[0].sent[0].budgets.maxNodes, 100_000, 'request is normalized before sending');
  client.dispose();
});

test('invalid input rejects without reaching the worker', async () => {
  const { spawn, spawned } = fakes(answer());
  const client = createClient({ spawn });
  await assert.rejects(client.compile({ ...input(1), entry: 'missing.d2' }), /entry/);
  assert.equal(spawned.flatMap(w => w.sent).length, 0);
  client.dispose();
});

test('latest wins: a burst during one running compile computes twice, earlier ones are superseded', async () => {
  const { spawn, spawned } = fakes(answer(30));
  const client = createClient({ spawn });
  const settled = [1, 2, 3, 4, 5, 6].map(n => client.compile(input(n)).then(r => ({ ok: r.revision }), e => ({ err: e.constructor.name })));
  const out = await Promise.all(settled);
  assert.equal(spawned[0].sent.length, 2, 'first and last only');
  assert.deepEqual(out.slice(1, 5), Array(4).fill({ err: 'SupersededError' }));
  assert.deepEqual(out[5], { ok: 6 });
  assert.deepEqual(out[0], { err: 'SupersededError' }, 'a result that arrives after a newer request is dropped');
  client.dispose();
});

test('a long-running compile is replaced by terminating and respawning the worker', async () => {
  const { spawn, spawned } = fakes((m, reply) => { if (m.revision !== 2) return; reply(result(m)); }); // revision 1 never answers
  const client = createClient({ spawn, supersedeAfterMs: 20 });
  const first = client.compile(input(1)).then(() => 'ok', e => e);
  await wait(60);
  const second = await client.compile(input(2));
  assert.equal(second.revision, 2);
  assert(await first instanceof SupersededError);
  assert.equal(spawned.length, 2);
  assert.equal(spawned[0].terminated, true);
  client.dispose();
});

test('a worker that never answers times out, is replaced, and the client keeps working', async () => {
  const { spawn, spawned } = fakes((m, reply) => { if (m.revision !== 1) reply(result(m)); });
  const client = createClient({ spawn, silentTimeoutMs: 30 });
  await assert.rejects(client.compile(input(1)), TimeoutError);
  assert.equal(spawned.length, 2);
  assert.equal(spawned[0].terminated, true);
  assert.equal((await client.compile(input(2))).revision, 2);
  client.dispose();
});

test('worker error event rejects the running compile and respawns', async () => {
  const { spawn, spawned } = fakes((m, reply, w) => { if (m.revision === 1) setTimeout(() => w.onerror?.({ message: 'trap' }), 1); else reply(result(m)); });
  const client = createClient({ spawn });
  await assert.rejects(client.compile(input(1)), /trap/);
  assert.equal(spawned.length, 2);
  assert.equal((await client.compile(input(2))).revision, 2);
  client.dispose();
});

test('error results resolve (they are answers); dispose terminates and rejects later calls', async () => {
  const { spawn, spawned } = fakes((m, reply) => reply(result(m, { boards: undefined, error: { code: 'compile', message: 'x', diagnostics: [] } })));
  const client = createClient({ spawn });
  assert.equal((await client.compile(input(1))).error.code, 'compile');
  client.dispose();
  assert.equal(spawned[0].terminated, true);
  await assert.rejects(client.compile(input(2)), /disposed/);
});

test('a worker with another protocol or scene version is rejected with VersionError, not left hanging', async () => {
  for (const ready of [{ v: 2 }, { sceneVersion: 9 }]) {
    const { spawn, spawned } = fakes(answer(), ready);
    const client = createClient({ spawn });
    await assert.rejects(client.compile(input(1)), VersionError);
    assert.equal(spawned[0].sent.length, 0);
    client.dispose();
  }
});

// Spec 0008: the layout budget bounds a compile; the worker is replaced and the error says it was the budget.
test('a compile past budgets.maxLayoutMillis is aborted with a budget TimeoutError and the worker is replaced', async () => {
  const { spawn, spawned } = fakes(() => {}); // never answers
  const client = createClient({ spawn });
  const started = Date.now();
  const error = await client.compile({ ...input(1), budgets: { maxLayoutMillis: 40 } }).catch(e => e);
  assert.ok(error instanceof TimeoutError);
  assert.equal(error.code, 'budget');
  assert.ok(Date.now() - started < 1000, 'aborted near the budget, not at the 120 s silent timeout');
  assert.equal(spawned[0].terminated, true);
  assert.equal(spawned.length, 2);
  client.dispose();
});

test('the default layout budget is 60 s and a non-integer one is refused', async () => {
  const { spawn, spawned } = fakes(answer());
  const client = createClient({ spawn });
  await client.compile(input(1));
  assert.equal(spawned[0].sent[0].budgets.maxLayoutMillis, 60_000);
  await assert.rejects(client.compile({ ...input(2), budgets: { maxLayoutMillis: 0.5 } }), /maxLayoutMillis/);
  client.dispose();
});

// Spec 0007: consumer-approved fallback fonts are fetched once, checked, and posted to every worker before its first compile.
const bytes = new Uint8Array([1, 2, 3, 4]);
const sha = createHash('sha256').update(bytes).digest('hex');
const okFetch = calls => async url => { calls.push(url); return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(0) }; };

test('listed fonts are fetched once and posted before the first compile of each worker, including a respawned one', async () => {
  const calls = [];
  const { spawn, spawned } = fakes(answer());
  const client = createClient({ spawn, fonts: [{ name: 'Amiri', url: 'https://x.test/a.ttf', sha256: sha }], fetch: okFetch(calls), supersedeAfterMs: 1 });
  await client.compile(input(1));
  assert.deepEqual(spawned[0].sent.map(m => m.type), ['fonts', 'compile']);
  assert.deepEqual([...spawned[0].sent[0].fonts[0].data], [1, 2, 3, 4]);
  assert.equal(spawned[0].sent[0].fonts[0].name, 'Amiri');
  spawned[0].onerror?.({ message: 'boom' }); // respawn
  await wait(5);
  await client.compile(input(2));
  assert.deepEqual(spawned[1].sent.map(m => m.type), ['fonts', 'compile']);
  assert.deepEqual(calls, ['https://x.test/a.ttf'], 'fetched once for both workers');
  client.dispose();
});

test('a client without fonts never posts a fonts message or fetches', async () => {
  const { spawn, spawned } = fakes(answer());
  const client = createClient({ spawn, fetch: async () => { throw new Error('must not fetch'); } });
  await client.compile(input(1));
  assert.deepEqual(spawned[0].sent.map(m => m.type), ['compile']);
  client.dispose();
});

test('a checksum mismatch or a failed fetch rejects the compile with FontError and sends nothing', async () => {
  for (const [fetch, expect] of [[okFetch([]), /checksum/], [async () => ({ ok: false, status: 404 }), /404/], [async () => { throw new Error('offline'); }, /offline/]]) {
    const { spawn, spawned } = fakes(answer());
    const client = createClient({ spawn, fonts: [{ name: 'F', url: 'https://x.test/f.ttf', sha256: fetch === okFetch ? '' : 'a'.repeat(64) }].map(f => (f.sha256 ? f : { name: f.name, url: f.url, sha256: 'b'.repeat(64) })), fetch });
    await assert.rejects(client.compile(input(1)), e => e instanceof FontError && expect.test(e.message));
    assert.equal(spawned[0].sent.length, 0);
    client.dispose();
  }
});

test('the worker refusing the fonts rejects the compile with FontError', async () => {
  const { spawn } = fakes((m, reply) => { if (m.type === 'fonts') reply({ type: 'fonts', error: 'font "F": not a font' }); });
  const client = createClient({ spawn, fonts: [{ name: 'F', url: 'https://x.test/f.ttf' }], fetch: okFetch([]) });
  await assert.rejects(client.compile(input(1)), e => e instanceof FontError && /not a font/.test(e.message));
  client.dispose();
});

test('a malformed font list is refused when the client is created, before any fetch', () => {
  const { spawn } = fakes(answer());
  for (const bad of ['x', [{ url: 'u' }], [{ name: 'n' }], [{ name: 'n', url: 'u', sha256: 'zz' }], [{ name: 'n', url: 'u', extra: 1 }]]) assert.throws(() => createClient({ spawn, fonts: bad, fetch: async () => { throw new Error('no'); } }), /fonts/);
});
