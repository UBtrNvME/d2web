# d2web product definition (v1)

Accepted by the user on 31 October 2026 as [ADR 0007](adr/0007-product-scope-v1.md). Builds on ADRs 0001-0006. Describes intent, not existing APIs.

## What it is

A reusable browser runtime that compiles D2 text with D2's own Go/WASM (compile, layout, themes) and paints the result as native HTML/SVG DOM that a host page can embed, style around and replace parts of.

## v1 includes

- Compile in a worker; typed scene and diagnostics back, keyed by revision, board path and ID.
- HTML-first paint in a shadow root, SVG where HTML cannot express a primitive; every D2 shape, layout, style and theme the corpus uses.
- Consumer-replaceable node content, with the measure-and-recompile loop (measured size becomes D2 width/height).
- Consumer-listed fonts only; misses are reported.
- Typed events (hover, click, focus) with D2 identity attached.
- Larger boards via an explicit engine switch (ELK or dagre).

## v1 excludes

Editing and undo (v2), React binding, editor UI, application state, persistence, plugin framework, implicit skins or effects, browsers other than Chromium as a supported target.

## Promises and limits

- Fidelity: within 5% raster difference of native TALA; failures are recorded, not hidden.
- Browsers: Chromium verified; others unverified and labelled so.
- Packaging: npm package with worker and wasm; size budget not yet known.

## Next

1. Spec the first contract: worker message protocol plus scene bridge with render options (theme, dark theme, sketch). Not started.
2. Edit, font-mismatch reporting and packaging contracts follow.
