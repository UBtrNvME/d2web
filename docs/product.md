# d2web product definition (v1)

Accepted by the user on 31 October 2026 as [ADR 0007](adr/0007-product-scope-v1.md). Builds on ADRs 0001-0006; [ADR 0009](adr/0009-natural-web-forms.md) amends how fidelity is judged. This is the product scope; the [specifications](SPEC.md) describe the implemented contracts and their limits.

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

- Fidelity: D2's semantics, geometry and text decisions remain authoritative. Pixel comparisons diagnose differences; intended natural web forms are tested as behaviour (ADR 0009). The catalog retains its 5% image and 25% ink checks, with separately labelled equivalent, scene-checked and web-native cases.
- Browsers: Chromium is the v1 reference. Firefox and Playwright WebKit have recorded test evidence; real Safari remains unverified. See [browser support](browser-support.md).
- Packaging: the build produces an ESM package, worker and wasm ([spec 0003](specs/0003-packaging.md)); gzip budgets are 40 KB for the module and 15 MB for wasm. Registry publication is a separate decision.

## Current implementation and remaining work

The worker/client, mount, source association, packaging, animation, accessibility attributes, fallback fonts, layout budget and image modes are implemented. Semantic content has `pre`/`code`, ARIA tables, selected positioned markdown wrappers and an opt-in browser-flow subset. Browser flow is not the default and unsupported content falls back to positioned paint.

The [2 November browser review](web-native-audit.md) reproduced zoom-dependent text clipping, animation/content ownership and font-lifecycle defects. The follow-up fixes these combinations and adds a typed renderer input and explicit DOM ownership ([spec 0011](specs/0011-rendering-contract.md)). This is a foundation for an independent framework renderer; a React renderer and complete semantic coverage are not delivered. Editing stays v2.
