---
title: "Moving a shape refuses cases where D2's move helper crashes or corrupts text"
author: Aitemir
date: 2026-11-04
standing: true
id: l-99e23380
scope: repo
status: active
src: init-review
---

## Watch out
- D2's move helper overflows the Go stack when moving into a descendant (not recoverable), leaves duplicates for imported declarations, and silently renames on name clashes.
- In the code: Keep the four refusals in the `move` edit op (packages/d2web-wasm/edit): target inside self or descendants, imported declarations, name already in parent, key referenced by a scenario or step.

_From PR #25 here, Nov 3._
