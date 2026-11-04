---
title: "Editor shape abilities are derived from D2 compilation, never stored per component"
author: Aitemir
date: 2026-11-04
standing: true
id: l-08bb801f
scope: repo
status: active
src: init-review
touches:
  - packages/d2editor/src/traits.ts
---

## Decided
- What a shape can do is decided by D2 and the layout engine and is not what one would guess. Stored per-component traits would drift from what D2 compiles.
- In the code: Add behaviour as a trait in packages/d2editor/src/traits.ts with a test that compiles D2 and compares. Palette entries are {id, label, ops(ctx)}. All writes go through client.edit ops.

_From PR #32 here, Nov 3._
