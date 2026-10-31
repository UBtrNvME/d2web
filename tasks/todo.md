# D2 web research: open work

Only what is still to do. Evidence and results are in [research findings](../docs/research-findings.md); status per pipeline family is in the [capability matrix](../docs/capability-matrix.md); hypotheses and method are in [plan.md](plan.md). Nothing here is accepted architecture. Direction already chosen by the user: native HTML/JS/CSS/SVG foundation, D2/WASM owns compile/layout/theme, combined boundary (scene-led paint plus a thin association layer keyed by revision, board path and ID).

## Decisions waiting on the user

- [x] Checkpoint A, reviewed 31 October 2026. Surviving: combined boundary only (scene-first and semantic-first dropped); HTML-first painter with CSS masks is the topology R3/R6 probe; fidelity bar stays 5% raster difference from native plus visible recorded failures; fonts are explicit consumer-approved assets only, with no fallback fetching and misses reported. Research choices, not accepted architecture; Checkpoint B and R5 remain open.
- [x] Checkpoint B, answered 31 October 2026: Option 1. Combined boundary, HTML-first paint with SVG fallback inside a shadow root with an `all:initial` wrapper and per-mount ID prefixes. Disqualifiers to watch: a large browser-only fidelity failure, or association keys failing on multi-board imports. Next gaps: R4 edits in Chromium (multi-board, imported-file rewrites) and the R6 measured-card recompile loop with a real shadcn consumer. Whether to close the remaining R3 gaps (same-scene double mount, links/focus under isolation, other browsers) before R5 was not answered; default is to defer them into R5 as stated open gaps.
- [x] R5 decisions (user, 31 October 2026): ADRs 0003 runtime shape, 0004 edit wrapper and patches, 0005 layout engine policy, 0006 font delivery accepted, including consumer edge labels via transparent placeholders. Product implementation still needs the public contracts each ADR lists as unresolved (message protocol, packaging of worker and wasm, other browsers, edit undo/stale handling, font mismatch reporting, engine quality comparison).
- [x] Contract-coverage census done from existing corpus data (see capability matrix row 6): every shape and structured layout is in the corpus and compiles to the same five scene primitives; no payload gap found. Single caveat carried into the spec: compile-resolved render options (theme, dark theme, sketch) must be part of the request/result.
- [x] Product scope v1 accepted 31 October 2026: ADR 0007 and [product.md](../docs/product.md).
- [x] First contract drafted: [spec 0001](../docs/specs/0001-compile-protocol.md) (proposed; its three open questions were answered 31 October 2026, see its section 8). Render options test: `test:research:options`.
- [x] Spec 0001 accepted by the user, 31 October 2026.
- [x] Slice 1 complete (31 October 2026), see below.
- [ ] Slice 4 chosen: association (user, 31 October 2026), [spec 0004](../docs/specs/0004-association.md) drafted and waiting for acceptance; plan in tasks/todo.md.
- [x] Slice 3 chosen: packaging (user, 31 October 2026), built; spec 0003 accepted.
- [x] Slice 2 chosen: mount API (user, 31 October 2026), plan below. Spec 0002 accepted.

## Slice 1: compile protocol, render only (spec 0001)

Product code, not research. Each step ends with a passing test in `check` (or `check:browser` when it needs Chromium). Types already exist in [src/protocol.ts](../src/protocol.ts).

