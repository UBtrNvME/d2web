# D2 web research tasks

See [plan.md](plan.md) for hypotheses and evaluation rules. Unchecked items are proposed research, not accepted architecture or supported capabilities.

Current user direction: prioritize a native HTML/JavaScript/CSS/SVG foundation for later React components. React Flow is connection-drawing prior art, not a foundation candidate by default. Current follow-up batch: framework-free SVG connection/hit testing, actual JointJS Core comparison and native font/text characterization. Bounded independent workers use GPT-6 Luna with coordinator/peer review; earlier higher-cost workers were interrupted when the user added the cost preference.

Execution ledger: [research findings](../docs/research-findings.md). R1's bounded association experiment is complete. R0 now includes actual React Flow and framework-free JointJS Core comparisons plus a native SVG connection/hit-target probe. Native font/browser controls contribute to R2, structural cleanup/composition to R3, and native operations to R4 without completing their wider acceptance criteria. R6 actual external library/shadcn composition and R5 complete contracts/stack selection remain open. The user authorized independent workers and automatic research; no public architecture was accepted by running probes. The native-browser foundation preference is an explicit user direction.

Check/CI note: `mise run check` now depends on `reference:fetch` (imports/d2 must be a git checkout at D2 v0.9.0, commit d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda) and also runs the five research probes (identity, operations, text, connections, composition). See the findings' [Current state](../docs/research-findings.md#current-state).

## R0: Web framework patterns

- [x] Compare React Flow and JointJS patterns for custom content, handles/routes, nesting, viewport, controlled state, accessibility and lifecycle against D2 requirements using official sources.
- [x] Assess bounded adapters and pattern reuse; execute pinned React Flow, framework-free JointJS Core and native SVG connection experiments with package/version/license evidence. Framework adoption is not the current objective; native browser primitives are preferred.
- [x] Verification: source-linked comparison, actual bounded React Flow pass and explicit untested claims recorded; `mise run check` passed. No production adoption follows.

Dependencies: none; informs R1/R2. Likely files: tasks/plan.md and docs/porting-map.md, then a bounded browser probe only if justified. Scope: small/medium.

## R1: Semantic/source association

- [x] Trace local import/class/glob/board cases through native graph, target and scene; inspect native editing references without inventing associations.
- [x] Record authored/generated identity, source locations, ambiguity and repeated-run behavior; assess scene-first, semantic-first and combined hypotheses against the same cases.
- [x] Verification: local native/Node-WASM probe passed, findings recorded and `mise run check` passed. This is projection/association evidence, not complete semantics or paint parity.

Dependencies: none. Likely files: a probe under tests/, existing examples/ inputs, docs/porting-map.md; add a mise task only if the probe becomes recurring. Scope: small/medium, split before exceeding five files.

## R2: Text/content and browser behavior

- [ ] Compare SVG-oriented and mixed HTML/SVG presentation for a bounded label/rich-content case using native metrics and matching assets.
- [ ] Record visual/bounds differences, browser text selection and accessibility observations without masking failures or changing thresholds.
- [ ] Verification: reproducible native/browser comparison and `mise run check`; distinguish observed behavior from broad support.

Dependencies: none; use R1 associations if available. Likely files: one examples/ case, browser probe/test, native probe, experiment record and mise task if needed. Scope: medium.

## Checkpoint A

- [ ] Review R1/R2 results with the user; identify surviving alternatives and unresolved questions before choosing candidates for R3.

## R3: Embedding and lifecycle

Quick evidence: native ES-module mount/dispose plus two React StrictMode/portal consumers passed, including actual detached-wrapper listener removal and sibling survival (`mise run test:research:host`). Full hostile-CSS, failure-state and resource-cleanup coverage remains open.

- [ ] Probe two mounts under conflicting host CSS with explicit asset policy, updates, failed input, disposal and remount.
- [ ] Record resource/ID collisions, network/storage/global effects, style isolation and cleanup; separate required effects from unrequested policy.
- [ ] Verification: browser assertions and recorded observations plus `mise run check`; agree any isolation strategy from evidence.

Dependencies: Checkpoint A. Likely files: browser fixture, browser test, bounded candidate changes and experiment record. Scope: medium.

## R4: Native edit round trip

- [ ] Characterize one successful and one rejected native source operation in a multi-file/board case.
- [ ] Verify ownership, preservation of unrelated source and all affected outputs; record identity changes and atomic failure behavior.
- [ ] Verification: local native/WASM evidence where available, focused assertions and `mise run check`; label missing browser exposure explicitly.

Dependencies: R1. Likely files: native probe, examples/ workspace, focused test and experiment record. Scope: medium.

## Checkpoint B

- [ ] Review evidence and counterexamples with the user; decide whether another experiment is needed before selecting boundaries.

## R5: Full pipeline and stack decision

- [ ] Extend the capability map across all pipeline families in the plan; connect each technology proposal to evidence, gaps and ownership.
- [ ] Present alternatives, costs, rejection reasons and unresolved assumptions; distinguish accepted decisions from proposed ones.
- [ ] Verification: source-reference/coverage/link audit and `mise run check`; user reviews the decision before product implementation begins.

Dependencies: Checkpoint B and R6. Likely files: docs/porting-map.md, docs/project-brief.md, README.md and an ADR only if a decision is accepted. Scope: medium.

## R6: External library consumer and custom representation

Latest focused evidence: native module packed/imported by a separate consumer; real Card with compiled light/dark Tailwind tokens; measured 160×80 content through explicit native D2 recompile updates the route. Base/resized image parity passes using the existing React geometry renderer. This is a named-case proof, not a production SDK, arbitrary-content handshake or browser-WASM sizing API. See `mise run test:research:consumer` and the latest findings. Full native corpus rerun is 145/147 due to original remote-image failures; full corpus web output remains unavailable.

Quick evidence: the actual imported shadcn Card renders through a React portal into the native fixture's slot. Inline consumer styling only; published packaging, Tailwind/theme fidelity and changed-size native layout remain open. This is a small interoperability proof, not completion of R6.

- [ ] Test a small external consumer with explicit initialization/assets and consumer-owned custom node/content presentation, including an actual shadcn component once a candidate is selected.
- [ ] Compare fixed-size replacement and changed-size content; record geometry, routes, event/source identity, focus/portals, CSS ownership and the return to faithful default rendering. Do not silently recalculate layout or mutate source.
- [ ] Verification: browser assertions plus `mise run check`; record installation/bundling requirements and gaps. Split into a packaging probe and a representation probe if scope exceeds five files.

Dependencies: Checkpoint A and R3; required before R5. Likely files: external consumer fixture, bounded adapter, browser test and experiment record. Scope: medium per probe. shadcn is a consumer dependency, not a core requirement.
