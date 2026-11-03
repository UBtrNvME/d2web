# d2web

**Current phase: product implementation and browser verification.** The accepted v1 is a read-only D2 browser runtime ([product scope](docs/product.md), [specifications](docs/SPEC.md)). Production code uses native HTML, JavaScript, CSS and SVG; React is an optional future binding. The [research plan](tasks/plan.md) records how the architecture was investigated; the [task ledger](tasks/todo.md) records delivery and remaining work.

**Rendering update (2 November 2026):** zoom-dependent text calibration, animated-object ownership, font-loading cleanup and inline-link naming have focused regression fixes. Typed prepared boards and explicit DOM ownership are documented in [spec 0011](docs/specs/0011-rendering-contract.md). Full semantic coverage and a React renderer remain future work; see the [browser audit](docs/web-native-audit.md).

Build a reusable browser library for D2: WASM runtime integration, semantic/source and native scene/paint data, and browser presentation, including TALA support. D2 remains the language, compiler, layout and default appearance authority. React is a future binding and an existing experimental renderer, not a required browser runtime dependency by design.

The full target is D2 on the web: every D2 element and its content, styling, theming, layout and rendering behavior must have an explicit, verified web mapping. Geometry is the first tested subset, not the product boundary. Reuse D2 through WASM and map presentation to web primitives rather than duplicating D2's language or layout engines in JavaScript/TypeScript. Consumer-owned React/shadcn components may supply opt-in alternate representations above the faithful default.

D2 Architecture Studio is a future consumer of d2web. Editor panels, toolbars, application state and persistence belong to consuming applications. The imported Studio is reference material; its UI and framework do not define the library's architecture or dependencies.

The separate [d2editor](docs/specs/0013-d2editor.md) application consumes `client.edit`, typed events and association data: canvas actions publish checked patches to its D2 source. Run `mise run editor` and open `http://localhost:5281`; its static build is staged at `/editor/` beside the demo by the Pages workflow (available after merge and deployment). Browser acceptance for this first slice is recorded in the [task handoff](tasks/todo.md).

The runtime, worker protocol, mount, association, packaging, fonts, animation and image paths exist. Rich content has semantic wrappers and opt-in markdown flow; full web-native semantics and presentation replacement remain incomplete. The imported Studio is a prototype, not the specification or a certified renderer.

- [Goal, proposed approach and current handoff](docs/project-brief.md)
- [D2 pipeline and porting research](docs/porting-map.md)
- [Research findings: frameworks, source identity, browser composition and native operations](docs/research-findings.md)
- [Native TALA and web comparison guide](docs/conformance.md)
- [Research capability matrix](docs/capability-matrix.md)
- [Product definition (v1)](docs/product.md)
- [D2 feature map](docs/feature-map.md): every D2 capability, how it reaches the web and whether it paints equal to native (generated)
- [Writing D2 that lays out well](docs/d2-authoring-guide.md): authoring rules and features to avoid, from rendering the large examples on TALA, ELK and dagre
- [Browser review: text, clipping and web-native gaps](docs/web-native-audit.md)
- [d2editor first slice](docs/specs/0013-d2editor.md): source and canvas editing, local files, exact-text undo and checked patches; later slices: [drag to position](docs/specs/0014-drag-to-position.md), [palette, zones and drag-to-connect](docs/specs/0015-palette.md), [drag past the origin](docs/specs/0016-drag-past-origin.md); agents remain later
- [Specifications index](docs/SPEC.md): [0001 compile protocol (accepted)](docs/specs/0001-compile-protocol.md), [0002 mount API (accepted)](docs/specs/0002-mount-api.md), [0003 packaging (accepted)](docs/specs/0003-packaging.md), [0004 association (accepted)](docs/specs/0004-association.md)
- [Architecture decision records](docs/adr/README.md)
- [Test examples and provenance](examples/README.md)
- [Imported Studio, upstream source and historical evidence](imports/README.md)
- [Development rules](AGENTS.md)

## Repository layout

| Directory | Responsibility |
| --- | --- |
| `docs/` | Current requirements, mapping and validation guidance |
| `examples/` | Repository-owned conformance inputs, imports, assets and upstream license |
| `tests/` | Node assertions and Playwright comparisons; no second examples tree |
| `packages/d2web/` | Product client, protocol and association types, mount, painter and browser tests |
| `packages/d2web-wasm/` | Product Go compiler/scene bridge and worker entry point |
| `packages/d2editor/` | Separate source/canvas editor consumer, static site at `/editor/` |
| `research/` | Research probes, Playwright specs (`research/browser/`) and the earlier React geometry adapter (`research/geometry/`) |
| `scripts/` | Repository maintenance commands |
| `imports/` | Historical evidence and local external source copies; D2 source is in `imports/d2/`, Studio in `imports/d2-architecture-studio/` |
| `artifacts/` | Ignored generated references, logs, screenshots and reports |