- [x] 1. Request validation (done 31 October 2026: `packages/d2web/src/request.ts`, `packages/d2web/tests/request.test.mjs`, run by `test:unit`; budget defaults are placeholders from the probes, root board is the empty path): reject a malformed `compile` (missing entry, unknown engine, non-numeric budget), apply budget and board defaults, echo the options used. Unit tests, no wasm.
- [x] 2. Scene encoder (done 31 October 2026): `packages/d2web-wasm/scenejson`, closed type set (an unlisted type is an error; snapshot test pins the set), font bytes returned beside the JSON instead of inside it, `Version = 1`. `test:wasm` (in `check`) encodes every board of the 82 `.d2` files under examples/files and examples/boards; archive cases (txtar) are not in this test. It keeps the research field names, so the painter in step 5 reads it unchanged; it is still reflection-based underneath, with the allow list as the contract. The compile+build pipeline sits in the test file and moves into the worker package in step 3.
- [x] 3. (done 31 October 2026: `packages/d2web-wasm/compile` + `cmd/d2web`, tests in `packages/d2web-wasm/tests/protocol.test.mjs` run by `test:wasm`; native and Node/WASM agree for tala, sketch, dark theme id, dagre, elk and all boards; gaps: `association` is null, images in the virtual filesystem are unreadable (remote and local images become placeholders), budget errors are matched by message because D2 has no typed error, SVG import limits are fixed, fonts travel as base64 beside the scenes, browser worker not yet exercised) Go wasm entry serving `compile` per spec: `ready`, `result`, typed errors, no partial boards, `available` board list, budget errors. Acceptance: native and Node/WASM give identical results for the corpus.
- [x] 4. Host client (done 31 October 2026): `packages/d2web/src/client.ts` (latest-wins, stale results dropped as `SupersededError`, abort by terminate and respawn once a running compile is older than `supersedeAfterMs`, `TimeoutError` after `silentTimeoutMs` counted from posting plus a separate startup timeout), `packages/d2web/src/worker.js`; unit tests with scripted workers (`test:unit`) and `test:client` in Chromium with the real wasm (in `check:browser`). The browser run found a real bug: `imageasset` needs an explicit BaseDir because `os.Getwd` is not implemented on js; fixed in `compile.go`. Not yet covered: worker packaging/URLs, other browsers.
- [x] 5. Painter (done 31 October 2026): `tests/scene-paint.mjs` moved unchanged to `packages/d2web/src/paint.js`; `packages/d2web-wasm/tests/equivalence.test.mjs` (in `test:wasm`) shows the product worker's scene deep-equals the census scene for 7 single-file image-free cases, so the census thresholds carry over; `test:research:census` passes with the moved painter.
- [x] 6. End to end (done 31 October 2026): `packages/d2web/tests/browser/e2e.spec.mjs` (`test:client`, in `check:browser`): source to client to worker to wasm to scene plus fonts to painter to pixels, light (theme 0) and dark (theme 200) as two requests, each compared with native D2 for the same theme: 0.41% and 0.25% of pixels differ (bar 5%), dark differs from light. One small image-free board only; the corpus-wide figure remains the census (139 of 145 within 5%).

## Slice 2: mount API (spec 0002, approved plan 31 October 2026)

Each step ends with a passing test and its own commit; browser steps run in `check:browser`, everything else in `check`.

