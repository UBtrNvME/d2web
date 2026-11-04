---
title: "All diagram elements share one base, and any node kind converts to another"
author: Aitemir
date: 2026-11-04
standing: true
id: l-58f35ede
scope: repo
status: active
src: init-sessions
---

## Decided
- Every D2 element comes from the same primitive. The user wanted the UI to show that inheritance and let you switch a node's type, with the controls following the new type.
- In the code: Model per ADR 0015 and spec 0018: Element is the base, Node and Edge extend it, and node kinds (Shape, Text and so on) sit below Node. Kinds are in packages/d2editor/src/kinds/. Edges get no Type picker. Conversion goes through `retype` in main.ts.

_From past Claude sessions here, Nov 4._
