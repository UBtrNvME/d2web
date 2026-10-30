# Research plan: D2 as a web surface

Status: proposed experiments, 30 October 2026. Research precedes architecture selection. The user requested broad investigation with local validation; this plan does not approve a stack or public API. Tasks and checkpoints live in [todo.md](todo.md).

Research execution has begun under the user's automatic-research instruction. Current [findings](../docs/research-findings.md) include independent source/framework review, native/Node-WASM association and operation probes, and browser composition experiments. Read that evidence before following the original next-task wording below. Architecture acceptance and the remaining research tasks are still open.

## Purpose and constraints

Latest user direction: prefer native HTML/JavaScript/CSS plus browser SVG as the foundation for future React components. Study React Flow specifically for connection drawing/hit testing rather than adopting its React graph model. Continue JointJS and text/embedding experiments to learn from them; framework adoption is not the research objective. A framework-independent contract does not itself require Web Components, Shadow DOM, an imperative renderer under React, or a custom virtual DOM. Compare ownership choices from evidence. Bounded independent workers should use capable lower-cost models (currently GPT-6 Luna) with coordinator review.

Determine how the complete D2 pipeline can serve a programmable, interactive web surface. Future consumers include embedded diagrams and editors such as d2editor; Studio is a reference consumer. Fidelity includes language semantics, identity, source ownership, browser behavior and appearance, rather than pictures alone.

D2 remains authoritative for its language, styles/themes, measurement, layout and routing, including TALA. Preserve ordinary files, imports, boards and native operations. React is an accepted presentation option and the existing experimental binding, not a settled mandatory foundation. HTML/SVG are accepted browser primitives; their topology and division of responsibility remain open.

d2web must introduce no independent reskinning or application policy. Consumers control lifecycle and integrations. Investigate network, fonts, workers, event handling and cleanup explicitly: necessary browser effects require an explicit contract. No automatic persistence, telemetry, navigation, global styles or application gestures. Downstream skins must remain distinguishable from the faithful D2 baseline.

The user explicitly requires future library consumption and consumer-modified diagram representations using shadcn or similar components. Customization is not limited to editor chrome: investigate replacing node/content presentation itself. The faithful default must remain available, while a consumer can deliberately opt into another representation. That does not authorize d2web to silently change source, geometry or application state. Earlier restrictions requiring every appearance change to be expressed in D2 configuration are too narrow for this consumer extension requirement.

## Web diagramming prior art and library composition

Study frameworks as candidates and sources of design patterns, not automatic dependencies. Compare adopting a framework, using a bounded adapter, and borrowing patterns with no runtime dependency. Check exact versions, dependency/license terms and installation requirements before any local adoption experiment.

