# 0007. Product scope for v1: read-only render runtime

Status: accepted (user, 31 October 2026, agreed to all recommendations in chat). "Editing is v2" superseded by [ADR 0012](0012-editing-in-scope.md) (2 November 2026); the rest stands. Full product description in [product.md](../product.md).

Context: ADRs 0001-0006 settled the technical shape; nobody had defined what d2web is for. The contract spec and first slice need that bound. Evidence: [research findings](../research-findings.md), [capability matrix](../capability-matrix.md).

Decision:
- **v1 is read-only render:** compile, paint, the association layer keyed by (revision, board path, ID), consumer-replaceable node content and the measure-and-recompile loop. Editing is v2.
- **First consumer** is a generic embedder; `d2editor` is the design check for boundaries, not the target.
- **Public surface:** a framework-free ES module with mount/update/dispose and typed events. A React binding is later and outside v1.
- **Browsers:** Chromium only is verified for v1; others are stated as unverified.
- **Fidelity promise:** within 5% raster difference from native TALA, with visible recorded failures.
- **Distribution:** an npm package bundling worker and wasm; size budget and packaging details stay open until a slice is built.
- **Non-goals:** editor UI, application state, persistence, a plugin framework, implicit skins or effects.

Alternatives: render plus edit in v1 (oracle patches, undo and stale handling unresolved); Studio as first consumer (couples the library to one application); multi-browser commitment (nothing tested outside Chromium).

Consequences: the first contract spec covers the worker protocol and scene bridge for render only; edit and font-mismatch contracts follow. Reversing any item needs a new ADR.
