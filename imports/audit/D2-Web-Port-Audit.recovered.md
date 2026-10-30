> Recovered on 30 October 2026 from the original generator in build history, without executing it. This is not a byte-for-byte copy of the original attachment. Two generated lists are missing and marked below. Historical findings and validation claims have not been rerun.

# D2 web port: source audit and implementation map

Date: 30 October 2026. Status: first source-audit pass; implementation proposals are not yet approved decisions. No application changes or deployment were made for this audit.

## Scope and evidence

The objective is faithful D2 behavior in a web editor with React components. D2 source is authoritative; Studio must not silently invent layout, style, inheritance, or editing semantics. Viewport pan/zoom and selection are editor state, not diagram semantics.

This document is a map for the next joint design discussion, not a claim that every D2 feature has been reverse engineered or tested. A symbol inventory locates behavior; executable cases are needed to establish its semantics, interactions, and browser parity.

Two baselines must remain separate:

- Installed Studio package: `@d2lang/d2` **0.1.34**; runtime reports **D2 v0.9.0**. The local installed declarations and actual worker were inspected.
- Upstream source checkout: **6a7b4837838a3907604a1d9eec57ee98b6f3cd01**, retrieved from the official repository. This is current upstream, not a proven source match for the installed WASM. New upstream features must not be attributed to the deployed binary without probes or a reproducible matching build.

TALA is open source under MPL-2.0 and bundled since D2 0.9.0. The earlier assumption that its internals might be unavailable is corrected. Official announcement: https://d2lang.com/blog/tala-is-open-source/ ; release notes: https://d2lang.com/releases/0.9.0/ .

## Pipeline map

| Stage | Source boundary | Owns | Web mapping proposal |
|---|---|---|---|
| Source workspace | `lib/memfs`, `d2js/d2wasm` | Entry path and importable file contents | Versioned virtual filesystem; preserve paths and file ownership |
| Parsing | `d2parser`, `d2ast` | Syntax, comments, block strings, source ranges and diagnostics | Reuse Go parser; expose parse-only operation if necessary; no regex parser |
| Intermediate compilation | `d2ir` | Expansion and resolution machinery | Keep inside WASM; test classes, variables, imports, globs and boards here |
| Semantic compilation | `d2compiler` | Validated graph, attributes, references, configuration | Preserve compiler graph alongside rendered target; inspect provenance before editing |
| Defaults, themes, dimensions | `d2lib`, `d2graph`, `lib/textmeasure`, `d2renderers/d2fonts` | Effective config, text dimensions, shape sizing | Use compiler metrics first; do not resize or scale text silently |
| Nested layout orchestration | `d2layouts` | Extraction/reinsertion of special subgraphs, grids, sequences and near placement | Reuse orchestration; selecting TALA does not mean every specialized diagram bypasses this layer |
| Core placement and routing | `d2dagrelayout`, `d2elklayout`, `d2talalayout` | Node positions, ports, routes and label placement | Reuse WASM; add narrow bridges only where needed |
| Export model | `d2exporter`, `d2target` | Target shapes, connections, boards, styles and geometry | Lossless typed adapter rather than reducing everything to four service types |
| Rendering | `d2renderers/d2svg` and helpers | Shape paths, text, effects, arrowheads, paint order, bounds | Reference renderer is the visual oracle; React renderer needs an explicit parity contract |
| Source editing | `d2oracle`, `d2format` | Structural edits and formatted source | Evaluate exposing native operations through WASM before extending custom source rewriting |
| Editor services | `d2lsp`, raw WASM exports | Completion, reference ranges, board lookup | Surface through worker adapter; verify installed build support individually |
| Output products | renderers, CLI/export paths | SVG, animation and other exports | Audit each API separately; a CLI capability does not imply a JavaScript API capability |

`d2compiler.Compile` explicitly calls parser → IR compilation → graph compilation. `d2lib` then applies config/defaults, theme, dimensions, nested layout, export and recursive board compilation. Thus compilation, layout and rendering are related but distinct operations.

## Feature-family implementation register

Every row must eventually have an enumerated case list, source references, expected output, browser tests, interaction tests and a support status. “Compiler-backed” below means reuse D2; it does not certify current Studio support.

