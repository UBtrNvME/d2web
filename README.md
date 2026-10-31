# d2web

**Current phase: architecture research with executable experiments.** The preferred foundation is native HTML, JavaScript and CSS, including browser-native SVG, with future React components building on framework-independent contracts. The [research plan](tasks/plan.md) and [task list](tasks/todo.md) compare boundaries and local evidence before selecting APIs. React Flow is prior art for how connections are drawn and interacted with, not the intended foundation. The real web surface includes semantics, source association, browser interaction and lifecycle as well as rendering.

Build a reusable browser library for D2: WASM runtime integration, semantic/source and native scene/paint data, and browser presentation, including TALA support. D2 remains the language, compiler, layout and default appearance authority. React is a future binding and an existing experimental renderer, not a required browser runtime dependency by design.

The full target is D2 on the web: every D2 element and its content, styling, theming, layout and rendering behavior must have an explicit, verified web mapping. Geometry is the first tested subset, not the product boundary. Reuse D2 through WASM and map presentation to web primitives rather than duplicating D2's language or layout engines in JavaScript/TypeScript. Consumer-owned React/shadcn components may supply opt-in alternate representations above the faithful default.

D2 Architecture Studio is a future consumer of d2web. Editor panels, toolbars, application state and persistence belong to consuming applications. The imported Studio is reference material; its UI and framework do not define the library's architecture or dependencies.

Applications such as a future `d2editor` should integrate through documented runtime/data contracts, stable D2 identities and source references, React components/events and characterized native operations. These integration boundaries remain to be specified as capabilities are proved; no generic plugin framework is assumed.

The current priority is a pinned pipeline map and executable feature/capability matrix, followed by a joint decision on the web mapping. The imported Studio is a prototype, not the specification or a certified renderer.

- [Goal, proposed approach and current handoff](docs/project-brief.md)
- [D2 → React porting map](docs/porting-map.md)
- [Research findings: frameworks, source identity, browser composition and native operations](docs/research-findings.md)
- [Native TALA and web comparison guide](docs/conformance.md)
- [Capability matrix (R5 draft)](docs/capability-matrix.md)
- [Product definition (v1)](docs/product.md)
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
| `packages/d2web/` | The product TypeScript package (protocol types now; host client and painter in slice 1) |
| `packages/d2web-wasm/` | Product Go module (created in slice 1 step 2) |
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
| `mise run test:dist` | Build, then check dist contents and the size budget |
| `mise run test:consumer` | Build, pack, and load the tarball in a bundler-free Chromium page, including under a strict CSP |
| `mise run check:browser` | Every Chromium/Playwright suite (about 3 min) |
| `mise run check:full` | `check` plus `check:browser`; what CI runs |
| `mise run check` | Fast gate (about 10 s, no browser): validate tooling, inventory, cleanup, output pairing, native cases, scene/WASM boundary, browser comparison machinery, the D2 v0.9.0 reference checkout (`reference:fetch`) and five research probes (identity, operations, text, connections, composition) |
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

`check` and [CI](.github/workflows/check.yml) validate d2web and one native-versus-React geometry case. `studio:check` is the separate, failing gate for the imported reference consumer and is not counted as a passing d2web check. Future Studio adoption will need its own integration checks. The comparison self-tests do not establish React parity; the dedicated React geometry test is the first real comparison. See the [porting map](docs/porting-map.md#react-geometry-adapter) for its exact subset and limits.

Root rendering dependencies and build tools are pinned in `package.json`/`pnpm-lock.yaml`. `pnpm-workspace.yaml` permits esbuild's installation script only and includes only the root package; the imported Studio retains its own workspace policy and package-manager selection.

The five research probes run in `check`; the other research tasks (React Flow, JointJS, consumer, host) are separate from root `check`/CI. None certify product capabilities. React Flow and JointJS Core are installed only by their opt-in research setups under `artifacts/research-reactflow/` and `artifacts/research-jointjs/`, with scripts/automatic peers disabled. Root build tools are shared; the historical React Flow probe also shares root React. `clean` removes those scratch installations/lockfiles along with artifacts; regenerating their locks can select newer transitive versions. They are not production dependencies or packaged library APIs.

## Using the built package

`mise run build` writes `packages/d2web/dist/` ([spec 0003](docs/specs/0003-packaging.md)); nothing is published to a registry yet. Host `worker.js`, `wasm_exec.js` and `d2web.wasm` same-origin, next to the module:

```js
import { createClient, spawnWorker, mount } from 'd2web';
const client = createClient({ spawn: spawnWorker() }); // or spawnWorker({ worker, exec, wasm }) to override URLs
```

- Source association: `result.boards[i].association` lists each object with its label, content role, source declarations, property owners and scene nodes; `getObject(association, id)` and `objectsAt(association, { path, line, column })` look things up ([spec 0004](docs/specs/0004-association.md)). Positions are UTF-16 (`offset` is a JS string index); identity across edits is not provided.
- Sizes: `d2web.wasm` 52.7 MB raw, about 13.6 MB gzip (serve it compressed); `index.js` about 8 KB gzip. A test fails above 15 MB and 40 KB gzip.
- Serve the wasm as `application/wasm`; a wrong type still works but compiles without streaming.
- The worker must be same-origin. A strict CSP needs `worker-src` and `'wasm-unsafe-eval'` in `script-src` (tested).
- A stale cached wasm paired with a newer client fails with `VersionError`. `ready.patched` is true when the wasm was built from a patched D2.
- Not tested: Vite, webpack, Next.js, cross-origin hosting, Firefox, Safari. Licence: MPL-2.0 (same as D2, which the wasm embeds); `dist/NOTICE.txt` carries D2's and Go's notices. The npm name `d2web` was unregistered on 31 October 2026 (404); it is only reserved by publishing.

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

There is no global cache purge or broad `git clean` command. Local environment files and logs are ignored. The source is in the initial commit; later changes are uncommitted and nothing has been pushed or deployed.
