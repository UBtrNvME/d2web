# Goal and proposed approach

Status: d2web library scope clarified by the user on 30 October 2026. The delivery sequence and unimplemented interfaces remain proposals; verified subsets are recorded in the handoffs.

## Current research direction

Latest clarification: build as close to native HTML/JavaScript/CSS (including browser SVG) as practical, suitable as a foundation for later React components. React Flow was requested as connection-rendering prior art, not as the intended foundation. Continue JointJS, native connection/hit-testing and text experiments with that priority. Prefer capable lower-cost research workers; model choice does not replace independent review or local evidence. Any earlier mandatory React rendering wording is superseded by this direction.

Automatic research execution with independent workers is now authorized. See the [findings](research-findings.md) for the current evidence, counterexamples and limits. The initial R1 association probe is executed; follow the task ledger for remaining work rather than treating the initial next-step text below as current status. No production architecture has been accepted.

Research also includes web diagramming framework patterns (initially React Flow and JointJS), future external library consumption, and opt-in consumer replacement of diagram representation with shadcn or similar components. Customization includes node/content presentation, not only surrounding editor UI. Keep the faithful D2 default available; test dimension changes and layout ownership explicitly. These additions supersede narrower appearance restrictions below. See R0 and R6 in the research plan; neither framework adoption nor a customization API has been selected.

The user clarified that we are researching a complete D2 web surface, with local experiments to test competing hypotheses before accepting an architecture. Follow the [research plan](../tasks/plan.md) and [task list](../tasks/todo.md). React is an accepted binding and the current geometry experiment, not an accepted mandatory foundation. Scene-first, semantic-first and combined representations remain candidates; browser interaction, accessibility, source association, editing and embedding must inform the choice alongside visual fidelity. This clarification takes precedence over React-specific architectural wording and implementation-first next steps below.

d2web introduces no independent appearance or application policy. Runtime effects need explicit consumer-controlled lifecycle and resource contracts; persistence, navigation, telemetry, global styling and integrations must not happen implicitly. Reskinning and application integrations build above the faithful D2/d2web baseline. Next execute the semantic/source-association experiment R1, rather than automatically expanding the geometry adapter. No new experiment results are claimed by this planning update.

## Goal

Build **d2web**, a reusable browser library that brings D2's runtime, semantics/source association, native scene/paint behavior and rendering to web applications. D2 WebAssembly remains the authoritative compiler and layout engine, including TALA. Prefer framework-independent browser contracts and native HTML/JavaScript/CSS/SVG presentation, with future React bindings.

The intended scope is the complete D2-to-web mapping: all elements, connections, containers, structured diagrams, text/rich content, images, styles, themes, effects, boards and their interactions. Geometry is one implementation layer and the first verified slice; "geometry adapter" is not the name or scope of the overall library. The broader capability is the **D2 web runtime and browser presentation**. Reuse native semantics through WASM and prefer platform primitives, with a later React binding and explicit consumer customization.

Future consumers such as `d2editor` need deliberate integration boundaries: runtime compile/lifecycle APIs; typed graph/scene data and diagnostics; stable object IDs and source provenance; controlled React rendering and event association; and characterized native source-operation APIs. Consumers own their UI and interaction policy. These are interface responsibilities to specify and test, not public methods already implemented or permission to invent alternate diagram behavior.

The user clarified the product boundary explicitly: we are building d2web, which may later be used by D2 Architecture Studio. Studio is a downstream application, not the deliverable of this repository. Its imported prototype and original requests supply context and test scenarios. Tailwind, Vinext, editor panels, toolbars, source-editor widgets, persistence and other application choices are consumer concerns.

Diagram nodes and connections must be individual native browser elements suitable for component integration. HTML and SVG are accepted; React can own these in a binding, but is not required in the preferred foundation. A complete generated SVG image/string alone does not establish the programmable web surface. Diagram styling and theming require a traceable mapping from D2 values and rules; see the [porting map](porting-map.md).

The direction is to become a browser integration/runtime and web presentation library within the D2 toolchain, suitable for React and other consumers. Reuse upstream implementations and isolate missing browser APIs as potential upstream contributions. Official distribution or maintainer adoption is not assumed.

Consuming applications should receive faithful compile results, scene data, diagnostics and React components through explicit contracts. Characterized native editing operations can later support consumers that offer visual editing. The library must preserve D2 files, identities, imports and semantics; consumers choose their editor UI, interaction state, undo/persistence policy and packaging.

The latest direction takes precedence over prototype expansion: dissect D2's elements, features and pipeline, understand their interactions, then jointly map each to the web. Avoid app-invented diagram behavior and silent loss of D2 meaning.

## Historical consumer context

