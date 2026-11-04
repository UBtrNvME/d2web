---
title: "Edits are published as patches onto the author's text, not as reformatted files"
author: Aitemir
date: 2026-11-04
standing: true
id: l-23c648e0
scope: repo
status: active
src: init-review
---

## Decided
- Printing the whole file reformatted 10 of 90 files and lowercased keyword-spelled labels because of a D2 formatter bug. Merged patches with an equivalence check and a label guard avoided this.
- In the code: Keep the edit pipeline in packages/d2web-wasm/edit: merge the oracle result onto the author's text and publish only if it passes the equivalence and label guard. On failure return the formatted alternative and never publish silently.

_From this repo's docs._
