---
title: "Per-frame canvas state must live on sibling layers, never on an ancestor of the board"
author: Aitemir
date: 2026-11-04
standing: true
id: l-030e6ff6
scope: repo
status: active
src: init-review
---

## Watch out
- Dot-grid CSS variables on the board's ancestor restyled every board element each pan frame, with 985 ms of style recalculation versus 96 ms after the grid moved to a sibling.
- In the code: In demo and d2editor canvas code, put grid, zoom readout and selection outline in sibling layers. Apply input once per requestAnimationFrame and write text only when it changes (ADR 0010).

_From PR #8 here, Nov 2._
