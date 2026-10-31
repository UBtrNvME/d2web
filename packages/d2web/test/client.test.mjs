import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient, SupersededError, TimeoutError, VersionError } from '../src/client.ts';

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