These points describe the imported Studio discussion. They are examples of consumer needs, not a requirement to build that application's UI inside d2web.

- D2 must remain the main engine. React supplies the interaction layer and node rendering.
- The user liked the outline and live source synchronization.
- The user wanted components grounded in D2 classes and asked to understand all other D2 systems.
- The user asked for compact source after visual edits, full rich-content support and TALA.
- The user rejected decorative canvas headlines unrelated to the diagram.
- The first audit was explicitly an investigation baseline, with detailed feature and interaction tests still outstanding.

## Imported reference consumer, verified by reading its source

The imported Studio uses React/Vinext and declares `@d2lang/d2` with a lockfile. Its browser setup creates a D2 instance; compilation accepts an in-memory file map and a selected engine. TALA is the initial UI preference. Source and selected settings persist in localStorage. These are consumer implementation details, not library requirements.

The code includes a React canvas, source editor, classes, board navigation, an inspector, undo/redo, source compaction, rich content and a separate native SVG preview. These are code-presence observations, not current runtime certification.

Important limitations are visible in the source: the node model is reduced to service-oriented kinds, dragging persists `# @studio-position` comments, local edge curves can replace compiled routes, visual edits append Studio redeclarations, and visual mutation is restricted to the root board. React rich-content handling is separate from D2's native renderer. These require investigation before claiming faithful D2 behavior.

## Proposed sequence

1. **Freeze a reproducible baseline.** Resolve the exact D2 source, JS wrapper, WASM, fonts and toolchain versions. Keep the older audit's upstream commit separate from the binary used by the prototype. Confirm the import runs locally before changing behavior.
2. **Map the whole pipeline.** Trace source files and imports through parsing/AST, expansion/IR, semantic graph, configuration, text measurement, nested layout orchestration, TALA placement/routing, target model, rendering, editing and exports. Record code locations and the browser API boundary.
3. **Expand the feature inventory into executable cases.** Cover syntax, identity, connections, containers, classes, variables, globs, imports, boards/inheritance, shapes, structured diagrams, rich content, styles, assets and engine-specific constraints. For each case record native behavior, browser exposure, proposed web owner, gaps and acceptance evidence.
4. **Characterize safe editing and layout.** Investigate native `d2oracle` operations and whether a narrow WASM bridge is needed before extending custom rewriting. Test source ownership, imported definitions, inherited boards, exact undo, failed edits, coordinates, dimensions, ports and routing.
5. **Agree the web mapping together.** Review which parts stay inside D2/WASM, what a bridge must expose, and how React represents each target type. Resolve any HTML/CSS rendering gaps explicitly before choosing a fallback. Keep document files separate from viewport, selection and temporary gesture state.
6. **Implement and prove one capability at a time.** First establish a faithful compile-to-React vertical slice, then add rendering and mutation capabilities against the agreed fixtures. Preserve the full compiler output rather than regenerating source from a reduced canvas model.

## Proposed architecture

```text
D2 files + entry path + compile configuration
  -> versioned worker request
  -> D2 compiler + measurement + TALA/layout + routing
  -> compiler graph + target diagram + diagnostics
  -> characterized D2 geometry/paint calculations where target data is insufficient
  -> React components owning HTML content and native SVG shapes/connections

Consumer requests a source operation
  -> characterized native edit API / narrow bridge
  -> changed D2 files and diagnostics, applied atomically
  -> recompile through the same pipeline
```

The worker, editing bridge and complete geometry/paint interface are proposed boundaries, not APIs already proven available. Native SVG output is the comparison reference. The renderer creates individual DOM elements through React rather than embedding a complete generated SVG. CSS properties and SVG attributes follow the explicit D2 mapping. Consumer application styling stays outside the diagram/library contract.

## Completion evidence

For a capability to count as supported, the same D2 files and configuration must produce equivalent semantics and geometry in native and browser execution, with documented rendering tolerances. Source-operation APIs must preserve unrelated source and valid references and return no partial update on failure. Request identity must let consumers reject stale results. Imported definitions, classes, globs and boards must follow D2's actual propagation rules. Editor undo/persistence policies are consumer responsibilities.

The [porting map](porting-map.md) now records subsystem technologies, all 20 style keywords, all 25 registered source shape names, theme handling, field coverage and verification gaps. It is a design inventory, not completed feature characterization. Next pin the pipeline/runtime correspondence and build the representative mapping experiment. Full feature parity, a replacement renderer and deployment remain later work.

The [comparison test guide](conformance.md) now defines the native TALA versus React image comparison workflow and its mise/CI entry points. The full upstream source is loaded locally; native example rendering and automated comparison self-tests exist. This establishes test tooling, not source-to-WASM correspondence or React renderer parity.

## Open technical questions