| Family | Behaviors to dissect | Proposed web owner | Important interactions to prove |
|---|---|---|---|
| Lexical syntax | Quoting, escaping, identifiers, comments, semicolons, maps, arrays, block strings | D2 parser + source editor | Unicode UTF-16 ranges; incomplete input; delimiters inside labels |
| Object identity | Implicit creation, nested paths, parent references, labels versus IDs | Compiler + oracle bridge | Renaming a label must not accidentally rename identity |
| Connections | All direction operators, chains, indexed parallel edges, endpoints | Compiler + target renderer | Deletion/reconnection must preserve remaining indexes and references |
| Composition | Imports, selective/spread imports, variables, substitutions | Virtual FS + compiler | Editing an imported instance versus its definition; missing/cyclic imports |
| Reuse | Class definitions, multiple classes, precedence, explicit overrides | Compiler + inspector | Style classes are distinct from UML `shape: class`; inspect effective and authored values separately |
| Rules | Globs, recursive matching, filters, null/unset and declaration order | Compiler | Local edits may change many objects; compacting source can change meaning |
| Containers | Nested objects, sizing, boundaries and internal connections | Compiler layout + React scene | Global versus parent-relative coordinates; hit testing and clipping |
| Grids and proximity | Grid dimensions/gaps, near constants and references, direction | Layout orchestrator | Special nested layouts and engine-specific support |
| Boards | Layers, scenarios, steps, inheritance, folder-only boards | Compiler + board navigator | Board-specific edits and source provenance; no flattening of inheritance |
| Ordinary shapes | Entire source shape registry | Shape-specific React components | Border tracing, label/icon positions and connection attachment |
| Structured shapes | SQL tables, class fields/methods and constraints | Compiler + structured components | Column ports, row height, visibility and text metrics |
| Sequence diagrams | Actors, lifelines, groups, ordering and generated geometry | D2 sequence layout + dedicated renderer | Synthetic objects are not ordinary editable source objects |
| Rich labels | Plain text, Markdown, code languages and LaTeX | D2 metrics + renderer-specific parity work | React Markdown/KaTeX/highlight implementations are not automatically equivalent to D2 |
| Appearance | Theme, fonts, styles, fill patterns, opacity, shadows, 3D, multiple borders | Target model + renderer | Measuring and painting must agree; bounds include outside content |
| Edge presentation | Arrowhead variants, labels, endpoint labels, curves, dashes and animation | D2 geometry + SVG edges | Marker extents, stroke-dependent dimensions, exact label positions |
| Assets/interactivity | Image shapes, icons, links, tooltips and legends | Renderer + controlled asset loader | File/URL resolution, image sizes, browser constraints and interactive behavior |
| Renderer modes | Normal/sketch, newer upstream isometric, board animation | Explicit renderer capabilities | Do not equate current upstream support with installed package support |
| Diagnostics/runtime | Parse versus semantic versus layout errors, worker lifecycle | Worker adapter + editor state | Preserve last valid preview without presenting it as latest successful compile |
| Exports | SVG and each further output format/API | Dedicated export adapters | Native CLI availability is insufficient evidence for browser support |

## Exact registry inventory from inspected upstream

These lists are extracted from source, not inferred from UI presets. Registry membership does not imply universal applicability to every object or engine. Validation rules still need examination.

[Generated registry lists were not recovered in the original attachment. See the preserved generator and inspection evidence; regenerate only against the stated upstream revision.]

## Browser API boundary

Installed TypeScript declarations expose `compile`, `render` and `dispose`. Runtime prototype also contains `encode`, `decode`, `version`, `jsVersion`, plus internal worker-management methods. Do not treat internal methods as a stable integration contract.

`compile` accepts text or a virtual-filesystem request and returns `diagram`, `graph`, `renderOptions`, `fs`, and `inputPath`. The graph contains AST information. The exported target has positions, dimensions, styles, text metadata, routes, labels and boards; it should remain intact in the adapter.

Current upstream raw WASM registration additionally includes completions, parent lookup, reference ranges and board-at-position lookup. It contains deprecated object-order and ELK conversion helpers. These raw exports are a different surface from the standard JS worker class. They are not automatically callable through it.

Neither inspected standard wrapper nor raw registration provides the complete oracle editing facade. Proposed bridge candidates: `parse`, `format`, `create`, `set`, `rename`, `move`, `delete`, `reconnectEdge`, reference lookup and ID-delta results. These names describe a proposed bridge, not existing JS methods. Oracle itself must be characterized first, especially imports, boards and inherited declarations.

Cancellation also needs an API audit: ignoring a stale UI response is not cancellation of an expensive synchronous WASM compile. Worker disposal is available; request cancellation is not declared in the installed public API.

## TALA dissection

Current upstream has an architecture document and an explicit ordered stage pipeline. Its adapter translates D2 graph state into TALA-owned state, clones independent attempts, runs placement/routing/labeling, validates and scores candidates, then patches selected geometry back into D2. Per-source architecture documentation, cancellation/failure before final commit should leave the caller graph unchanged; this invariant still needs executable verification against the chosen version.

