# Architecture decision records

One file per decision: `NNNN-short-title.md`, numbered in order, never renumbered. Change a decision by adding a new ADR that supersedes the old one and updating the old one's status line.

**Status values:** `proposed` (written, not reviewed), `accepted` (the user decided it), `superseded by NNNN`, `rejected`. Only the user accepts. Research evidence supports an ADR; it does not accept one. Evidence lives in [research findings](../research-findings.md) and the [capability matrix](../capability-matrix.md); an ADR links to it instead of copying it.

## Template

```markdown
# NNNN. Title

Status: proposed | accepted (date) | superseded by NNNN
Context: the forces and constraints, with links to evidence
Decision: what we do, in one or two sentences
Alternatives: what was considered, and the observation that ruled each out
Consequences: what it commits us to, what stays open, what would reverse it
```

## Index

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-native-web-foundation.md) | Native HTML/JS/CSS/SVG foundation; D2 Go/WASM owns compile, layout and theme | accepted |
| [0002](0002-combined-boundary-and-painter.md) | Combined association boundary; HTML-first painter with CSS masks; explicit font assets | accepted for research scope |
| [0003](0003-runtime-shape.md) | Worker-hosted D2 wasm, shadow-root host, consumer-owned content | accepted |
| [0004](0004-edit-wrapper-and-patches.md) | Copy-on-write edit wrapper; oracle fixes as opt-in patches | accepted |
| [0005](0005-layout-engine-policy.md) | TALA default; ELK or dagre as an explicit large-board switch | accepted |
| [0006](0006-font-delivery.md) | Consumer-approved fonts, loadable on demand | accepted |
| [0007](0007-product-scope-v1.md) | v1 is a read-only render runtime for a generic embedder; Chromium only; editing is v2 | accepted |
| [0008](0008-repository-layout.md) | Multi-language monorepo: `packages/d2web`, `packages/d2web-wasm`, `research/`, shared `tests/` | accepted |
| [0009](0009-natural-web-forms.md) | D2 is natural on the web, not a copy of native SVG; web-native status | accepted |
| [0010](0010-web-performance.md) | Web performance is a standing constraint: rules, measurement method and review checklist | proposed |