- [x] 1. Spec 0002 accepted by the user, 31 October 2026 ([spec 0002](../docs/specs/0002-mount-api.md)); its three questions answered as recommended.
- [x] 2. Mount and dispose (done 31 October 2026: `packages/d2web/src/mount.ts`, `packages/d2web/src/index.ts`, specs `packages/d2web/tests/browser/mount.spec.mjs` via the shared `harness.mjs`; verified in Chromium with the real client/worker/wasm: no traces after mount or dispose, remount with a fixed prefix reproduces markup, a live mount cannot be mounted over, two mounts of one scene have disjoint IDs and match a clean baseline pixel for pixel under hostile page CSS, a hidden host stays hidden).
- [x] 3. Update (done 31 October 2026, same commit as step 2: errored result, unknown board, null Root and unknown primitive each throw `MountError` and leave the previous DOM untouched; `nodeBox` exact for rect/ellipse, control-point bounds for path shapes like the cylinder). Spec 0002 amended: `update` is async because fonts must load before baselines are measured.
- [x] 4. Events (done 31 October 2026: `packages/d2web/tests/browser/events.spec.mjs`; click, dblclick, contextmenu, hover and focus carry board and object ID for nodes and connections; hover fires on entering/leaving an object, not between its parts; Tab walks objects in paint order and accessibility names are present; links are focusable and hit-testable under the shadow root. Found and handled: a link region is an anchor outside the object groups with no object ID, so clicks/hover on a linked node resolve to the smallest object containing the region's centre; focus is reported only for the object's own group).
- [x] 5. Consumer content (done 31 October 2026: `packages/d2web/tests/browser/content.spec.mjs`; `setNodeContent` changes nothing outside the node (0 differing pixels outside a margin), the consumer's button works and the click is also reported for its node, restore is byte-identical, content persists across updates with `orphaned` reported and revived when the node returns, and the size handshake (measured card, `a.width/height` in source, recompile, update) makes the node box and the holder equal the measured size).
- [x] 6. Fonts and end to end (done 31 October 2026: `packages/d2web/tests/browser/fonts.spec.mjs`; families registered once and shared by two mounts, kept until the last dispose, `fonts: 'consumer'` registers nothing; client plus mount, light and dark as two requests, within the 5% bar of native D2). Two mounts under hostile CSS are in `mount.spec.mjs`. Slice 2 complete.

Notes for later slices (not in this plan): association payload over the worker, images in the virtual filesystem, packaging of worker and wasm, animation painting, other browsers, v2 editing contract.

## Slice 3: packaging (spec 0003, plan 31 October 2026)

Chosen by the user. Spec 0003 was built after the user answered "continue working" to the drafted spec and its recommendations (31 October 2026); read that as acceptance of the recommended answers 2-4 and the name `d2web` as provisional. Questions 1 and 5 answered 31 October 2026: name `d2web` (unregistered on npm), licence MPL-2.0. Publishing itself is still the user's call. Artifacts and tests only: no registry publish, no licence choice (those are the user's, see the spec's questions 1 and 5).

- [x] 1. Spec 0003 taken as accepted with recommendations (see above) by the user ([spec 0003](../docs/specs/0003-packaging.md); five open questions at its end).
- [x] 2. (done 31 October 2026: `packages/d2web/build.mjs`, `mise run build`, ~2 s warm; `dist/` has index.js 21 KB, per-file .d.ts, worker.js, wasm_exec.js, d2web.wasm 52.7 MB, NOTICE.txt from D2 LICENSE, THIRD_PARTY_NOTICES and Go LICENSE; `compile.Patched` set by -ldflags -X) Build: `mise run build` produces `packages/d2web/dist/` (index.js ESM, index.d.ts, worker.js, wasm_exec.js, d2web.wasm, NOTICE.txt) with the release flags; refuses an unpinned or patched D2 checkout; `package.json` exports and `files`. `ready` gains `patched`.
- [x] 3. (done 31 October 2026: `VersionError` tested in `client.test.mjs`; `spawnWorker` and the worker's MIME fallback are exercised by `test:consumer`) Worker and client: worker defaults next to itself and falls back from `compileStreaming`; `spawnWorker`; client rejects a mismatched protocol or scene version with `VersionError`.
- [x] 4. (done: `packages/d2web/tests/dist.test.mjs`, task `test:dist`) Size budget test (15 MB gzip wasm, 40 KB gzip index.js unless the user changes them).
- [x] 5. (done 31 October 2026: 3 of 3 pass, 7 s; `packages/d2web/tests/browser/consumer.spec.mjs`, task `test:consumer`; see ledger) Consumer test: `pnpm pack` the package, install the tarball in a temporary consumer, load it in Chromium with native ESM and no bundler, then again under a restrictive CSP; compile and mount a board.
- [x] 6. (done: README "Using the built package") Consumer docs in the README (hosting, MIME type, CSP, same-origin worker, sizes) and the ledger.

## Slice 4: association (spec 0004, plan 31 October 2026)

Chosen by the user. Spec 0004 is a draft; nothing is built before it is accepted. Read-only: no identity across edits, no editing (v2).

- [x] 1. Spec 0004 accepted by the user, 31 October 2026, with the recommended answers to its four questions ([spec 0004](../docs/specs/0004-association.md)).
- [x] 2. (done 31 October 2026: `packages/d2web-wasm/compile/association.go`, `packages/d2web-wasm/tests/association.test.mjs` in `test:wasm`; found that D2's UTF-16 mode puts the UTF-16 offset in `Byte`, so the position field is `offset` and diagnostics ranges changed from bytes to UTF-16 offsets; properties still to come in step 4) Worker payload: `compile` builds `association` per board (objects, kind, parent, label, content role, src/dst, references, explicit scene `nodes`) from the d2graph and scene build; types in `protocol.ts`; test in `packages/d2web-wasm/tests` that native and Node/WASM payloads are equal over `examples/research/{identity,imports,boards}` and that malformed input still returns no partial boards.
- [x] 3. (done 31 October 2026: 100 boards, 0 unowned, no node with two owners; anonymous nodes belong to their nearest named ancestor; multi-file archives not in this test) Scene-node ownership: every scene node except `root`, `root:background` belongs to exactly one object over the example corpus (the join probe's prefix rule becomes a tested worker output); any exception is listed, not hidden.
- [x] 4. (done 31 October 2026: `properties` by reflection over D2's Style keywords plus label; size 9.3% of the scene over 100 corpus boards, budget 15%; a held-nothing default is absent rather than null) Property sources: `properties` with owning declaration (class, glob, import, scenario override) and `source: null` for defaults; tests reuse the R1 cases (class fill, glob stroke, imported label, scenario override); payload size measured over the corpus and a budget recorded in spec 0004.
- [ ] 5. Client helpers `getObject`, `objectsAt` (pure functions, unit tests in `test:unit`, incl. overlapping declarations and multi-file ranges).
- [ ] 6. End to end in Chromium: click a node in a mounted board, join the event ID with `getObject`, and the source text at the returned range is the declaration; light and dark requests give the same association. README and ledger.

## Painting and presentation (R2)

- [x] HTML text selection fixed with a trailing newline per label; copy order is paint order, not semantic order.
- [x] Accessibility grouping per D2 object: named focusable groups from scene IDs, pixel-identical, Tab order = paint order (`test:research:a11y`).
- [ ] Accessibility, remaining: screen readers, find-in-page, tooltips, nesting (containers are flat siblings in the scene), names for unlabeled connections and markdown/table content (an SVG `img` with no name or a run-together name), focus ring styling, arrow-key navigation policy.
- [ ] Trace the HTML-only edge differences (pixel snapping of fractional borders; geometry 3.9%, jupyter_aws_eks 2.5%).
- [ ] Remaining text: fallback fonts across the corpus (WASM resolves none; large bytes), bidi/RTL, bold/italic fallback, the 3% of runs that miss D2's advances, decoration, markdown/code as DOM structure, LaTeX vector in the browser.
- [ ] Images and animation: not comparable yet (native SVG links files, scene embeds); animation not painted; dark theme not covered; non-root boards not painted.
- [ ] Filters and blend as CSS, other browsers, hit-testing under masks, performance with 600+ masks on one page.
- [ ] Replace the reflection-based scene dump with a designed bridge; it must carry compile-resolved render options (theme overrides and sketch were silently dropped once).

## Host lifecycle (R3)

- [x] Two mounts, hostile CSS, ID collisions, effects, update/failure/dispose/remount recorded for Chromium (`test:research:lifecycle`).
- [x] Inheritance reset: shadow root plus an inner `all:initial;display:block;visibility:inherit` wrapper paints identically (0 differing pixels, two board pairs) under hostile page CSS; a `:host{all:initial}` rule does not work because outer page rules on the host win, and plain `all:initial` also resets `visibility` (a consumer hiding the host breaks).
- [ ] Remaining R3: same-scene double mount (ID prefixing is the proven mechanism), links/focus/events under isolation, other browsers.
- [x] Painter input validation: null Root, missing ViewBox and null children now throw (`test:research:lifecycle`); the full designed bridge validation is still open.

## Native edit round trip (R4)

- [x] Copy-on-write wrapper, rejected edits, authored index renumbering and imported-edge override are covered (`test:research:transaction`).
- [x] Multi-board edits (layer, scenario), imported-file edits and Chromium execution: 17 requests give identical results in native, Node/WASM and Chromium WASM, including the recovered oracle panic (`test:research:transaction`).
- [ ] Remaining R4: report the `d2oracle.Delete` glob-index panic upstream (drafted text, repro and one-line patch are in docs/upstream; not posted), edits that must truly rewrite an imported file (the oracle only writes local overrides), edits inside imported boards (refused as not found), undo/stale requests, UTF-16 ranges after editing. Isolated: renaming an edge endpoint inside a layer/scenario is refused by the oracle (`GetWriteableRefs` ignores references inside edge keys); the variant with an authored index reference fails later at recompile, cause not isolated.
- [x] Oracle fixes are carried as a patch set (user, 31 October 2026): `docs/upstream/*.patch`, applied to the pinned checkout only on request (`mise run reference:patch`, `reference:unpatch`); pristine is the default so `check` keeps demonstrating the bugs, and the transaction test asserts whichever state it finds. The native TALA binary is not affected. Forking stays a fallback if upstream ignores the reports or the set grows.
- [x] Patch set holds two patches: glob-index delete and in-board rename of edge endpoints (`d2oracle-board-rename-edge-endpoints.patch`; `go test ./d2oracle/` passes with both applied; the transaction test passes pristine and patched).
- [ ] Patch set, open: renaming inside a layer that has an authored index reference still fails at recompile (second bug, unisolated); other `GetWriteableRefs` callers unreviewed; nothing posted upstream.

## External consumer (R6)

- [x] Replacing painted node content in the HTML-first output, surroundings unchanged, return to the faithful default (`test:research:content`); no node sits inside a masked group in the corpus.
- [x] Size handshake by native recompile for several sizes, rejection modes and layout side effects (`test:research:handshake`).
- [x] Measured DOM card to recompile loop in Chromium WASM (`test:research:loop`): one step to convergence, no self-induced observer fires, coalesced observer deliveries, neighbours re-laid out, no overlaps; latency recorded in findings.
- [x] Persistent browser-WASM instance (`test:research:loop`, second test): one instance serves many compiles through a Promise-returning global; results are identical to fresh instances, errors do not poison it, a burst of six requests collapses to two computes under latest-wins. Real boards and abort remain open.
- [x] Larger boards on the persistent instance: TALA cost grows steeply (25 nodes 0.5 s, 50 nodes 2.7 s, 100 nodes 18-24 s, 150 nodes 55-70 s in Chromium WASM) and the page's main thread is blocked throughout; native is 5-6x faster with the same growth. Interactive sizing loops above roughly 50 nodes still need a faster path (other layout engine, partial relayout, or coarser measurement); corpus-shaped boards are untested.
- [x] Web Worker for the sizing loop (`test:research:loop`, fourth test): page stays responsive during a 50-node compile (275 timer ticks, longest gap 12 ms), message overhead is about 1 ms, superseded compiles can be aborted by terminating and respawning the worker (3.6 s to final against 6.2 s waiting). Compile time itself is unchanged, so 100+ node boards still take 20+ s.
- [x] Faster layout engines: dagre and ELK in the same wasm compile 500 nodes in 0.3-1.4 s and 1000 nodes in 1.0-5.6 s, against TALA's 20-60 s at 100-150 nodes (`test:research:loop`, engines test). They are different layouts from TALA, so a board's look changes with the engine; nothing here says when a consumer should switch.
- [x] Containers and labels (native probe, `layout` argument): a container's own `width`/`height` is ignored by dagre, partly honoured by TALA (width 500 honoured, height grown to 318 rather than 300); a sized child grows its container; a sized node with a longer label keeps the requested size; edge label size is not requestable.
- [x] Real shadcn Card consumer (`test:research:shadcn`, Card read from the imported Studio, Tailwind 4 with consumer tokens): see findings. Opt-in, not in `check`, because it needs the ignored Studio checkout and its installed dependencies.
- [ ] Remaining R6: dark/other theme token changes that change size (only colours were checked), consumer-owned edge labels and container frames, published packaging, repainting the faithful scene around consumer cards (the shadcn consumer draws only boxes and polyline routes), quality comparison of dagre/ELK layouts against TALA, other browsers.

## Association layer gaps

- [ ] Real late-result and cancellation transport; nested-board import joins, `...@file` spreads, imported classes, globs across imports; edit operations that rename; non-TALA engines.

## Capability coverage with no probe yet

- [ ] Gradients, patterns and filters beyond the corpus counts, sketch correctness analysis, themes and dark mode, layers/scenarios/steps in the browser, the full 25-shape set, SQL tables and classes, grids and sequence layout, exports.

## Housekeeping

- [ ] Nothing is committed; commit only when the user asks.
- [ ] Imported Studio lint fails (56 errors, 3 warnings); `studio:check` stays a separate gate.
- [ ] Native corpus is 145/147 (two broken remote image URLs).
- [ ] Go/Node WASM hang (about 1 in 20-50 runs under load) is worked around by a timeout and retry, cause unknown.
- [x] Gate split (31 Oct 2026): `mise run check` is the fast gate (8.7 s, no browser); `check:browser` is every Playwright suite (188 s); `check:full` runs both and is what CI should use. Studio tasks renamed `studio:*`. Mixed research tasks gained a `:node` half.