Subdomains: layout graph, grouping, proximity, trees, hierarchy, placement, placement costs, packing, loops, routing, labeling, quality, shape ports and label geometry. Reuse these in WASM rather than reimplementing them in JavaScript.

Ordered stages in the inspected upstream (duplicates intentionally retained):

[Generated ordered-stage list was not recovered in the original attachment. The historical audit reports 37 stages; this has not been revalidated here.]

Questions to resolve with fixtures before changing dragging:

1. Exact `top`/`left` coordinate frame under nesting, normalization and pinned containers.
2. Authored versus inferred width/height; how moving a container affects children and external edges.
3. Engine configuration precedence and which seed configuration is available in the selected binary.
4. Layout-plus-routing versus route-only adapter semantics; whether a browser bridge is required.
5. Fixed seeds, graph ordering, repeated compilation and reproducibility. Small source changes may legitimately produce large TALA changes.
6. Failure atomicity, work limits and response to stale/cancelled requests.

Do not substitute Studio Bézier paths for final TALA output. An optional drag ghost can be transient editor state; committed positions and routes must go through supported D2 semantics.

## Existing Studio divergence audit

| Current implementation | Evidence | Why it matters | Proposed disposition |
|---|---|---|---|
| Four service-oriented kinds | `app/page.tsx`, `lib/d2-document.ts` | Arbitrary D2 objects are classified into application presets | Presets may remain optional class templates; scene model must use actual target types |
| Saved `# @studio-position` comments | `app/page.tsx`, `endDrag` | D2 ignores these positions; Studio changes displayed geometry | Replace committed placement with native constraints after coordinate tests |
| Local replacement edge curves after movement | `app/page.tsx`, React edge renderer | Displayed routes can differ from compiler geometry | Final routes must come from D2; any gesture preview must be explicitly transient |
| Service card chrome and descriptions | React node JSX | Visual appearance includes application-added content | Separate optional Studio skin from a D2-faithful rendering contract |
| Override block and custom compaction | `lib/d2-document.ts`, `lib/d2-compact.ts` | D2 accepts redeclarations, but choice/order of edits is app-defined | Compare native oracle edits; prove side effects across glob/board/import cases |
| React Markdown, highlighting and KaTeX | `components/diagram-content.tsx` | Different parsing/rendering and metrics can alter output | Differential corpus; use compiler-backed content where possible; disclose remaining differences |
| Fit-to-box scaling | Rich component measurement wrapper | Hides metric differences by changing the apparent text size | Remove from faithful mode once measurement contract is correct |
| Explicit TALA preference outside source | `compileDocument`, saved layout state | App preference can override source configuration | Make effective config provenance visible; decide whether persisted engine is document data |
| Native preview sanitization and HTML embedding | `app/page.tsx` | Even native output passes through a modifying browser adapter | Test sanitized output and behavior; do not assume all-fidelity from using native SVG alone |
| Root-only visual mutation support | `change` handler | Other boards/imported definitions are not equally editable | Publish a capability map until native mutation/provenance support exists |

The audit does not remove these behaviors yet. Their intended replacement must be reviewed first. “No side effects” cannot be guaranteed by design prose; observable invariants and regression tests must define acceptable behavior.

## Proposed web architecture

A document store contains source files, entry path and explicit compile configuration. Separate session state contains selection, viewport and temporary gestures. Source is not regenerated wholesale from a reduced React model.

A worker adapter owns the pinned D2 WASM runtime and request versions. A compile snapshot retains the original compiler graph, target diagram, effective configuration, file revisions and diagnostics. The UI only commits results for the matching source revision.

A lossless scene adapter adds selection/provenance references without changing D2 geometry or appearance. Dedicated React components implement each supported target type; SVG edges consume compiler routes. Where HTML/CSS cannot faithfully paint a D2 feature, record the gap and discuss a geometry primitive bridge, embedded native fragment, or explicit unsupported state. None is silently treated as equivalent.

A mutation adapter calls characterized D2 oracle operations through a proposed WASM bridge. Apply edits atomically to affected source files, recompile, validate intended changes and retain undo snapshots. Native oracle use is preferable to custom semantics but does not eliminate the need for tests.

A reference-rendering harness compares native D2 with the React renderer using identical files, engine/options/fonts/seed and viewport scale.

## Verification plan and implementation order