The separate `references/` directory has been consolidated into `imports/`. Tests read all conformance inputs from `examples/`, without needing the upstream checkout. See the comparison guide for the remaining remote-image dependencies.

## Setup and validation

With mise installed, review [mise.toml](mise.toml), then run from this directory:

```sh
mise trust
mise run setup
mise run browser:install
mise run check
```

Mise supplies Node.js 24, Go 1.27.3 and D2 0.9.0. Corepack provides the package-local pnpm versions: root `pnpm@12.14.0`, Studio `pnpm@11.25.0`. Use `mise exec -- <command>` for one-off commands. Do not use the imported starter's historical npm installer.

### Worktrees

Parallel work uses [worktrunk](https://worktrunk.dev) (`wt`). `wt switch --create <branch>` makes a worktree and runs the `pre-start` hooks in [.config/wt.toml](.config/wt.toml): `mise trust`, `wt step copy-ignored` (reuses the primary worktree's `node_modules/` and `imports/d2/`, as listed in [.worktreeinclude](.worktreeinclude)) and a frozen `pnpm install`. Worktrunk runs project hooks only after you approve them: run `wt config approvals add` once and read the three commands. Merging still goes through GitHub pull requests (`gh pr merge`), not `wt merge`; afterwards `wt remove <branch>` from another worktree. Run `mise run browser:install` once per machine, not per worktree.

The existing Studio commands below are optional reference-consumer tooling, separate from d2web development:

```sh
mise run studio:setup
mise run studio:dev
# In a separate shell:
mise run studio:check
```

The imported Studio stays in its independent Git checkout at the user's request. Its source and history are preserved and the outer repository explicitly ignores it to prevent accidental gitlink staging. It is not a submodule: an outer clone alone does not restore it. Restore that checkout separately before running the app commands; [import provenance](imports/README.md) records its identity and commit. Inspect its changes with `mise exec -- git -C imports/d2-architecture-studio status --short`.

| Command | Purpose |
| --- | --- |
| `mise run setup` | Install tools, root locked dependencies and upstream source for investigation |
| `mise run browser:install` | Install Playwright Chromium and required OS packages |
| `mise run doctor` | Print resolved tool versions |
| `mise run build` | Build `packages/d2web/dist` (wasm, worker, ESM, types, notices) |
| `mise run editor` | Build and serve d2editor on loopback port 5281 (`localhost`, IPv4 and IPv6) |
| `mise run editor:build` | Bundle the static editor site and d2web worker into `packages/d2editor/dist` |
| `mise run test:editor` | Built-site response checks and Chromium editor acceptance tests with the real worker/WASM |
| `mise run test:dist` | Build, then check dist contents and the size budget |
| `mise run test:consumer` | Build, pack, and load the tarball in a bundler-free Chromium page, including under a strict CSP |
| `mise run check:browser` | Every Chromium/Playwright suite (about 3 min) |
| `mise run check:full` | `check` plus `check:browser`; run locally before handoff (CI runs `check`, and `check:browser` only when started by hand) |
| `mise run check` | Fast gate (no browser): tooling, inventory, cleanup, output pairing, native cases, product unit/type/WASM checks, the D2 v0.9.0 checkout (`reference:fetch`) and native/Node research probes |
| `mise run test:scene` | Build the native/WASM geometry scene probe and check Node/WASM equivalence |
| `mise run test:research:identity` | Compare selected source/identity projections in native and Node/WASM |
| `mise run test:research:operations` | Characterize native edit mutation and text premeasurement behavior |
| `mise run test:research:lifecycle` | Two boards per document under hostile host CSS: ID collisions, style isolation, lifecycle effects |
| `mise run test:research:content` | Consumer element replacing one painted node: surroundings unchanged, hit testing, events, restore |
| `mise run test:research:handshake` | Measured card sizes recompiled through D2 width/height with TALA |
| `mise run test:research:transaction` | Copy-on-write edit wrapper: failed edits publish nothing, glob-index panic, index renumbering |
| `mise run test:research:composition` | Compare HTML/SVG placement, interaction, CSS leakage and overflow |
| `mise run research:reactflow:setup` | Explicitly install the pinned framework into ignored experiment artifacts |
| `mise run test:research:reactflow` | Test actual React Flow fixed-bound custom nodes and native connection path after setup |
| `mise run test:research:connections` | Test native SVG paint versus hit targets across viewport/device scales |
| `mise run research:jointjs:setup` | Explicitly install pinned framework-free JointJS Core into experiment artifacts |
| `mise run test:research:jointjs` | Compare fixed geometry, custom native path, HTML events and structural cleanup |
| `mise run test:research:text` | Export native text/font assets and compare browser metrics with font controls |
| `mise run test:research:host` | Quick native lifecycle/React portal check using the imported shadcn Card; requires the local Studio import/dependencies |
| `mise run test:research:consumer` | Pack/import a native module, compile Card themes, test explicit native resizing and base/resized image parity; requires Studio dependencies |
| `mise run typecheck` | Typecheck the standalone React geometry adapter |
| `mise run test:native:corpus` | Render all 147 repository-owned file/archive runs with TALA |
| `mise run test:parity` | Compare native SVGs to actual web scenes from `D2_WEB_OUTPUT` |
| `mise run studio:setup` | Install the imported Studio with its frozen lockfile |
| `mise run studio:dev` | Start the Studio on loopback, default port 5173 |
| `mise run studio:lint` / `mise run studio:typecheck` | Run the Studio's existing ESLint rules / TypeScript check |
| `mise run studio:test` | Run imported document, compaction and rich-content WASM assertions |
| `mise run studio:build` | Build the Studio locally without deploying |
| `mise run studio:check` | Run lint, typecheck, imported assertions and build; lint currently fails |
| `mise run clean` | Delete the local generated files and caches listed below |
| `mise tasks` | Discover all commands |

`check` is the fast non-browser gate. `check:browser` includes the product browser suites and the native-versus-React research geometry comparison; [CI](.github/workflows/check.yml) runs it only on a manual dispatch with `browser=true`. `studio:check` is the separate, failing gate for the imported reference consumer. The comparison self-tests validate the harness; the React geometry case proves only its admitted subset. See the [conformance guide](docs/conformance.md) for the separate product catalog, semantic and external-output checks.

Root rendering dependencies and build tools are pinned in `package.json`/`pnpm-lock.yaml`. `pnpm-workspace.yaml` includes `packages/*` and permits esbuild's installation script only; the imported Studio retains its own workspace policy and package-manager selection.

Native/Node research probes run alongside the product checks in `check`; research browser suites run in `check:browser`, and React Flow, JointJS, consumer and host experiments have separate opt-in tasks. Research results do not certify every product capability. React Flow and JointJS Core are installed only by their research setups under `artifacts/research-reactflow/` and `artifacts/research-jointjs/`, with scripts/automatic peers disabled. Root build tools are shared; the historical React Flow probe also shares root React. `clean` removes those scratch installations/lockfiles along with artifacts; regenerating their locks can select newer transitive versions. They are not production dependencies or packaged library APIs.

## Using the built package

`mise run build` writes `packages/d2web/dist/` ([spec 0003](docs/specs/0003-packaging.md)); nothing is published to a registry yet. Host `worker.js`, `wasm_exec.js` and `d2web.wasm` same-origin, next to the module:

```js
import { createClient, spawnWorker, mount } from 'd2web';
const client = createClient({ spawn: spawnWorker() }); // or spawnWorker({ worker, exec, wasm }) to override URLs
```

- Renderer input: `prepareBoard(result, boardPath?)` returns a DOM-free `RenderBoard` with the typed complete scene, source association, fonts, objects and link ownership. Treat borrowed data as immutable. See [spec 0011](docs/specs/0011-rendering-contract.md) for approximate bounds, renderer responsibilities and single-owner consumer content. A full React renderer can consume this data; none is shipped yet.
- Source association: `result.boards[i].association` lists each object with its label, content role, source declarations, property owners and scene nodes; `getObject(association, id)` and `objectsAt(association, { path, line, column })` look things up ([spec 0004](docs/specs/0004-association.md)). Positions are UTF-16 (`offset` is a JS string index); identity across edits is not provided.
- Fallback fonts ([spec 0007](docs/specs/0007-fonts-and-text.md)): `createClient({ spawn, fonts: [{ name, url, sha256? }] })` lists the fonts you approve for text D2's own fonts lack (Arabic, CJK, emoji). The client fetches each once, checks `sha256`, and hands the bytes to the worker; nothing else is ever fetched. Characters no listed font covers produce a `warning` diagnostic naming the object; the browser paints its own fallback for them. Errors: `FontError`.
- Images ([spec 0010](docs/specs/0010-images.md), [ADR 0011](docs/adr/0011-images-like-native-d2.md)): by default a remote `icon` or `shape: image` is D2's placeholder and nothing is fetched. `createClient({ spawn, images: { mode: 'bundle', resolve: fetchImages({ allow: ['https://icons.terrastruct.com'] }), fallback: 'link' } })` has the page fetch each link the source uses (only from the origins you list, credentials omitted) and hand the bytes to the compiler, like `d2 --bundle`; SVG icons become drawing primitives, never markup. `resolve(source, { signal })` may be your own function (cache, auth, allowlist) and `supplied` gives known bytes by link, relative paths included. A link that cannot be resolved is the placeholder (or, with `fallback: 'link'`, an `<img>` the browser loads) plus a `warning` diagnostic with `code: 'image-unresolved'`; D2's own refusals (an unsupported scheme, gradients outside `<defs>`) stay errors. `images: { mode: 'link' }` keeps every link as an `<img>` (`--bundle=false`), loaded by the viewer's browser under the page's CSP. Limits: 4 MiB per image, 256 images, 15 s per `resolve` call, 6 at a time.
- Identity: a result for a one-file request carries `identity`, the source in [Kroki's encoding](https://docs.kroki.io/kroki/setup/encode-diagram/) (UTF-8, zlib level 9, URL-safe base64), so `https://kroki.io/d2/svg/<identity>` addresses the same text. It is absent for several files (Kroki has no multi-file form). The demo shows it under the editor with a Copy button.
- Layout budget ([spec 0008](docs/specs/0008-large-boards.md)): `budgets.maxLayoutMillis` (default 60 000) aborts a slow compile with a `TimeoutError` whose `code` is `'budget'`; `countObjects(board.association)` sizes a board, and [docs/layout-limits.md](docs/layout-limits.md) shows what each engine costs. d2web never switches engine on its own.
- TALA seeds ([spec 0001](docs/specs/0001-compile-protocol.md)): TALA lays a diagram out once per seed and keeps the best, like `d2 --tala-seeds`. The default `[1, 2, 3]` matches `d2` without flags; the wasm runs them one after another, so a compile costs about three layouts. `compile({ ..., seeds: [1] })` is about three times faster but may lay out differently from native, for example while the user is typing, followed by a default compile when they stop. A diagram's own `vars.d2-config.data.tala-seeds` wins over the request.
- Sizes: `d2web.wasm` 52.7 MB raw, about 13.6 MB gzip (serve it compressed); `index.js` about 8 KB gzip. A test fails above 15 MB and 40 KB gzip.
- Serve the wasm as `application/wasm`; a wrong type still works but compiles without streaming.
- The worker must be same-origin. A strict CSP needs `worker-src` and `'wasm-unsafe-eval'` in `script-src` (tested).
- A stale cached wasm paired with a newer client fails with `VersionError`. `ready.patched` is true when the wasm was built from a patched D2.
- Not tested: Vite, webpack, Next.js, cross-origin hosting. Browsers: Chromium is the reference, Firefox works with small paint differences, WebKit works in Playwright (the worker start failure is fixed); real Safari is not yet verified; see [docs/browser-support.md](docs/browser-support.md). Licence: MPL-2.0 (same as D2, which the wasm embeds); `dist/NOTICE.txt` carries D2's and Go's notices. The npm name `d2web` was unregistered on 31 October 2026 (404); it is only reserved by publishing.

## Generated files and cleanup

Stop development servers, builds and tests before running `mise run clean`. It uses a fixed list, refuses symlinked parent directories and works independently of the caller's working directory. Deleted reports and native references are regenerated by the checks, never from candidate screenshots.

| Data | Git policy and cleanup |
| --- | --- |
| Root `artifacts/`, `.cache/`, `.pnpm-store/`, `dist/`, `coverage/` | Ignored; removed by `clean` |
| Root `.cache/go-build/`, `.cache/go-mod/`; `artifacts/scene-probe/` | Generated Go caches and native/WASM probe output; removed with their parents by `clean` |
| Both packages' `node_modules/.cache/`, `node_modules/.vite/`; root `node_modules/.pnpm-store/` | Ignored with dependencies; removed by `clean` |
| Studio `dist/`, `.next/`, `.vinext/`, `.cache/`, `.pnpm-store/`, `coverage/`, `tsconfig.tsbuildinfo` | Outer import ignored; generated output removed by `clean` |
| Studio `.sites-runtime/pnpm-store/` and `.sites-runtime/wrangler/logs/` | Ignored by Studio; removable dependency download cache and tool logs, removed by `clean` |
| Both `node_modules/` trees | Ignored; installed dependencies retained. Rerun the corresponding setup task to restore dependencies if removed manually |
| Studio `.wrangler/state/`, other `.sites-runtime/` data | Ignored; retained because it may hold local databases or execution configuration |
| `imports/d2/`, the Studio's `.git/`, both pnpm lockfiles and `examples/` | Source/history/input data; never removed by `clean` |
| User-wide Corepack, pnpm, mise and Playwright caches | Outside this checkout; untouched by repository cleanup |

There is no global cache purge or broad `git clean` command. Local environment files and logs are ignored. Inspect `git status --short` for current uncommitted work; the historical research handoffs are not a statement of today's Git state.
