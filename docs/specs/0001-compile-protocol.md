# Spec 0001: compile protocol and scene bridge (render only)

Status: **accepted** (user, 31 October 2026), implemented in `packages/d2web/src/{protocol,request,client}.ts` and `packages/d2web-wasm/{compile,scenejson}`. Scope set by [ADR 0007](../adr/0007-product-scope-v1.md) and [product.md](../product.md): v1 render only. Runtime shape is [ADR 0003](../adr/0003-runtime-shape.md). Implementation and named test coverage do not certify every feature combination; current browser findings are in the [audit](../web-native-audit.md).

## 1. Purpose and non-goals

A host page sends D2 source and options to a worker that runs the D2 Go/WASM build, and receives one scene per board plus the association data and diagnostics, keyed by revision. The protocol is transport only: it does not know shapes, themes or layouts, so new D2 capabilities arrive as payload content, not protocol changes ([coverage census](../capability-matrix.md): every corpus feature reduces to five scene primitives).

Not in this spec: edits and undo (v2, ADR 0004), font mismatch reporting (ADR 0006), packaging of worker and wasm, painting, other browsers.

## 2. Participants

- **Host client** (main thread): owns revisions, coalescing and the worker's life.
- **Worker**: loads the wasm once, then serves requests one at a time. One wasm thread; no parallel compiles.
- **Instance**: a persistent wasm instance exposing a Promise-returning compile function. Verified identical to fresh instances, and an error does not poison it (`test:research:loop`).

## 3. Messages

All messages are structured-clone JSON-like objects with `v` (protocol version, integer).

### 3.1 Worker to host: `ready`
`{ v, type: 'ready', d2: '<D2 version>', engines: ['tala', 'dagre', 'elk'], sceneVersion }`. Sent once after instantiation. Instantiation cost is recorded in findings, not specified here.