- Exact source-to-WASM build correspondence and whether the current toolchain pins are compatible.
- Public versus internal browser APIs and the minimum safe oracle/geometry bridge.
- Native placement/rerouting APIs and engine-specific constraints that consumers can use.
- Per-feature rendering fidelity achievable with React nodes while preserving D2 metrics and interactions.
- Exact precedence between explicit compile configuration and source configuration.

These questions should be answered by source inspection and focused experiments before further feature work.

## d2web library and React geometry handoff: 30 October 2026

Further scope clarification: the user wants all D2 elements and presentation behavior adapted to React/web, with integration boundaries for future editors. Current `GeometryScene` naming describes its intentionally restricted tested subset. Keep that implementation's claims narrow while developing the complete D2 renderer; do not rename a partial implementation into an apparent full-support API. Runtime/data/component/source-operation boundaries should be consumer-neutral, without a premature plugin system. This clarification changed guidance only; no renderer capability was added by the wording change.

The user explicitly corrected the scope: d2web is the reusable library; Studio may consume it later. Current requirements and ownership tables now reflect that boundary. Library capabilities include WASM/runtime access, D2 scene/paint mapping, rendering components and characterized native operations. Editor UI, application storage/history and consumer framework choices belong to applications. Imported Studio commands remain reference tooling only, and the Studio source has no diff.

The first reusable renderer subset is implemented in `src/geometry-scene.ts` and `src/GeometryScene.tsx`. It accepts explicitly tagged native solid-geometry scene data and creates individual React-owned SVG elements for groups, rectangles, ellipses and move/line/close paths. Validation and the Go probe reject unsupported geometry features before rendering. D2 supplies all geometry, paints, transforms and order; the adapter does not embed a finished SVG or recalculate layout.

Verification: `mise run check` passed four infrastructure unit tests, four fast native cases, one native/Node-WASM scene test, two wire-validation tests, four Chromium tests, strict renderer TypeScript and 20 task definitions. The dedicated React test passed the unchanged native image threshold/bounds check, accessible DOM assertions, no-console-error check and an update that reuses the same rectangle DOM element. Captured native/React images were visually inspected. Frozen pnpm installation, Go formatting and current-document link/whitespace checks passed. esbuild's install script is the sole approved root dependency build. Nothing was staged, committed, pushed or published.

This proves one label-free library rendering case. The candidate consumes a native-generated scene fixture; browser-WASM data equivalence is tested separately. The complete browser runtime-to-React path, general library packaging/API, theme variants, curves, text/fonts, effects and corpus coverage remain future library work. This slice adds no editor UI. The next feature characterization is native theme resolution/typed paint handling, with consumer integration deferred until the library boundary is ready.

## Geometry boundary handoff: 30 October 2026

