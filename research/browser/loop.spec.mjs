import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { root } from '../../tests/examples.mjs';

// R6 in Chromium: consumer DOM cards (plain styled elements standing in for shadcn-style cards) are measured, their sizes are
// requested as D2 width/height, the board is recompiled with TALA in a Go/js-wasm instance inside the page, and the cards are
// placed on the resulting boxes. Records convergence, per-step latency and layout side effects when card content grows and
// a ResizeObserver fires. Not a proposed API: each request instantiates a fresh probe instance.
const output = join(root, 'artifacts/research-loop');
const { goRoot } = JSON.parse(execFileSync('node', [join(root, 'research/loop.mjs')], { encoding: 'utf8', timeout: 300_000 }).trim().split('\n').pop());
const base = 'direction: right\na.label: ""\nb.label: ""\nc.label: ""\nd.label: ""\na -> b\nb -> c\nb -> d\n';

test('research: measured DOM cards drive D2 sizes through an in-page recompile loop', async ({ page }) => {
  test.setTimeout(300_000);
  await page.route('https://host.test/**', route => {
    const file = new URL(route.request().url()).pathname.slice(1);
    if (file === '') return route.fulfill({ body: '<!doctype html><title>loop</title><body style="margin:0"><div id="board" style="position:relative"></div>', contentType: 'text/html' });
    return route.fulfill({ body: readFileSync(file.endsWith('.wasm') ? join(output, file) : join(goRoot, 'lib/wasm', file)), contentType: file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
  });
  await page.goto('https://host.test/');
  await page.addScriptTag({ url: '/wasm_exec.js' });
  const result = await page.evaluate(async ({ base }) => {
    const module = await WebAssembly.compileStreaming(fetch('/loop.wasm'));
    const decoder = new TextDecoder();
    const compile = async source => {
      const t0 = performance.now();
      let out = '';
      globalThis.fs.writeSync = (fd, buf) => { if (fd === 1) out += decoder.decode(buf); return buf.length; };
      const go = new Go();
      go.argv = ['loop', JSON.stringify({ source })];
      go.exit = () => {};
      await go.run(await WebAssembly.instantiate(module, go.importObject));
      const r = JSON.parse(out);
      return { ...r, wallMillis: performance.now() - t0 };
    };
    const board = document.getElementById('board');
    const cards = {};
    const texts = { a: 'A', b: 'Quarterly revenue', c: 'Churn', d: 'Notes' };
    for (const [id, text] of Object.entries(texts)) {
      const el = cards[id] = document.createElement('div');
      // The outer element gets D2's box; the inner element keeps its natural size (content width capped at 186px) and is what
      // is measured and observed, so applying a size never feeds back into the measurement.
      el.innerHTML = '<span style="display:block;width:max-content;max-width:186px"></span>';
      el.firstChild.textContent = text;
      el.style.cssText = 'position:absolute;box-sizing:border-box;padding:12px 16px;border:1px solid #888;border-radius:8px;font:14px/20px system-ui;background:#fff;overflow:hidden';
      board.append(el);
    }
    const inner = id => cards[id].firstChild;
    const size = id => { const r = inner(id).getBoundingClientRect(); return [Math.ceil(r.width) + 34, Math.ceil(r.height) + 26]; };
    const sourceFor = sizes => base + Object.entries(sizes).map(([id, [w, h]]) => `${id}.width: ${w}\n${id}.height: ${h}\n`).join('');
    const place = layout => {
      for (const [id, b] of Object.entries(layout.nodes)) Object.assign(cards[id].style, { left: b.X + 'px', top: b.Y + 'px', width: b.Width + 'px', height: b.Height + 'px' });
    };
    const overlaps = nodes => { const e = Object.entries(nodes); let n = 0; for (const [i, [, p]] of e.entries()) for (const [, q] of e.slice(i + 1)) if (p.X < q.X + q.Width && q.X < p.X + p.Width && p.Y < q.Y + q.Height && q.Y < p.Y + p.Height) n++; return n; };
    const measureAll = () => Object.fromEntries(Object.keys(cards).map(id => [id, size(id)]));
    // The loop: measure natural sizes, request them, recompile, place; stops when the placed boxes equal the measured sizes.
    const settle = async () => {
      const steps = [];
      let layout;
      for (let i = 0; i < 4; i++) {
        const sizes = measureAll();
        layout = await compile(sourceFor(sizes));
        if (layout.error) return { error: layout.error, steps };
        place(layout);
        const mismatch = Object.entries(layout.nodes).filter(([id, b]) => b.Width !== sizes[id][0] || b.Height !== sizes[id][1]).map(([id]) => id);
        steps.push({ sizes, wallMillis: +layout.wallMillis.toFixed(1), goMillis: layout.millis, mismatch });
        if (!mismatch.length) break;
      }
      return { layout, steps };
    };
    const out = {};
    out.initial = await settle();
    const before = structuredClone(out.initial.layout.nodes);
    // Content growth observed with a ResizeObserver: the card's natural width changes, the observer fires, the loop reruns.
    let observerFires = 0, pendingSince = 0;
    const done = [];
    const ro = new ResizeObserver(() => { observerFires++; pendingSince ||= performance.now(); });
    ro.observe(inner('b'));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    observerFires = 0;
    for (const text of ['Quarterly revenue by region', 'Quarterly revenue by region and product line (EUR)']) {
      observerFires = 0;
      inner('b').textContent = text;
      const t0 = performance.now();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const fired = observerFires;
      const s = await settle();
      const nodes = s.layout?.nodes ?? {};
      done.push({ text: text.length + ' chars', observerFiresBeforeRecompile: fired, stepsToConverge: s.steps.length, totalMillis: +(performance.now() - t0).toFixed(1), widthB: nodes.b?.Width, movedOthers: Object.keys(nodes).filter(id => id !== 'b' && (nodes[id].X !== before[id].X || nodes[id].Y !== before[id].Y)).length, overlaps: overlaps(nodes), error: s.error });
    }
    out.growth = done;
    observerFires = 0;
    await settle();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    out.selfInduced = { observerFiresAfterApplyingSizes: observerFires };
    // Several content changes in one task coalesce into a single observer delivery.
    observerFires = 0;
    for (const t of ['x', 'xx', 'xxx', 'xxxx', 'Quarterly']) inner('b').textContent = t;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    out.coalesced = { changes: 5, observerFires };
    // A long text wraps inside the capped inner element, so the requested height grows with it.
    inner('c').textContent = 'A long churn explanation that wraps onto several lines inside a width capped card';
    const wrapped = await settle();
    out.wrapped = { sizeC: wrapped.layout?.nodes.c && [wrapped.layout.nodes.c.Width, wrapped.layout.nodes.c.Height], steps: wrapped.steps.length, mismatchLastStep: wrapped.steps.at(-1)?.mismatch, overlaps: wrapped.layout ? overlaps(wrapped.layout.nodes) : null };
    return out;
  }, { base });
  writeFileSync(join(output, 'loop.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 1));
  expect(result.initial.steps.map(x => x.mismatch), 'D2 honours every requested card size in one step').toEqual([[]]);
  for (const g of result.growth) { expect(g.observerFiresBeforeRecompile, 'content growth reaches the observer').toBeGreaterThanOrEqual(1); expect(g.stepsToConverge).toBe(1); expect(g.overlaps).toBe(0); expect(g.movedOthers, 'neighbours are re-laid out').toBeGreaterThan(0); }
  expect(result.selfInduced.observerFiresAfterApplyingSizes, 'applying sizes does not retrigger the observer').toBe(0);
  expect(result.coalesced.observerFires, 'five synchronous changes give one delivery').toBe(1);
  expect(result.wrapped.sizeC[1], 'wrapped text asks for a taller node').toBeGreaterThan(46);
});

// Persistent instance: one Go/js-wasm instance serves many compiles through globalThis.d2compile. Compares latency with a fresh
// instance per request, checks results are identical (no state carried between compiles), watches wasm memory, and compares a
// naive queue with a latest-wins scheduler under a burst of requests. A running compile cannot be aborted on the single wasm thread.
test('research: persistent WASM instance, latency, isolation and burst policy', async ({ page }) => {
  test.setTimeout(300_000);
  await page.route('https://host.test/**', route => {
    const file = new URL(route.request().url()).pathname.slice(1);
    if (file === '') return route.fulfill({ body: '<!doctype html><title>loop</title>', contentType: 'text/html' });
    return route.fulfill({ body: readFileSync(file.endsWith('.wasm') ? join(output, file) : join(goRoot, 'lib/wasm', file)), contentType: file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
  });
  await page.goto('https://host.test/');
  await page.addScriptTag({ url: '/wasm_exec.js' });
  const result = await page.evaluate(async ({ base }) => {
    const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
    const sources = [10, 60, 140, 220, 300].map(w => `${base}b.width: ${w}\nb.height: 50\n`);
    const decoder = new TextDecoder();
    const freshModule = await WebAssembly.compileStreaming(fetch('/loop.wasm'));
    const fresh = async source => {
      let out = '';
      globalThis.fs.writeSync = (fd, buf) => { if (fd === 1) out += decoder.decode(buf); return buf.length; };
      const go = new Go();
      go.argv = ['loop', JSON.stringify({ source })];
      go.exit = () => {};
      const t0 = performance.now();
      await go.run(await WebAssembly.instantiate(freshModule, go.importObject));
      return { r: JSON.parse(out), wall: performance.now() - t0 };
    };
    const timeStart = performance.now();
    const servedModule = await WebAssembly.compileStreaming(fetch('/loop-serve.wasm'));
    const go = new Go();
    go.argv = ['loop', '--serve'];
    const instance = await WebAssembly.instantiate(servedModule, go.importObject);
    go.run(instance); // never resolves: the instance stays alive
    while (!globalThis.d2compile) await new Promise(r => setTimeout(r, 5));
    const startup = performance.now() - timeStart;
    const served = async source => { const t0 = performance.now(); const r = JSON.parse(await d2compile(source)); return { r, wall: performance.now() - t0 }; };

    const out = { startupMillis: +startup.toFixed(0) };
    // Fresh versus persistent latency for the same five sources, three rounds each.
    const freshWalls = [], servedWalls = [];
    let identical = true;
    for (let round = 0; round < 3; round++) for (const source of sources) {
      const [f, s] = [await fresh(source), await served(source)];
      freshWalls.push(f.wall); servedWalls.push(s.wall);
      const strip = ({ millis, ...rest }) => JSON.stringify(rest);
      if (strip(f.r) !== strip(s.r)) identical = false;
    }
    out.latency = { freshMedian: +median(freshWalls).toFixed(1), persistentMedian: +median(servedWalls).toFixed(1) };
    out.identicalToFreshInstance = identical;
    // Memory over many compiles.
    const memBefore = instance.exports.mem.buffer.byteLength;
    for (let i = 0; i < 60; i++) await served(sources[i % sources.length]);
    out.memoryMB = { before: +(memBefore / 1e6).toFixed(1), after: +(instance.exports.mem.buffer.byteLength / 1e6).toFixed(1) };
    // An invalid source after valid ones: the instance survives and reports the error.
    const bad = await served('a: {');
    const good = await served(sources[0]);
    out.errorThenOk = { error: !!bad.r.error, nextOk: !good.r.error };
    // Burst: six size changes in one tick. Naive runs all six; latest-wins starts one, then only the newest queued request.
    const burst = [30, 80, 130, 180, 230, 280].map(w => `${base}b.width: ${w}\nb.height: 50\n`);
    let t0 = performance.now();
    const naive = await Promise.all(burst.map(s => served(s)));
    out.naive = { computes: burst.length, finalMillis: +(performance.now() - t0).toFixed(0), finalWidth: naive.at(-1).r.nodes.b.Width };
    let computes = 0, inFlight = false, latest = null, finalResult;
    const request = source => new Promise(resolve => {
      latest?.resolve(null); // a newer request replaces the queued one
      latest = { source, resolve };
      const pump = async () => {
        if (inFlight || !latest) return;
        inFlight = true;
        const job = latest; latest = null;
        computes++;
        const { r } = await served(job.source);
        inFlight = false;
        if (latest) { job.resolve(null); pump(); } else { finalResult = r; job.resolve(r); }
      };
      pump();
    });
    t0 = performance.now();
    const settled = await Promise.all(burst.map(s => request(s)));
    out.latestWins = { computes, finalMillis: +(performance.now() - t0).toFixed(0), finalWidth: finalResult.nodes.b.Width, droppedStale: settled.filter(r => r === null).length };
    return out;
  }, { base });
  writeFileSync(join(output, 'persistent.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 1));
  expect(result.identicalToFreshInstance, 'no state leaks between compiles').toBe(true);
  expect(result.errorThenOk).toEqual({ error: true, nextOk: true });
  expect(result.latency.persistentMedian).toBeLessThan(result.latency.freshMedian);
  expect(result.latestWins.finalWidth).toBe(280);
  expect(result.latestWins.computes).toBeLessThan(result.naive.computes);
});

// Larger boards on the persistent instance: synthetic trees with extra cross edges. Records first and repeat compile time (one
// node resized, the loop's common case), moved nodes, memory and whether the main page stays responsive while TALA runs.
test('research: persistent instance on larger boards', async ({ page }) => {
  test.setTimeout(600_000);
  await page.route('https://host.test/**', route => {
    const file = new URL(route.request().url()).pathname.slice(1);
    if (file === '') return route.fulfill({ body: '<!doctype html><title>loop</title>', contentType: 'text/html' });
    return route.fulfill({ body: readFileSync(file.endsWith('.wasm') ? join(output, file) : join(goRoot, 'lib/wasm', file)), contentType: file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
  });
  page.on('console', m => console.log('page:', m.text()));
  await page.goto('https://host.test/');
  await page.addScriptTag({ url: '/wasm_exec.js' });
  const result = await page.evaluate(async sizes => {
    const module = await WebAssembly.compileStreaming(fetch('/loop-serve.wasm'));
    const go = new Go();
    go.argv = ['loop', '--serve'];
    const instance = await WebAssembly.instantiate(module, go.importObject);
    go.run(instance);
    while (!globalThis.d2compile) await new Promise(r => setTimeout(r, 5));
    // Tree with fanout 3, one cross edge per five nodes; every node has an explicit size like a measured card.
    const board = (n, resized = 0) => {
      const lines = ['direction: right'];
      for (let i = 0; i < n; i++) lines.push(`n${i}.label: ""`, `n${i}.width: ${i === 0 ? 60 + resized : 80}`, `n${i}.height: 40`);
      for (let i = 1; i < n; i++) lines.push(`n${Math.floor((i - 1) / 3)} -> n${i}`);
      for (let i = 5; i < n; i += 5) lines.push(`n${i} -> n${(i * 7) % i}`);
      return lines.join('\n') + '\n';
    };
    const compile = async source => {
      // A timer ticking on the page shows whether the main thread is blocked while the wasm thread (the same thread) computes.
      let ticks = 0, longest = 0, last = performance.now();
      const timer = setInterval(() => { const now = performance.now(); longest = Math.max(longest, now - last); last = now; ticks++; }, 10);
      const t0 = performance.now();
      const r = JSON.parse(await d2compile(source));
      clearInterval(timer);
      return { r, wall: performance.now() - t0, ticks, longestGap: longest };
    };
    const out = [];
    for (const n of sizes) {
      console.log('start', n);
      const first = await compile(board(n));
      console.log('first', n, Math.round(first.wall));
      if (first.r.error) { out.push({ n, error: first.r.error }); continue; }
      const second = await compile(board(n, 20));
      const a = first.r.nodes, b = second.r.nodes;
      out.push({
        n, edges: first.r.edges.length, firstMillis: +first.wall.toFixed(0), goMillis: first.r.millis, repeatMillis: +second.wall.toFixed(0),
        timerTicksDuringCompile: first.ticks + second.ticks, // 0: the page's main thread is blocked for the whole compile
        resizedWidth: b.n0.Width, moved: Object.keys(a).filter(id => id !== 'n0' && (a[id].X !== b[id].X || a[id].Y !== b[id].Y)).length,
        memoryMB: +(instance.exports.mem.buffer.byteLength / 1e6).toFixed(0),
      });
    }
    return out;
  }, (process.env.D2_LARGE_SIZES ?? '25,50,100').split(',').map(Number));
  writeFileSync(join(output, 'large.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  for (const r of result) { expect(r.error, `n=${r.n}`).toBeUndefined(); expect(r.resizedWidth).toBe(80); expect(r.timerTicksDuringCompile, 'wasm on the main thread blocks it').toBe(0); }
});

// Web Worker: the persistent instance runs in a dedicated worker so the page stays responsive. Records startup, message
// overhead, main-thread ticks during a 50-node compile, and two ways to handle a superseded in-flight compile: wait for it, or
// terminate the worker and start a fresh one (the only real abort on a single wasm thread).
const workerSource = `
importScripts('/wasm_exec.js');
(async () => {
  const module = await WebAssembly.compileStreaming(fetch('/loop-serve.wasm'));
  const go = new Go();
  go.argv = ['loop', '--serve'];
  go.run(await WebAssembly.instantiate(module, go.importObject));
  while (!self.d2compile) await new Promise(r => setTimeout(r, 2));
  postMessage({ ready: true });
  onmessage = async e => postMessage({ id: e.data.id, result: await d2compile(e.data.source) });
})();`;

test('research: sizing loop in a Web Worker keeps the page responsive', async ({ page }) => {
  test.setTimeout(300_000);
  await page.route('https://host.test/**', route => {
    const file = new URL(route.request().url()).pathname.slice(1);
    if (file === '') return route.fulfill({ body: '<!doctype html><title>loop</title>', contentType: 'text/html' });
    if (file === 'worker.js') return route.fulfill({ body: workerSource, contentType: 'text/javascript' });
    return route.fulfill({ body: readFileSync(file.endsWith('.wasm') ? join(output, file) : join(goRoot, 'lib/wasm', file)), contentType: file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
  });
  await page.goto('https://host.test/');
  const result = await page.evaluate(async () => {
    const board = (n, w = 60) => {
      const l = ['direction: right'];
      for (let i = 0; i < n; i++) l.push(`n${i}.label: ""`, `n${i}.width: ${i ? 80 : w}`, `n${i}.height: 40`);
      for (let i = 1; i < n; i++) l.push(`n${Math.floor((i - 1) / 3)} -> n${i}`);
      for (let i = 5; i < n; i += 5) l.push(`n${i} -> n${(i * 7) % i}`);
      return l.join('\n') + '\n';
    };
    let worker, nextId = 0;
    const pending = new Map();
    const spawn = () => new Promise(resolve => {
      const t0 = performance.now();
      worker = new Worker('/worker.js');
      worker.onmessage = e => {
        if (e.data.ready) return resolve(performance.now() - t0);
        pending.get(e.data.id)?.(JSON.parse(e.data.result));
        pending.delete(e.data.id);
      };
    });
    const compile = source => new Promise(resolve => { const id = ++nextId; pending.set(id, resolve); worker.postMessage({ id, source }); });
    const out = { startupMillis: +(await spawn()).toFixed(0) };
    // Message overhead on a tiny board against the in-page persistent figure (4.5 ms).
    const small = [];
    for (let i = 0; i < 10; i++) { const t0 = performance.now(); await compile(board(4, 60 + i)); small.push(performance.now() - t0); }
    out.smallBoardMedianMillis = +small.sort((a, b) => a - b)[5].toFixed(1);
    // Main-thread responsiveness during a 50-node compile.
    let ticks = 0, longest = 0, last = performance.now();
    const timer = setInterval(() => { const now = performance.now(); longest = Math.max(longest, now - last); last = now; ticks++; }, 10);
    const t0 = performance.now();
    const r = await compile(board(50));
    clearInterval(timer);
    out.mainThreadDuring50NodeCompile = { compileMillis: +(performance.now() - t0).toFixed(0), timerTicks: ticks, longestGapMs: +longest.toFixed(0), error: r.error };
    // Superseded in-flight compile: request A (50 nodes) is followed 200 ms later by request B (50 nodes, new width).
    const racing = async strategy => {
      const start = performance.now();
      const a = compile(board(50, 61));
      await new Promise(r => setTimeout(r, 200));
      let computes = 1, final;
      if (strategy === 'wait') {
        await a; computes++;
        final = await compile(board(50, 62));
      } else {
        worker.terminate();
        pending.clear();
        await spawn();
        computes++;
        final = await compile(board(50, 62));
      }
      return { strategy, computes, timeToFinalMillis: +(performance.now() - start).toFixed(0), finalWidth: final.nodes.n0.Width };
    };
    out.supersede = [await racing('wait'), await racing('terminate')];
    worker.terminate();
    return out;
  });
  writeFileSync(join(output, 'worker.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 1));
  expect(result.mainThreadDuring50NodeCompile.error).toBeUndefined();
  expect(result.mainThreadDuring50NodeCompile.timerTicks, 'the page keeps ticking while TALA runs in the worker').toBeGreaterThan(50);
  expect(result.mainThreadDuring50NodeCompile.longestGapMs).toBeLessThan(200);
  for (const s of result.supersede) expect(s.finalWidth).toBe(62);
});

// Other layout engines on the persistent instance: dagre and ELK run in an embedded JS runtime inside the wasm. Same synthetic
// boards as the larger-board test, with sizes TALA cannot reach interactively.
test('research: dagre and ELK on larger boards in Chromium WASM', async ({ page }) => {
  test.setTimeout(300_000);
  await page.route('https://host.test/**', route => {
    const file = new URL(route.request().url()).pathname.slice(1);
    if (file === '') return route.fulfill({ body: '<!doctype html><title>loop</title>', contentType: 'text/html' });
    return route.fulfill({ body: readFileSync(file.endsWith('.wasm') ? join(output, file) : join(goRoot, 'lib/wasm', file)), contentType: file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
  });
  await page.goto('https://host.test/');
  await page.addScriptTag({ url: '/wasm_exec.js' });
  const result = await page.evaluate(async sizes => {
    const module = await WebAssembly.compileStreaming(fetch('/loop-serve.wasm'));
    const go = new Go();
    go.argv = ['loop', '--serve'];
    go.run(await WebAssembly.instantiate(module, go.importObject));
    while (!globalThis.d2compile) await new Promise(r => setTimeout(r, 5));
    const board = (n, w = 60) => {
      const l = ['direction: right'];
      for (let i = 0; i < n; i++) l.push(`n${i}.label: ""`, `n${i}.width: ${i ? 80 : w}`, `n${i}.height: 40`);
      for (let i = 1; i < n; i++) l.push(`n${Math.floor((i - 1) / 3)} -> n${i}`);
      for (let i = 5; i < n; i += 5) l.push(`n${i} -> n${(i * 7) % i}`);
      return l.join('\n') + '\n';
    };
    const out = [];
    for (const engine of ['dagre', 'elk']) for (const n of sizes) {
      const run = async w => { const t0 = performance.now(); const r = JSON.parse(await d2compile(board(n, w), engine)); return { r, ms: Math.round(performance.now() - t0) }; };
      const first = await run(60), repeat = await run(90);
      out.push({ engine, n, error: first.r.error ?? repeat.r.error, firstMillis: first.ms, repeatMillis: repeat.ms, nodes: Object.keys(first.r.nodes).length, widthHonoured: repeat.r.nodes?.n0?.Width === 90, routed: first.r.edges.filter(e => e.route.length > 1).length });
    }
    return out;
  }, [25, 100, 250, 500, 1000]);
  writeFileSync(join(output, 'engines.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  for (const r of result) { expect(r.error, `${r.engine} ${r.n}`).toBeUndefined(); expect(r.widthHonoured).toBe(true); }
});
