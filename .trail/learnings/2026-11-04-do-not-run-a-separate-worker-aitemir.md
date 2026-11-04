---
title: Do not run a separate worker per layout seed to speed up TALA
author: Aitemir
date: 2026-11-04
standing: true
id: l-75ffe07f
scope: repo
status: active
src: init-review
---

## Tried and ruled out
- TALA scores seeds internally and refines only the winner, so parallel workers cannot reproduce that choice without patching D2, which the product build refuses.
- In the code: Default seeds are 1,2,3 to match the d2 CLI. Use the request `seeds` field (e.g. [1]) for fast typing-time compiles. Source `tala-seeds` wins. Native comparisons pass --tala-seeds=1,2,3.

_From PR #12 here, Nov 2._