The [porting map's verified geometry boundary](porting-map.md#verified-geometry-scene-boundary) now records an executed path from `geometry.d2` through the native Go compiler, TALA and `d2scenebuild` into structured scene data. Native macOS, Node/WASM and Chromium/WASM produced exactly equal target/scene JSON for this input. The scene preserves object IDs and supplies final line adjustments, arrowhead geometry, resolved paints and paint order. A separate one-off probe confirmed that the installed Studio package produces the same target for this fixture, reporting D2 `v0.9.0` / JS `0.1.34`.

Added `tests/scene-probe.go`, `tests/scene.test.mjs`, `tests/browser/scene-probe.spec.mjs` and the root `test:scene` task. Root `check`/CI now include this boundary proof. `mise run check` passed: four unit tests, four native examples, one native/Node-WASM scene test, three Chromium tests and 19 valid tasks. Links/whitespace and Go formatting checks passed. Both imported source trees were preserved; Studio remains clean. No changes were staged, committed, pushed or published.

The official annotated D2 tag was resolved to the source commit already recorded in import provenance, and two critical source files match the official tag byte-for-byte. This is not a complete source-tree or binary correspondence audit. The probe's raw Go JSON/type trace is diagnostic; its public TypeScript schema and React component consumption remain to be designed. This label-free geometry input does not establish text/font, image, theme, effect, board or renderer parity. Next implement a small typed scene-to-React adapter for this proven subset and compare its output with native SVG; then characterize the existing theme override fixture. The imported app lint failures and the two full-corpus remote-asset failures remain unchanged.

## Repository preparation handoff: 30 October 2026

Accepted scope: simplify development/validation plumbing and repository organization, identify/ignore/clean generated caches, preserve the independent Studio checkout in `imports/`, and put every conformance input in the root `examples/` tree. No renderer or source-editing behavior was changed. The proposed architecture above remains a proposal.

The layout now has one external-source area (`imports/`), one conformance-input area (`examples/`), current guidance in `docs/`, checks in `tests/`, and maintenance in `scripts/`. The separate `references/` directory and `tests/examples/` tree are gone. D2 investigation source moved intact to `imports/d2/`. All 79 upstream file examples, the required local SVG asset, 64 archive entries and the existing multi-file cases are included in the outer repository's examples tree. Original file/archive contents were compared directly with upstream bytes; all matched. Provenance and the upstream license are included. The native runner no longer extracts temporary archive cases or reads upstream source at test time.

The Studio remains an independent, clean Git checkout at `d5a47eadabb1b142cbd7bdfbc258a9ef2e1d6b64`. Its source, history, package selection and lockfile are unchanged. The outer ignore rules exclude both external source copies to avoid accidental gitlink staging. An outer clone alone cannot restore Studio; app integration and reproducible app CI remain later decisions. Root `check` remains the infrastructure gate; `check:app` exposes the failing imported baseline separately.

Root mise commands now expose app setup, dev, lint, typecheck, WASM assertion scripts, build and the combined app gate. `mise run clean` uses a fixed list and refuses symlinked parents. Cleanup safety is tested against temporary fixtures, including preserved source, lockfiles, dependency trees, runtime configuration and SQLite state. Checkout-local pnpm download caches and stale generated output were removed; installed dependencies, `.wrangler` state, original source and fresh validation reports were retained. The smoke-test server was stopped. See the [README cache table](../README.md#generated-files-and-cleanup) for ownership and regeneration rules.

Verification:

| Command/check | Result |
| --- | --- |
| `mise run check` | Pass: 4 Node tests, 4 native TALA runs, 2 Chromium comparison self-tests, 18 valid mise tasks and tracked/staged whitespace checks |
| `mise run test:native:corpus` | 145/147 pass from `examples/`; Twitter and WCC still fail on upstream remote-image DNS/HTTP errors. No cases skipped or thresholds changed |
| `mise exec -- pnpm install --frozen-lockfile` in Studio | Pass with its existing pnpm 11.25.0 selection; 751 packages installed, lockfile unchanged. Exposed as `mise run app:setup` |
| `mise exec -- pnpm exec tsc --noEmit --incremental false` in Studio | Pass; exposed as `mise run typecheck` |
| `mise exec -- pnpm run build` in Studio | Pass; existing large-chunk and route-classification warnings. Exposed as `mise run build` |
| `mise run test:app` | All three imported document/compaction/content assertion scripts pass, including TALA, imports, rich content and all three layout engines |
| `mise exec -- pnpm run lint` in Studio | Fails: 56 errors, 3 warnings. Rules were not relaxed; details in `artifacts/app-lint.json` |
| `mise run dev` plus one-off Chromium assertions via `mise exec -- node --input-type=module` | Pass: loopback startup, 4 initial nodes, TALA status, source edit to 5 nodes, reload persistence, no page errors. Fresh isolated browser profile; no existing user diagram touched |
| `mise run clean` | Pass; removed the checkout-local download store and generated output, preserving dependencies/state. Current reports retained separately |
| Direct byte comparison and local Markdown-link audit | All 79 file/64 archive contents match upstream; all local links in 7 current guidance documents resolve |
| `git -C imports/d2-architecture-studio status --short` | Clean after install/build/tests/smoke; original source commit unchanged |

Chromium requires execution outside the macOS sandbox because its Mach-port registration is denied inside it. The checks passed on the permitted rerun; no browser flags or comparison thresholds were loosened. App installation likewise needed access to Corepack's user cache and the package registry.

Fresh results live under ignored `artifacts/`: `native-corpus/`, `native-corpus-run.txt`, `app-lint.json`, `app-smoke.json`, `app-smoke.png`, and the fast comparison reports. `clean` removes these when explicitly run; they are not source fixtures. User-wide tool/browser caches were left untouched.

Changed outer files: `.gitignore`, `README.md`, `AGENTS.md`, `mise.toml`, the three existing documents, `imports/README.md`, the consolidated `examples/` tree, `tests/examples.mjs`, `tests/native-render.test.mjs`, new inventory/cleanup tests and `scripts/clean.mjs`. Existing outer package/lockfile, Playwright thresholds and CI workflow were preserved. The outer repository still has no commits and its source files remain untracked; nothing was staged, committed, pushed or published. The imported Studio has no source diff.

Next: pin native-source/JS/WASM/font correspondence and turn the feature inventory into executable capabilities before expanding prototype behavior. Repair the existing lint baseline in a separate scoped change; resolve or faithfully vendor the broken remote assets without accepting partial native output. Then agree the web mapping and connect actual React scenes to parity CI. The smoke check does not certify every interaction, all upstream Go cases, or React rendering parity. GitHub CI has not been run, and the combined imported app gate remains red because of lint.
