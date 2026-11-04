---
title: "Editor field lists come from D2's own keyword tables, not a hand-written schema"
author: Aitemir
date: 2026-11-04
standing: true
id: l-1ab91886
scope: repo
status: active
src: init-review
---

## Decided
- A hand-kept table of fields and value ranges would be a second model that drifts from D2 on upgrade. The team exports D2's keyword table from the Go build and tests it against the pinned source.
- In the code: Do not hardcode style, layout or arrowhead enums in packages/d2editor. Use capabilities() and the keyword table exported from packages/d2web-wasm/keywords; run the derivation test after any D2 bump.

_From PR #39 here, Nov 3._
