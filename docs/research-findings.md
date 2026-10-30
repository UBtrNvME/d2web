# D2 web surface: research observations

Date: 30 October 2026. Experimental evidence and source findings, not an accepted architecture or complete capability claim. See the [plan](../tasks/plan.md) and [open tasks](../tasks/todo.md). No production runtime or imported application code was changed.

Latest user direction: prefer native HTML/JavaScript/CSS/SVG as the foundation for future React components. React Flow is studied specifically for connection drawing, not as the intended foundation. Historical adoption comparisons below remain useful evidence but do not override this preference. The follow-up batch uses lower-cost GPT-6 Luna workers and independent coordinator/peer review. Plain modules/data/DOM primitives, framework bindings and optional consumer skins must retain explicit ownership and lifecycle boundaries.

## Current state

- Done (bounded): R0 framework comparison (React Flow, JointJS Core, native SVG connections) and R1 native identity/source association.
- Partial: R2 text (native font/browser controls only, no rich content), R3 host lifecycle (mount/dispose quick check), R4 native operations, R6 consumer (packed module, Card/Tailwind, one explicit resize round trip).
- Open: Checkpoint A review with the user (overdue; R3/R6 ran ahead of it) and R5 contracts/stack selection. No architecture is accepted.
- Next decision: the user reviews R1/R2 evidence at Checkpoint A and chooses what to test next (changed-size consumer contract, richer text/content, or hostile-CSS lifecycle). Open research leads: the subset-font metric difference, richer text and object-specific consumer dimensions. A passing plain-button probe cannot substitute for a real external consumer/shadcn test. Do not promote the probes into public APIs before then.
- Source is in the initial commit (`bf85ee0`); later research changes are uncommitted. Nothing is pushed or published.
- `mise run check` now depends on `reference:fetch` (imports/d2 must be a git checkout at D2 v0.9.0, commit d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda; otherwise remove imports/d2 and rerun `mise run reference:fetch`) and also runs `test:research:identity`, `test:research:operations`, `test:research:text`, `test:research:connections` and `test:research:composition`. The text probe asserts the 1.640625 native-subset-versus-scene-TTF advance gap. Test helpers (nativeArgs, pathData, goRun/goProbe) are centralised in tests/examples.mjs. Check counts in the older entries below are historical.

## Independent investigation

### Latest package/theme/sizing check (no workers)

`mise run test:research:consumer` passes three Chromium checks: actual Card/Tailwind 4.2.1 light/dark tokens (background, foreground, border, radius, spacing); a packed framework-free ES module imported by a separate consumer; and two real native-versus-React image comparisons, base and resized geometry. Existing image/bounds thresholds are unchanged. The native module has no React/CSS dependencies and imports in Node without a DOM; React/Card/Tailwind remain consumer-side. It is an experimental tarball, not a released SDK.

The browser measures a 160×80 Card and explicitly requests native D2 compilation through the test transport. The compiler receives ordinary source dimension overrides, computes a new route, and the native slot/path update only after success. Results match the independently rendered [sizing case](../examples/research/sizing/main.d2); a rejected negative-size update retains the valid path. This demonstrates one explicit measurement-to-native-layout round trip, not automatic arbitrary-content layout or live browser-WASM API integration. The test transport invokes the native Go probe; the browser-WASM boundary remains separately proven only for the earlier geometry fixture. The faithful image candidates use the existing GeometryScene React renderer, not the custom Card skin or packed mount fixture.

`mise run test:native:corpus` was also rerun: **145/147 pass**, with Twitter/WCC failing original remote assets (CloudFront DNS and Wikimedia HTTP 400). Partial outputs remain failed references; nothing was skipped or repaired with candidate output. This is native corpus coverage, not 147 web parity comparisons. General corpus web pages still do not exist, so complete corpus web parity cannot yet run. Logs: artifacts/research-consumer/native-corpus.log. Focused outputs, tarball, package metadata, compiled CSS and paired image fixtures: artifacts/research-consumer/.