| Official source | Observed pattern | D2-specific question still to test |
| --- | --- | --- |
| [React Flow custom nodes](https://reactflow.dev/learn/customization/custom-nodes), [handles](https://reactflow.dev/learn/customization/handles), [accessibility](https://reactflow.dev/learn/advanced-use/accessibility) | Consumer React components with interactive wrappers, connection handles and accessibility facilities | Can compiled D2 bounds/routes/order remain authoritative without a second graph model becoming the document, or wrappers taking over consumer gestures? |
| [JointJS HTML inside shapes](https://docs.jointjs.com/learn/features/customizing-shapes/html-inside-shapes/) | SVG shapes can contain HTML controls/content through foreignObject | Compare foreignObject with sibling HTML overlays for focus, text selection, clipping, zoom, portals and export; do not assume either solves D2 text fidelity |
| [shadcn composition/open code](https://ui.shadcn.com/docs) | Consumer-owned, modifiable component code and composable interfaces | Can a consumer supply a card, content renderer, menu or popover without importing their design system into d2web or requiring a fork? |

This is an initial documentary comparison, not a completed framework evaluation or local interoperability proof. Extend the shortlist only when another approach tests a materially different assumption.

The critical customization experiment has two cases: a replacement that fits existing D2 dimensions, and one whose content requires different dimensions. For the second, compare clipping/overflow/rejection with an explicit measurement-to-D2-layout handshake, if native APIs can support it. Never imply automatic resizing is already supported. Record resulting routes, anchors, source effects and export differences. A custom card is not expected to match native pixels; verify unchanged semantics and explicitly declared geometry behavior instead. Reverting to the default representation must reproduce the reference.

Library use must be tested from a small external consumer rather than only inside the repository harness. Investigate minimal imports, framework coupling, CSS/font ownership, browser/WASM asset resolution, multiple instances, explicit lifecycle, error boundaries and bundler requirements. Packaging/subpath exports, headless contracts and component slots are possible answers, not APIs selected in advance. shadcn/Tailwind must remain consumer choices.

## Competing hypotheses

| Boundary | Claim to test | Potential disproof |
| --- | --- | --- |
| Scene-first | D2's prepared scene plus associations provides sufficient presentation and integration data | Source ownership or semantic structure cannot be recovered reliably from scene identities |
| Semantic-first | Graph/target data can drive web components while reusing D2 calculations | Required paint/measurement behavior demands substantial duplication or diverges from native output |
| Combined | Semantic/source data and a prepared scene can be associated without losing D2 meaning | Associations are ambiguous, unstable or too costly to maintain across edits/boards |

Compare presentation separately: individually owned SVG elements, mixed HTML/SVG content, React binding and direct DOM binding. A direct DOM experiment need not become a second production renderer. Do not couple a successful renderer experiment to an automatic decision about compiler, editing or lifecycle boundaries.

## Research method

For each experiment, record the question, competing predictions, pinned source/runtime/configuration, actual input tree, exact command, expected observations, measured results, counterexamples and limits. Classify outcomes as supported for named cases, rejected, or inconclusive. Record hypotheses that fail as carefully as those that pass.

Choose criteria before running comparisons. Preserve existing image thresholds in [conformance.md](../docs/conformance.md); screenshots are only one dimension. Record correctness and browser observations first. Measure latency, memory, payload size and DOM cost without inventing performance budgets; agree budgets before a performance-based selection. Native SVG is a reference, not a replacement for the web surface.

Small disposable probes belong under tests and generated artifacts under ignored artifacts/. Put inputs/assets under examples/. Preserve existing implementation and imported repositories. No new package architecture, public bridge schema or general plugin system is justified by a probe. Tests may encode experimental observations without declaring production support.

## Ordered investigations

| Task | Question and experiment | Observable acceptance | Dependency |
| --- | --- | --- | --- |
| R0: web framework patterns | Compare React Flow and JointJS against the same D2 interaction/composition needs; assess adoption, adapter and pattern-only options | Source-linked comparison, explicit ownership conflicts and a bounded local probe proposal; no dependency chosen from documentation alone | None; informs R1/R2 |
| R1: semantic/source association | Trace the same objects through parser/graph, target and scene for local imports, classes/globs and inherited boards; include anonymous/derived primitives and repeated compilation | Every inspected object has a documented source association or explicit ambiguity; distinguish authored objects from generated visuals; report which hypotheses survive | None |
| R2: browser text/content | Compare one label/rich-content case using native scene-driven SVG and mixed HTML/SVG; reuse native fonts/measurement, inspect shaping, wrapping, selection and accessibility | Same files/options/fonts; measured bounds/image differences and actual browser selection/accessibility observations; failures remain visible | None; use R1 identities where available |
| Checkpoint A | Compare R1/R2 evidence and counterexamples | User reviews the surviving boundaries and any tradeoff between fidelity and useful web behavior; architecture stays open where evidence is insufficient | R1, R2 |
| R3: embedding and lifecycle | Mount two experimental surfaces inside hostile host CSS; explicitly load permitted resources, update, fail, dispose and remount | Record network/storage/global changes, style leakage and live resource cleanup; diagram IDs/resources do not collide; failure does not replace valid state with partial output | Checkpoint A chooses a bounded candidate to probe |
| R4: native editing round trip | Characterize one native source operation on a multi-file/board case, including a rejected operation; recompile all affected outputs | Preserve unrelated source; changes have explicit file ownership; failed edits return no partial change; document identity changes rather than assuming stable IDs across rename | R1 |
| R6: external consumer and custom representation | Embed the bounded candidate as a library in a separate fixture; supply a consumer-owned shadcn-style card/content component with same-size and changed-size cases | No fork or core design-system dependency; preserved IDs/events/source; explicit dimension/layout policy; scoped styles, portals/focus and cleanup checked; default representation can be restored | Checkpoint A and R3; split packaging and representation probes if needed |
| Checkpoint B | Compare complete paths and choose the next research gap | Each candidate has evidence, costs, unresolved gaps and a disqualifying observation; no unsupported whole-port claim | R3, R4 |
| R5: pipeline/stack decision | Expand the existing capability map with chosen/candidate technologies, owners, evidence and remaining experiments | Account for every pipeline family below, framework comparison and external customization; mark each decision accepted, proposed or unresolved; user reviews before product implementation | Checkpoint B and R6 |

R0 is the next research task; its initial official-document findings are recorded above. Finish its comparison before the R1 execution task, which should begin with source inspection of d2graph, d2target, d2scenebuild and d2oracle, using existing import/board fixtures. This is a data/provenance experiment, not an editor implementation. Split a task if its probe needs more than five files; do not broaden the first geometry renderer to satisfy a research question by construction.

## Coverage required for the eventual technology map

- Files/virtual filesystem, imports, syntax/AST, diagnostics, expansion/IR, classes, variables and globs.
- Semantic graph, identities, source provenance, configuration, themes, units and defaults.
- Fonts, measurement, layout orchestration, TALA/other engines and routing.
- Shapes, structured diagrams, containers, connections, arrowheads, labels, Markdown/code/math and assets.
- Paints, transforms, clipping/masking, filters, ordering, animation and every output board.
- Browser execution, request correlation/cancellation, validation, resource policy and lifecycle.
- DOM associations, event ownership, accessibility, text selection, embedding and consumer composition.
- Native editing/formatting, atomic file updates, exports and downstream integration/reskin boundaries.

React, direct DOM, workers and bridge formats remain candidates until relevant experiments justify them. Reusing Go/WASM is the accepted direction; completeness and cost still need per-subsystem evidence. Do not select a second Markdown/math/layout implementation merely because a browser library exists.

## Evidence baseline and risks

The [porting map](../docs/porting-map.md) records source findings and a verified label-free geometry case. That case supports native/Node/Chromium-WASM data equivalence and native-versus-React image/DOM comparison for its admitted subset. It does not settle text, semantic association, full browser execution-to-render wiring, editing or architecture. Rerun relevant checks before using historical results as current measurements.

Key risks are loss of source ownership, font/glyph differences, incomplete scene coverage, host interference and resource costs. A combined semantic/scene representation is a hypothesis, not a fallback automatically selected if either simpler candidate fails. Upstream inclusion requires maintainer agreement and is not assumed.

## Handoff

Current status, next decision and check/CI changes are in the [findings' Current state](../docs/research-findings.md#current-state); task status is in [todo.md](todo.md). The source is in the initial commit and later research changes are uncommitted.

Historical (early planning, when only R0/R1 groundwork existed): `mise run check` then passed four infrastructure tests, four native cases, one native/Node-WASM test, two geometry decoder tests, four Chromium tests, TypeScript and 20 mise task definitions. Those counts are superseded.