| Order | Investigation/deliverable | Completion evidence |
|---|---|---|
| 1 | Freeze exact Go source, JS wrapper, WASM and font versions | Source/build mapping and hashes; distinguish upstream-only features |
| 2 | Enumerate parser, IR, graph and target schemas; expand this family register into individual cases | Machine-readable feature matrix; every applicable registry entry mapped |
| 3 | Characterize source editing and provenance | Oracle fixtures for each mutation across nested/imported/globbed/classed/board objects |
| 4 | Characterize metrics, layout, ports and routes, especially TALA constraints | Numeric snapshots, seed repeatability and route/bounds invariants |
| 5 | Specify renderer parity per shape/content/style | Native versus React geometry and visual comparisons; explicit tolerances |
| 6 | Joint decision on web bridges and representation gaps | Agreed implementation contract; no guessed fallback semantics |
| 7 | Implement incrementally behind feature capabilities | Feature fixture passes before UI claims support |

Test invariants should include: untouched source-file bytes remain unchanged; IDs/references remain valid; failed edits do not commit; undo restores exact file state; D2 standalone and web compile produce the same semantic target given equivalent inputs; rendering adds no hidden labels/transforms; import/class/glob propagation follows compiler behavior; no worker response from an older revision replaces the current one.

Comparison layers: parse/diagnostics, semantic graph, target geometry, visual output, mutation effects and round trip. Pixel equality alone cannot detect incorrect source ownership; semantic equality alone cannot detect clipped text.

## Validation performed in this pass

- Inspected the installed package declarations and runtime prototype.
- Queried actual runtime versions: D2 `v0.9.0`, JS `0.1.34`.
- Compiled and rendered `a: Alpha; b: Beta; a -> b` independently with Dagre, ELK and TALA. Each returned two shapes, one connection, graph AST and SVG output.
- Read official upstream pipeline, raw WASM registration, keyword/shape registries, oracle operation signatures and TALA architecture/stage definitions.
- Inspected current Studio compilation, mutations and persisted drag comments.

These are boundary smoke tests, not feature-parity certification. No full upstream test suite, browser differential suite, oracle bridge or complete individual-feature corpus was built in this pass.

## Source index

- [d2lib/d2.go](https://github.com/d2lang/d2/blob/6a7b4837838a3907604a1d9eec57ee98b6f3cd01/d2lib/d2.go)
- [d2compiler/compile.go](https://github.com/d2lang/d2/blob/6a7b4837838a3907604a1d9eec57ee98b6f3cd01/d2compiler/compile.go)
- [d2ast/keywords.go](https://github.com/d2lang/d2/blob/6a7b4837838a3907604a1d9eec57ee98b6f3cd01/d2ast/keywords.go)
- [d2target/d2target.go](https://github.com/d2lang/d2/blob/6a7b4837838a3907604a1d9eec57ee98b6f3cd01/d2target/d2target.go)
- [d2layouts/d2layouts.go](https://github.com/d2lang/d2/blob/6a7b4837838a3907604a1d9eec57ee98b6f3cd01/d2layouts/d2layouts.go)
- [d2js/js/index.d.ts](https://github.com/d2lang/d2/blob/6a7b4837838a3907604a1d9eec57ee98b6f3cd01/d2js/js/index.d.ts)
- [d2js/js/src/index.js](https://github.com/d2lang/d2/blob/6a7b4837838a3907604a1d9eec57ee98b6f3cd01/d2js/js/src/index.js)
- [d2js/js.go](https://github.com/d2lang/d2/blob/6a7b4837838a3907604a1d9eec57ee98b6f3cd01/d2js/js.go)
- [d2js/d2wasm/functions.go](https://github.com/d2lang/d2/blob/6a7b4837838a3907604a1d9eec57ee98b6f3cd01/d2js/d2wasm/functions.go)
- [d2oracle/edit.go](https://github.com/d2lang/d2/blob/6a7b4837838a3907604a1d9eec57ee98b6f3cd01/d2oracle/edit.go)
- [d2oracle/get.go](https://github.com/d2lang/d2/blob/6a7b4837838a3907604a1d9eec57ee98b6f3cd01/d2oracle/get.go)
- [d2layouts/d2talalayout/ARCHITECTURE.md](https://github.com/d2lang/d2/blob/6a7b4837838a3907604a1d9eec57ee98b6f3cd01/d2layouts/d2talalayout/ARCHITECTURE.md)
- [d2layouts/d2talalayout/layout.go](https://github.com/d2lang/d2/blob/6a7b4837838a3907604a1d9eec57ee98b6f3cd01/d2layouts/d2talalayout/layout.go)
- [d2layouts/d2talalayout/internal/engine/pipeline.go](https://github.com/d2lang/d2/blob/6a7b4837838a3907604a1d9eec57ee98b6f3cd01/d2layouts/d2talalayout/internal/engine/pipeline.go)