Scope: two new research files, one local sizing input, one mise task and documentation; no workers, production changes, new dependencies, imported-source edits, threshold changes, commits or publishing. The next meaningful gap is generalizing the explicit dimension/representation contract and producing more actual web scenes, rather than repeating the same two passing comparisons. Full SDK packaging, all theme/component combinations and full text/shape/corpus parity remain open.

Final validation: `mise run check` passed its existing native/WASM/Chromium/TypeScript gates and all 31 task definitions; changed-document links/whitespace and new script syntax passed; imported Studio remains clean. Tailwind was used through its [documented PostCSS integration](https://tailwindcss.com/docs/installation/using-postcss), with explicit source scanning and consumer-owned [shadcn theme variables](https://ui.shadcn.com/docs/theming). The native corpus's two asset failures remain visible in the saved log; its partial images were not used as parity references.

Quick follow-up at the user's request: `mise run test:research:host` passes one focused Chromium check of a plain native ES-module mount/dispose fixture with two instances and a React StrictMode/portal consumer using the actual imported shadcn Card. D2's fixed path and 56px slots remain intact; removing instance A removes its DOM and native click listener (dispatch on the retained detached wrapper no longer calls back), while B still responds. Fresh test storage remains empty and requests stay within the fixture origin. Source and artifacts are in tests/research-host.mjs, tests/browser/research-host.spec.mjs and ignored artifacts/research-host/.

This is a consumer-ownership/lifecycle check, not an exported library API. The Card is borrowed read-only from the local Studio import and bundled with the same root React; inline consumer styling is explicit. Full Tailwind/theme fidelity, packaged SDK consumption, arbitrary dimensions, all resources/listeners and full parity remain unverified. No production or dependency files changed. Per the user's quick-check direction, font investigation and broad corpus/parity reassessment were not repeated. Next test changed-size consumer content/native relayout before selecting that contract. The later research changes remain uncommitted (the source is in the initial commit); this update adds two research files, one mise task and linked documentation only.

Verification: `mise run test:research:host` passed its focused Chromium case; the short `mise run check` baseline also passed (four infrastructure tests, four native cases, native/Node-WASM geometry, two decoder tests, four existing Chromium checks, TypeScript and 30 task definitions). No full corpus/parity or imported-app gate was run.

At the user's request, separate workers examined web frameworks, challenged all three proposed D2 boundaries, and executed browser composition experiments with fresh briefs. The coordinator independently probed native identity/source association. The boundary reviewer then executed native-operation/measurement experiments and reviewed the identity and composition probes. Agreement is not proof; the observations below distinguish documentation, runtime evidence and remaining hypotheses.

## Framework comparison: documentary findings

These official docs are moving references checked during this investigation; they do not pin installed experimental versions. A framework's documented capability is not evidence of compatibility with D2.

| Question | React Flow | JointJS |
| --- | --- | --- |
| Custom presentation | Consumer React nodes receive identity/data inside interactive wrappers: [custom nodes](https://reactflow.dev/learn/customization/custom-nodes) | Current first-party React binding supports custom elements, style-neutral HTMLHost and styled HTMLBox: [elements](https://docs.jointjs.com/react/features/elements/) |
| Native route preservation | BaseEdge accepts SVG path data; using React Flow's route helpers is not compulsory: [BaseEdge](https://reactflow.dev/api-reference/components/base-edge) | Links have endpoints/routers/connectors; custom connectors can supply path data. Current renderLink is experimental: [links](https://docs.jointjs.com/react/features/links/), [connectors](https://docs.jointjs.com/api/connectors/) |
| Dimensions | DOM measurement and handles require coordination with supplied dimensions: [node](https://reactflow.dev/api-reference/types/node), [handles](https://reactflow.dev/learn/customization/handles) | HTML content normally influences model size; explicit size/useModelGeometry can fix the footprint: [custom elements](https://docs.jointjs.com/react/getting-started/custom-elements/) |
| Nesting/ordering | Parent-relative coordinates and ordering rules require adaptation; model parenthood is not nested DOM: [subflows](https://reactflow.dev/learn/layouting/sub-flows) | Embedding affects child positions and embedded-link vertices: [grouping](https://docs.jointjs.com/learn/features/containers-and-grouping/) |
| State and interaction | Controlled nodes/edges are possible; built-in keyboard/focus behavior can affect viewport: [API](https://reactflow.dev/api-reference/react-flow), [accessibility](https://reactflow.dev/learn/advanced-use/accessibility) | Controlled cells are possible; default connection validation/interaction policy needs review: [controlled mode](https://docs.jointjs.com/react/data-management/controlled-mode/), [links](https://docs.jointjs.com/react/features/links/) |
| Accessibility | Built-in facilities save work but defaults still need an explicit consumer policy | Official custom-element docs leave roles, focus order and keyboard behavior to the application |
| Adoption cost | React dependency and an additional diagram state/DOM model; adapting it may save interaction work | SVG-oriented model and React integration; experimental link customization and additional graph policy need testing |

Source licensing/dependency references: [React Flow manifest](https://github.com/xyflow/xyflow/blob/main/packages/react/package.json), [system manifest](https://github.com/xyflow/xyflow/blob/main/packages/system/package.json), [JointJS React manifest](https://github.com/clientIO/joint/blob/master/packages/joint-react/package.json), [JointJS licensing](https://www.jointjs.com/license). The documentary comparison identifies MIT for React Flow and MPL-2.0 for JointJS core/React; paid JointJS+ facilities must not be counted as core. Recheck exact installed versions and terms before adoption.

[Cytoscape.js](https://js.cytoscape.org/) offers another useful comparison: graph-focused, canvas-based presentation with preset geometry. Inference: graph analysis may benefit, but arbitrary accessible/selectable HTML and D2 painting would still need another presentation boundary. It is not rejected through a local experiment and is not a selected dependency.

[shadcn's open-code/composition model](https://ui.shadcn.com/docs) supports investigating consumer-owned presentation rather than a mandatory core design system. Actual shadcn components, portals, themes and changed-size layout remain unverified here.

All three options remain under consideration: adopt a diagram framework, build a bounded adapter over one, or implement D2 presentation while borrowing platform patterns. Frameworks can save accessibility, event and viewport work; custom presentation avoids a competing graph model but leaves that engineering to d2web/consumers. Neither tradeoff wins from documentation alone.

## R0: actual React Flow adapter experiment

Explicit setup: `mise run research:reactflow:setup`. Reproduce with `mise run test:research:reactflow`. This uses actual @xyflow/react 12.12.0 (package license MIT) under ignored artifacts/research-reactflow/, root React/ReactDOM via build aliases, native target positions and the native scene's adjusted connection path. Root dependencies/lockfile are unchanged. Setup disables installation scripts and automatic peer installation. The scratch pnpm lockfile preserves this local run's resolution, but clean removes it; a later regeneration can select newer compatible transitive versions. This is not a published package or adoption decision.

The bounded Chromium test passed with two fixed-size custom HTML nodes and a native straight connection. At viewport translation (30,30), zoom 1, source native (0,3), 56×36 appeared at (30,33), 56×36; target native (168,0), 42×42 appeared at (198,30), 42×42. At zoom 2 their positions/sizes followed the same viewport transform. The supplied native path M59.5 21 L161 21 remained byte-identical after interactions, rerender and zoom; the existing source DOM element was retained.

React Flow calculated handle endpoints (58.5,21) and (165.5,21), which differ from the native painted line's endpoints. The custom edge deliberately uses the native path rather than the computed endpoints. This shows one way to preserve native route geometry; it does not prove arbitrary markers, labels, curves or nested paint order.

The first interaction run exposed a framework default: disabling node selection/dragging gives wrappers pointer-events:none. Explicit pointer-events:auto on consumer content restored interaction; user-select:text enabled text selection. The final probe asserts button click/Enter identity, pointer text selection, no position/edge/viewport changes from arrow key/pane drag/wheel, expected dimension notifications, and no browser errors/warnings. These required CSS properties express deliberate browser interaction policy, not replacement D2 geometry or appearance.

Reports record installed package dependencies, observed wrappers and transforms. Screenshots were visually inspected. No actual shadcn component, faithful shape paint/marker/text comparison, changed-size relayout, external package consumption, nested diagram, portal, multiple-instance or disposal proof was performed. JointJS remains a documentary candidate and has not been installed or locally compared. React Flow is feasible for this bounded adapter; declaring it the full renderer would exceed the evidence.

## R1: native identity and source association

The follow-up native connection, JointJS Core and text results are recorded below. Their tests use browser primitives or framework-free core code; they do not promote the earlier React experiment into a required foundation.

Reproduce with `mise run test:research:identity`. Inputs are [research/identity](../examples/research/identity/main.d2), existing [imports](../examples/imports/main.d2) and [boards](../examples/boards/main.d2). The probe compiles with pinned local D2/TALA seed 1, UTF-16 source positions, matching Go runtime and readonly module dependencies. It builds each board's scene separately, without mutating the target tree. Generated reports live in ignored artifacts/research-identity/.

Observed across three workspaces/seven boards:

- Repeated native compilations and Node/WASM executions produce equal **reported projections**: board paths, selected semantic/property/source fields, target IDs and flat scene ID/type records. This does not compare full scene geometry, paints, fonts or assets.
- Root, independent layer and inherited scenario all contain the lexical ID local. Identity needs board context; rename/revision stability is not established.
- A local object's fill originates in a class declaration, stroke in a glob declaration and label in an object/override declaration. Its ordinary object reference list does not include the class property declaration. Effective property ownership cannot be reduced to one source span per object.
- An imported child's label/fill originate in shared.d2 on the base board; a scenario override changes the fill owner to main.d2 while the label still belongs to shared.d2.
- Target object/edge IDs have scene matches for the inspected cases. The scene also contains anonymous paint nodes and generated label/arrowhead nodes. Existence of an ID match is not proof of a unique/reversible semantic association.
- Malformed input emits no partial report.

Two adversarial cases were also run in native and Node/WASM. An opacity-zero object retains semantic label hello and target/group identity but emits no TextRun: deriving semantic text solely from paint primitives would lose that information. A proposed authored/generated label-ID collision **did not reproduce**: the authored key retains quotes in its AbsID and differs from the generated label ID. The initial collision assertion failed, prompting correction of the hypothesis and retention of a no-collision test. This result neither proves nor disproves all possible identifier collisions.

Relevant source: [graph references and Scalars](../imports/d2/d2graph/d2graph.go), [target](../imports/d2/d2target/d2target.go), [scene](../imports/d2/d2renderers/d2scene/scene.go), [scene builder](../imports/d2/d2renderers/d2scenebuild/build.go). Native graph JSON omits several editing pointers/relationships; raw serialization is not automatically an editing bridge. The experiment's JSON is diagnostic, not the public schema.

## Browser composition: bounded primitive experiment

Reproduce with `mise run test:research:composition`. This first regenerates the existing geometry scene, then runs [research-composition.spec.mjs](../tests/browser/research-composition.spec.mjs). Reports/screenshots/HTML live in artifacts/research-composition/.

The experiment uses actual D2 geometry from the proven label-free fixture, plus synthetic HTML text/button content. It compares foreignObject and sibling HTML overlay at uniform scales 0.75 and 2 in Chromium 156.0.8078.4.

- Both placements preserve measured slot alignment with native node bounds and support pointer text selection, Tab focus, keyboard activation and pointer activation with an explicit source event ID.
- Host document button CSS reaches both placements. Neither topology alone provides styling isolation.
- Doubling HTML content dimensions leaves the native box/connection path unchanged, while the expanded card intercepts a sampled point over the route.
- Explicit overflow clipping removes the card from that sampled hit. This does not prove the underlying route receives an interaction.
- No page/console errors or network requests occurred in these synthetic fixtures.

This is not native text fidelity, actual framework/shadcn interoperability, screen-reader verification, browser-zoom coverage, lifecycle cleanup, export support or a measurement-to-layout handshake. Full R2 and R3 remain open.

## Native operations and custom measurement

Reproduce with `mise run test:research:operations`. The [native probe](../tests/research-operations.go) compiles a fresh workspace for each operation, records formatted AST before/after, and compares the diagnostic results with Node/WASM. Reports live in artifacts/research-operations/.

- Set(local.style.opacity, 2) returns an error and nil updated graph, **but the supplied graph's AST has already changed** to include the invalid opacity. Native operation reuse alone does not provide a transactional consumer API. A wrapper must work on disposable state and publish only validated results, or establish another proven transaction mechanism.
- A successful root fill operation also changes the supplied AST. Formatting is normalized; byte-preserving edits are not established.
- Setting an imported child's fill inserts a local override, rather than editing the imported file.
- A scenario label edit changes only that declaration in this case. The oracle expects the name-only path changed; the graph's board path additionally contains scenarios. Board path representations must not be treated as interchangeable.
- Two text premeasurement entries with the same text/style key but requested sizes 100×20 and 240×80 both resolve to 100×20. Existing premeasurement lookup does not establish independent custom-card measurement by object identity.

This is evidence about the native API on named cases, not an existing d2web transaction bug or proof that a new measurement bridge is impossible. Chromium source-operation execution, complete recompiled output/layout comparison, imported-file modification, undo, concurrent/stale requests and UTF-16 ranges after editing remain open.

## Implications for the competing hypotheses

| Hypothesis | Evidence so far | Remaining falsification |
| --- | --- | --- |
| Scene-first | Useful prepared paint data; scene IDs can match authored objects in the inspected projection | A bare paint tree lacks sufficient semantic text/property provenance/board context. Test an explicit association supplement rather than assuming scene sufficiency |
| Semantic-first | Native graph retains useful contributing declarations | Target data does not contain all paint geometry. Quantify duplicated calculations and prove default paint/text fidelity |
| Combined | Selected semantic/paint associations can be found | No unique/stable public join contract is proven. Test rename, parallel-edge deletion, structured/generated content and late results |

No full stack is accepted. Current evidence argues against calling raw scene JSON, raw graph JSON, or existing text premeasurement a complete web/editor contract. A faithful default plus opt-in consumer representation remains the requirement; fixed footprints, explicit overflow and native relayout are separate behaviors to evaluate.

## Native connection drawing without a framework

Reproduce with `mise run test:research:connections`. The [probe](../tests/browser/research-native-connections.spec.mjs) uses the actual native path and diamond geometry/translation from geometry.json, without React, React Flow or JointJS at runtime. Reports/screenshots live under artifacts/research-native-connections/.

Installed React Flow 12.12.0 BaseEdge source renders a visible SVG path and another path with the same d, zero stroke opacity and a default interaction width of 20. Its wrapper supplies edge identity, event/state and accessibility policy separately. See the [official BaseEdge API](https://reactflow.dev/api-reference/components/base-edge) and [SVG pointer-events semantics](https://www.w3.org/TR/SVG2/interact.html#PointerEventsProp). The transferable pattern is native SVG paint plus a separate hit target, not a dependency on React Flow's graph model or routing helpers.

The native-only experiment explicitly uses a 4-unit painted stroke and a 24-unit transparent hit stroke. Across the independent 2×2 matrix of SVG viewport scale 1/2 and device scale factor 1/2, a point 7 document units from the route hits the edge; a point 13 units away initially does not. Inverse screen transforms recover document coordinates within pointer CSS-pixel quantization. A source HTML button reports source identity separately.

An initial review caught a false-positive update check: CSS rules could override changed SVG presentation attributes. The corrected probe puts initial paints/widths in attributes, checks computed green paint and 32px hit width after setAttribute, and verifies that widening the hit target makes the formerly outside point hit the edge. Native path, arrow translation and existing paint DOM node remain unchanged. Hit width is an explicit experiment policy, not a proposed d2web default or a change to D2's visible stroke.

This proves the bounded native browser mechanism for one straight edge and polygon arrow. It does not establish full native paint order, curved/overlapping edge hit policy, label masking, touch/keyboard accessibility, lifecycle cleanup or full parity. A future React binding may render these same primitives or mount an isolated owned subtree; the shared contract must not permit React and imperative code to update the same DOM nodes.

## JointJS Core comparison without React

Explicit setup: `mise run research:jointjs:setup`; reproduce with `mise run test:research:jointjs`. Actual @joint/core 4.3.4 (package license MPL-2.0) is installed only under ignored artifacts/research-jointjs/ with scripts/automatic peers disabled and workspace ignored. It has no React runtime in this experiment. The ignored scratch lockfile has the same clean/regeneration limitation as the React Flow experiment.

JointJS [Paper](https://docs.jointjs.com/api/dia/Paper/) is a view over its graph and uses SVG; [connectors](https://docs.jointjs.com/api/connectors/) turn route information into path commands. The experiment supplies a custom connector returning D2's adjusted path rather than treating a JointJS route as authoritative. Its serialization changes whitespace but preserves the measured path geometry: x=59.5, y=21, width=101.5, height=0. Fixed boxes are 56×36 at (0,3) and 42×42 at (168,0).

ForeignObject hosts HTML buttons with pointer and keyboard activation. One button pointer action also emits a JointJS cell:pointerdown even with interactive:false. Disabling cell movement therefore does not suppress all event propagation; consumer event ownership must be deliberate. Host CSS with !important changes computed SVG fill/stroke width while geometric boxes/path remain fixed. The test asserts effective computed styles rather than only presentation attributes.

Structural cleanup confirms Graph cell count zero and detached Paper DOM after explicit removal/clear. It does not establish full listener/observer/memory cleanup, initialization failure handling or repeated-mount behavior. This single-scale, straight-path comparison does not prove D2 marker/shape/text fidelity, nested boards, changed-size content, hostile-host isolation or library packaging. It is evidence of reusable patterns and adaptation cost, not a dependency/adoption recommendation.

## R2: native fonts and browser text controls

Reproduce with `mise run test:research:text`, using [the local Latin label fixture](../examples/research/text/main.d2), [native exporter](../tests/research-text.go) and [browser controls](../tests/browser/research-text.spec.mjs). The exporter compiles with TALA seed 1 and emits three native TextRuns, positioned glyphs, run ink, target label dimensions, actual scene TTF font bytes and native SVG with its own embedded WOFF faces. This batch tests native execution and Chromium, not Node/Chromium-WASM text equivalence.

The repeated label is office affine café. The bold scene face contains 247,784 bytes; the edge's italic face contains 109,604 bytes. The browser comparison uses the bold source label only. Explicit [FontFace loading](https://drafts.csswg.org/css-font-loading/#fontface-interface), exact loaded-face checks and computed family/size/weight/style/kerning/ligature/spacing records distinguish assets from fallback and CSS descriptor differences. Native style bold maps to normal CSS font-style plus weight 700; copying bold into font-style would be invalid.

Chromium 156.0.8078.4 observations, in CSS/document units:

| Measurement/control | Advance or width |
| --- | --- |
| HTML text range, scene TTF | 115.578125 |
| SVG text, same scene TTF | 115.578125 |
| Same physically bold TTF registered with weight 400 | 115.578125 |
| Full pre-encoded bundled face, matching descriptors | 115.578125 |
| Fresh conversion of the complete scene TTF to WOFF | 115.578125 |
| Native SVG embedded WOFF text | 117.21875 |
| Standalone SVG using that native WOFF face/descriptors | 117.21875 |
| TTF with liga/clig disabled | 116.375 |
| WOFF with liga/clig disabled | 117.21875 |
| Sum of the scene's 16 glyph advances for 18 characters | 115.59375 |
| D2 target label box and scene-provided run ink width | 117 |

The native-minus-scene-font browser advance difference is 1.640625. Full-font conversion to WOFF preserves the TTF's measured advance, while the subset-produced face differs. This localizes the difference to the subset-produced face in this Chromium/case, rather than the WOFF format or descriptor weight alone. Ligature controls change the TTF result but do not explain the full difference. The specific table/metric change and which rendering is correct remain unproven. Do not compensate by stretching/fitting text or silently changing CSS; choosing an authoritative web presentation reference must account for the discrepancy.

Source trace: [Font.GetEncodedSubset](../imports/d2/d2renderers/d2fonts/d2fonts_common.go) copies the bundled TTF, subsets it and converts it to WOFF for the [native SVG renderer](../imports/d2/d2renderers/d2svg/d2svg.go). The [scene builder](../imports/d2/d2renderers/d2scenebuild/build.go) retains the full TTF and native shaping data. In this case the subset face is 2,136 bytes and has a wOFF signature; fresh full conversion is 111,408 bytes, also wOFF. The full pre-encoded bundled URI is labeled application/font-woff but its 247,784-byte payload has an SFNT signature like the scene TTF. The report records actual bytes/signatures rather than trusting the URI's media label. These facts do not establish a general upstream bug or complete source/binary correspondence.

Tests compare matching controls (HTML versus scene-font SVG, native SVG versus its face control, alternate scene-font registration), rather than declaring the two rendering assets equivalent. All measured discrepancies are retained. Browser getBBox/range metrics, D2 run ink/label boxes and glyph advances are different quantities; their numerical proximity is not pixel/ink parity. Playwright selectText confirms programmatic selection of HTML/SVG text, not pointer drag selection or full accessibility. No rich content, non-Latin fallback, pixel comparison or general text renderer was implemented.

## First batch execution handoff

Completed this research batch: independent framework/source review, R1's bounded association projection, browser primitive composition, native-operation/measurement characterization and an actual React Flow adapter experiment. R0/R1's bounded research tasks are checked; R2/R3/R4 broader acceptance, R6 external library/shadcn composition and R5 stack selection remain open. No architecture decision was accepted.

Verification commands and final results:

| Command | Result |
| --- | --- |
| `mise run test:research:identity` | Pass: three workspaces/seven boards, repeated native vs Node/WASM projection equality; invisible-label and noncollision counterexamples |
| `mise run test:research:operations` | Pass: native/Node-WASM observation equality, successful/rejected/imported/scenario operations and equal-text premeasurement ambiguity |
| `mise exec -- node tests/research-reactflow.mjs --setup` | Pass: explicit isolated pinned installation; exposed as research:reactflow:setup |
| `mise run test:research:composition` | Pass: four Chromium cases at two scales/topologies; regenerates existing geometry boundary first |
| `mise run test:research:reactflow` | Pass: one Chromium framework case; regenerates geometry and builds the actual adapter fixture |
| `mise run check` | Pass: four infrastructure tests, four native cases, one native/Node-WASM case, two decoder tests, four existing Chromium tests, strict TypeScript and all 25 task definitions |
| Additional checks | Eight guidance-document local-link/whitespace audit, new JavaScript syntax checks and Go formatting passed; imported Studio remains clean |

Independent code review found no blocking flaw; evidence wording was narrowed to projection equality, keyboard activation (not general accessibility), removal of the card from a sampled hit (not proof of route interaction), and supplied handles (not a proven universal requirement). Original comparison thresholds were unchanged. Chromium required permitted execution outside the macOS sandbox. Failed research assumptions and the initial blocked-pointer interaction are retained above; passing tests now assert the actual observations.

Changed files: seven new probe/test files under tests/, four authored cases under examples/research/identity/, five mise research tasks, this findings document and linked guidance/task status. Production src/, both imported source copies, root dependency manifest/lockfile, Playwright thresholds and CI remain unchanged. Research dependencies/reports/screenshots are ignored artifacts and are removed by clean. At the time, the outer source was untracked in an unborn repository (it is now in the initial commit); nothing was pushed or published.

Full upstream corpus, separate imported-app lint/build gate, GitHub CI, native text/font fidelity, JointJS runtime behavior, actual shadcn/external package use, complete editing output equivalence and lifecycle cleanup were not verified in this batch. Existing known corpus/app limitations remain open. Resume from this ledger and current Git state; do not promote the probes into public APIs without the remaining experiments and decision review.

## Current handoff: native browser foundation follow-up

Accepted user direction: prefer native HTML/JavaScript/CSS/SVG and framework-independent contracts as a foundation for later React components. React Flow is connection-drawing prior art, not the intended foundation. JointJS is comparison material. Reskinning and integrations are explicit consumer layers. No mandatory Web Components, Shadow DOM, virtual DOM or new renderer architecture is selected. On the user's cost instruction the newly started workers were interrupted before they produced files, and the bounded work resumed with GPT-6 Luna workers; coordinator and peer review remained in place.

Implemented research only: six new probe/test files (native connections, JointJS build/browser and text Go/Node/browser), one local text fixture, four mise research tasks, and updated guidance/findings. Production src/, root package/lockfile, both imported source copies, CI and image thresholds were preserved. JointJS Core is an ignored scratch dependency with an explicit setup command. At the time, the outer source was untracked in an unborn repository (it is now in the initial commit); nothing was pushed or published.

Final verification:

| Command | Result |
| --- | --- |
| `mise run test:research:connections` | Pass: four independent viewport/device-scale combinations; computed paint/hit-width update and newly included hit point verified |
| `mise exec -- node tests/research-jointjs.mjs --setup` | Pass: isolated @joint/core 4.3.4 installation; available as research:jointjs:setup |
| `mise run test:research:jointjs` | Pass: one Chromium test for fixed bounds/native path, HTML interaction, effective host CSS and structural cleanup |
| `mise run test:research:text` | Pass: one native export test and one Chromium font-control/selection test, including full versus subset face controls |
| `mise run check` | Pass: four infrastructure tests, four native cases, one native/Node-WASM case, two decoder tests, four existing Chromium tests, TypeScript and all 29 task definitions |
| Additional verification | Current-document local links/whitespace, JavaScript syntax and Go formatting passed; Studio checkout remains clean |

All seven new focused research checks pass; this does not mean their hypotheses all succeeded or establish product support. Review corrected a CSS-versus-attribute update false positive, separated viewport/device scaling, removed an unconditional cleanup flag as evidence, distinguished programmatic selection from pointer interaction, fixed invalid font-style mapping, and added actual font-face/metric controls. No tolerance or existing assertion was weakened. Browser execution required permitted macOS sandbox escalation.

Next: characterize the specific subset-font discrepancy and richer content/source behavior, then native host mounting/disposal and an external consumer/React/shadcn ownership probe. Current evidence supports browser-native connection mechanisms and exposes native font/reference differences; it does not settle the complete data bridge, text renderer, consumer dimension handshake or public API. Full upstream corpus, imported-app gate and GitHub CI were not rerun. Full renderer parity, true resource cleanup, other browsers, arbitrary custom representations and actual external/shadcn use remain unverified.