### 3.2 Host to worker: `compile`
```
{ v, type: 'compile', id, revision,
  files: { '<path>': '<text>' },      // virtual filesystem; entry is a key
  entry: 'main.d2',
  layout: 'tala' | 'dagre' | 'elk',   // default tala; ADR 0005
  seeds: [1, 2, 3],                   // TALA attempts, as d2 --tala-seeds; default [1, 2, 3]
  render: { themeId, themeOverrides?, sketch, pad, scale, center },
  budgets: { maxNodes, maxPathCommands, sketch: {...}, links: {...}, svgImport: {...} },
  boards: ['<board path>', ...] }     // default: root board only; 'all' is allowed
```
- `id` correlates replies; `revision` is the host's document revision and is echoed untouched.
- Render options are part of the request because they change the scene (section 5).
- `seeds` are the TALA attempts, the same as `d2 --tala-seeds`: TALA lays the diagram out once per seed, one after another (the wasm is single-threaded), and keeps the best. The default is the d2 CLI's `[1, 2, 3]`, so results match `d2` without flags. A consumer may ask for fewer, for example `[1]` while the user is typing and the default once they stop; fewer seeds are faster but the layout can differ from native. A diagram's own `vars.d2-config.data.tala-seeds` takes precedence, as natively. dagre and ELK ignore the field. At most 16 distinct integers (D2's limit). Decided 2 November 2026.
- Budgets are required by the builder (section 5). The host's request normalizer supplies defaults; the request may lower or raise them (decided 31 October 2026). A raw worker request must already carry the resolved budgets.
- `boards` defaults to the root board only; other boards are requested by path or with `'all'` (decided 31 October 2026). The result lists which boards exist, so a consumer knows what it can ask for.

### 3.3 Worker to host: `result`
```
{ v, type: 'result', id, revision, millis,
  boards: [ { path, scene, association } ],
  diagnostics: [ { severity, message, board?, file?, range? } ],   // range is UTF-16 offsets within `file` (changed with spec 0004; were bytes)
  fonts: { '<asset id>': <bytes> },      // beside the scenes, deduplicated; never inside them
  echo: { layout, seeds, render } }
```
- Success carries one entry per requested board. Failure carries `error: { code, message, diagnostics }` and **no** `boards`; a failed compile never returns partial scenes (matches the copy-on-write rule of ADR 0004).
- `echo` repeats the options actually used, so the host can detect a mismatch (a past bug silently dropped theme overrides and sketch).
- `scene` is section 4. `association` is keyed by (revision, board path, object ID) and carries source ranges, per ADR 0002.

### 3.4 Host to worker: `cancel`
There is no cooperative cancel: the wasm thread cannot be interrupted. The only real abort is terminate and respawn (`test:research:loop`, worker test: 3.6 s to final result against 6.2 s waiting). So:
- The host coalesces under **latest wins**: while a compile runs, only the newest pending request is kept (verified: a burst of six requests collapses to two computes).
- If the running compile is older than the newest request by more than a host-chosen threshold, the host terminates the worker and starts a new one. This is a host policy, not a message. The `cancel` message is therefore **not part of v1**; late results from a superseded request are discarded by `id`/`revision`.

## 4. Scene payload

The payload is D2's own scene document (`d2scene.Document`: view box, logical size, root node tree, assets, link regions) serialized as versioned JSON. Rules:
1. **Whole, not reduced.** The worker serializes everything the builder produced, including masks, clips, filters, blend, animations, assets (fonts as bytes, embedded images) and link regions. The research dump already carries this; the geometry-subset serializer in `research/geometry/scene-probe.go` is explicitly not the model.
2. **Closed encoding.** Every primitive and paint is a tagged object (`{ $: 'Rect', ... }`). `packages/d2web-wasm/scenejson` uses reflection with an explicit allow list, a type snapshot test and errors for unlisted types. It retains D2's exported field names and numeric enums. This is an implemented, versioned encoding, not a framework-independent semantic content tree; the TypeScript public `scene` field remains `unknown`.
3. **Versioned.** `sceneVersion` increments on any breaking change. Unknown fields must be carried through by intermediaries and ignored by consumers; an unknown *primitive* or *paint* kind makes the painter fail visibly for that node instead of dropping it.
4. **Self-contained.** Assets travel inside the scene; the scene never requires a fetch to paint, except fonts the consumer chose not to inline (ADR 0006). Amended by [spec 0010](0010-images.md): an image the scene cannot carry (the consumer chose `link` mode, or did not supply it and chose the link fallback) is still the builder's placeholder in the scene; its link travels on the association side (`AssociationObject.image`) and the painter shows it as an image element. The scene itself stays closed and network-free.

Verified basis: all 173 boards of 147 corpus runs build as scenes with zero errors; primitives are Rect, Path, TextRun, Ellipse and Image only (`test:research:census`).

## 5. Render options: what reaches the scene

`test:research:options` ([test](../../research/options.test.mjs), [probe](../../research/options.go)) shows, identically in native and Node/WASM:
- a different `themeId` changes the scene's fills;
- a dark theme id changes them again;
- `sketch` changes path data.

Consequences for the contract:
- **Dark theme is not a scene option.** `d2scenebuild.Options` has `ThemeID` and `ThemeOverrides` but no dark theme field; native SVG achieves "automatic dark" by embedding a media query. Decided 31 October 2026: `render` is a single set of options and light/dark pairing is the host's job (two requests). `fonts.spec.mjs` compares both light and dark paint with native in a browser.
- **Budgets are mandatory inputs.** The builder rejects zero sketch budgets even when sketch is off. The host resolves defaults and the request may raise or lower them; exceeding a budget is an error result, not truncation.
- `pad`, `scale`, `center` and `themeOverrides` are scene options and are echoed.

## 6. Ordering, errors and limits

- Replies carry `id` and `revision`; the host drops any reply whose revision is not the latest it wants.
- Error codes (proposed): `compile` (D2 diagnostics), `budget`, `layout` (engine failure, including panic recovery), `internal`. A wasm trap or hang is a worker failure the host handles by respawn.
- Known hazard: the Go/WASM runtime under Node hangs about 1 in 20-50 runs under load (cause unknown); the browser worker has not shown it, but the host should treat a worker that never replies as failed after a timeout.
- Cost: TALA grows steeply (50 nodes 2.7 s, 100 nodes 18-24 s in Chromium WASM) and blocks the worker, not the page; ELK/dagre handle 1000 nodes in 1-5.6 s but lay out differently (ADR 0005). Message overhead is about 1 ms.

## 7. Verified, proposed, unknown

| Claim | State | Evidence |
| --- | --- | --- |
| Persistent instance, results identical to fresh, errors do not poison it | verified | `test:research:loop` |
| Latest-wins coalescing, abort by respawn, page stays responsive | verified | `test:research:loop` |
| Message overhead about 1 ms | verified | `test:research:loop` |
| Every corpus feature reduces to five primitives; all boards build | verified | `test:research:census` |
| Theme, dark theme id and sketch reach the scene in native and WASM | verified | `test:research:options` |
| Multi-board request returns requested boards | implemented; native/Node-WASM and browser coverage | `packages/d2web-wasm/tests/protocol.test.mjs`, feature-map board cases |
| Closed versioned scene encoding | implemented; reflection plus explicit type allow list | `scenejson/scenejson_test.go`, `test:wasm` |
| Association payload shape and UTF-16 source ranges over the worker | implemented in slice 4 | spec 0004, `test:wasm`, `association.spec.mjs` |
| Budget defaults | implemented in host request normalization; raw worker inputs require resolved values | `src/request.ts`, `test:unit`, spec 0008 for layout timeout |
| Painting a dark-theme scene | browser coverage for a named board, not every combination | `fonts.spec.mjs` |
| Firefox | works (docs/browser-support.md) | |
| Safari | Playwright WebKit works, real Safari unverified (docs/browser-support.md) | |
| Worker and wasm packaging, bundle size | implemented; build and consumer test contracts in spec 0003 | `test:dist`, `test:consumer`; not rerun by the text review |

## 8. Decisions taken in review (user, 31 October 2026)

1. Light and dark are two requests built by the host; one request carries one set of render options.
2. Budget defaults live in the worker; a request may lower or raise them.
3. A request returns the root board by default; other boards are requested by path or with `'all'`, and the result lists the boards that exist.

The user accepted the spec as written on 31 October 2026.
