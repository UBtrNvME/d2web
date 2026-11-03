# Spec 0003: packaging and distribution (build artifacts only)

Status: **accepted with the recommended answers to questions 2-4** (user said "continue working", 31 October 2026); question 1 answered: `d2web` (npm registry returned 404 on 31 October 2026, so it is unregistered; not reserved until published); question 5 answered: d2web is MPL-2.0, the licence of the D2 code embedded in the wasm, so one licence covers the package (user: "use license which we can use"). This is not legal advice. Builds on [spec 0001](0001-compile-protocol.md), [spec 0002](0002-mount-api.md), [ADR 0003](../adr/0003-runtime-shape.md) (worker-hosted wasm), [ADR 0006](../adr/0006-font-delivery.md) and [ADR 0008](../adr/0008-repository-layout.md) (patched builds are explicit). Scope: how a consumer gets the worker, the wasm and the TypeScript package. **Publishing to a registry is out of scope**: this spec produces and tests the artifacts; releasing them is the user's separate decision.
Delivered: delivered, except publishing to a registry (out of scope by this spec). A spec is a short-lived brief: it must end `delivered` (or be marked not delivered); an agent that finds it otherwise tells the user. (Audited 4 November 2026.)

## 1. Measurements (31 October 2026, Go 1.27.3, D2 v0.9.0, darwin/arm64)

| Artifact | Size | Notes |
| --- | --- | --- |
| `d2web.wasm`, default build | 53.9 MB raw, 13.8 MB gzip -9 | current test build |
| `d2web.wasm`, `-trimpath -ldflags "-s -w"` | 52.7 MB raw, 13.6 MB gzip -9 | proposed release build |
| Same without the dagre and ELK engines | 45.9 MB raw, 12.0 MB gzip -9 | engines cost 1.6 MB gzip; not worth a split in v1 |
| `index.js` (client, mount, painter, minified ESM) | 20.8 KB, 8.3 KB gzip | |
| `wasm_exec.js` (Go runtime shim, BSD) | 17 KB | |

Brotli was not measured (no encoder on this machine). Most of the wasm is Go runtime, TALA, fonts and text tooling, not the engines. Consumers pay the wasm once per browser cache lifetime; it is the dominant cost of the library.

## 2. Package contents

One npm package `d2web` (name is a proposal, open question 1), ESM only, built by `mise run build` into `packages/d2web/dist/`:

```
dist/index.js        client, mount, request normalizer, painter (ESM, minified)
dist/index.d.ts      types (declaration-only tsc output; the painter ships a hand-written .d.ts)
dist/worker.js       classic worker script
dist/wasm_exec.js    Go's runtime shim, unmodified
dist/d2web.wasm      the worker's Go build
dist/NOTICE.txt      third-party notices (section 7)
```
`package.json` exports `.` (index) and the asset files by path (`./worker.js`, `./d2web.wasm`, `./wasm_exec.js`) so bundlers and plain `import.meta.resolve` can find them. `sideEffects: false`.

## 3. Hosting and URLs

The consumer hosts the assets; the library never fetches from a third party.
- `createClient` still takes a `spawn` function (spec 0001). New helper `spawnWorker(options?)` returns one: by default the worker URL is `new URL('./worker.js', import.meta.url)`, which Vite, webpack 5 and native ESM resolve to the hosted file. `options.worker`, `options.exec`, `options.wasm` override any URL (a CDN the consumer approves).
- The worker defaults `exec` and `wasm` to `wasm_exec.js` and `d2web.wasm` next to itself; the query parameters used by the tests remain as overrides.
- `WebAssembly.compileStreaming` needs `Content-Type: application/wasm`; the worker falls back to `arrayBuffer()` compilation when the type is wrong, so a misconfigured host is slower, not broken.
- A worker script must be same-origin with the page. Cross-origin hosting needs a consumer-provided blob wrapper and is not supported by `spawnWorker` in v1.
- Content-Security-Policy needs `worker-src` for the worker and `'wasm-unsafe-eval'` in `script-src` for the worker's WebAssembly compilation.

## 4. Versions and compatibility

The worker's `ready` message already reports `v`, `d2` and `sceneVersion` (spec 0001 section 3.1). The client rejects a worker whose `v` differs from its own `PROTOCOL_VERSION` or whose `sceneVersion` it does not know, with `VersionError` (a mismatched js/wasm pair is the usual symptom of a stale cached wasm). `ready` also gains `patched: boolean`, true when the wasm was built from a D2 checkout with `docs/upstream` patches applied (ADR 0008).

## 5. Build rules

- `mise run build` refuses to build when `imports/d2` is not the pinned commit (existing `reference:fetch` check) and refuses a patched checkout unless `D2WEB_ALLOW_PATCHED=1`.
- The wasm is built with `-trimpath -ldflags "-s -w"` and `GOFLAGS=-mod=readonly`. Reproducibility across machines (identical bytes) is a goal that is **not verified**; section 8 lists it.
- `mise run build` is part of `check:browser`'s prerequisites (the Chromium tests consume `dist/`, not source), not of fast `check`.

## 6. Size budget

A test fails when `d2web.wasm` exceeds 15 MB gzipped (current 13.6 MB) or `index.js` exceeds 40 KB gzipped (current 8.3 KB), so growth is a deliberate decision (open question 2).

## 7. Notices

D2 is MPL-2.0 (Terrastruct); the wasm embeds its fonts (OFL, see D2's `d2fonts/NOTICE.txt`), the Go runtime shim is BSD-3. `NOTICE.txt` is generated from those files at build time and ships in the package. Whether and how d2web itself is licensed, and what MPL-2.0 requires of a distributed wasm built from a patched D2, is a decision and a legal question for the user; this spec only ships the notices D2 already provides. Not legal advice.

## 8. Verified, proposed, unknown

| Claim | State | Evidence |
| --- | --- | --- |
| Sizes in section 1 | measured | this spec |
| The tests' worker loads wasm and runs in Chromium from query-parameter URLs | verified | `test:client` |
| `dist/` build, exports map, `spawnWorker`, wasm MIME fallback | built | `build.mjs`, `test:dist`, `client.ts`, `worker.js` |
| Version mismatch rejected, `patched` reported | built | `VersionError` in `client.ts` | |
| Packed tarball installs and runs in a consumer page under native ESM; under a restrictive CSP | built | `test:consumer` | |
| Vite, webpack, Next.js consumers | unknown | |
| Cross-origin hosting, service-worker caching, brotli size | unknown | |
| Byte-identical wasm across machines | unknown | |
| Firefox | works; WebKit works in Playwright, real Safari unverified (docs/browser-support.md) | |

## 9. Open questions for the user

1. Package name: `d2web`? (An unscoped name may be taken on npm; a scope such as `@yourorg/d2web` is a registry decision.)
2. Size budget: 15 MB gzip for the wasm and 40 KB gzip for `index.js` as the failing thresholds?
3. Keep a single wasm with all three engines in v1 (recommended), or split TALA-only (saves 1.6 MB gzip)?
4. Same-origin hosting only in v1 (recommended), or also a blob-wrapper for cross-origin CDNs?
5. Licensing: who decides d2web's own license and the MPL-2.0 handling for the shipped wasm, and when? (Needed before any publish, not before this slice.)
