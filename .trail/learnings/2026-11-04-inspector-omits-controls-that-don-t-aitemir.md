---
title: "Inspector omits controls that don't apply, never shows them disabled"
author: Aitemir
date: 2026-11-04
standing: true
id: l-8300fdbb
scope: repo
status: active
src: init-sessions
---

## Decided
- The user rejected disabled fields as visual clutter. The visual editor should cover common moves with a few standard controls, and power users edit the rest in the D2 source pane.
- In the code: In the d2editor inspector (index.html, src/main.ts), hide fields and actions D2 ignores for the selected kind. Do not render them disabled. Spec 0018 and ADR 0015 record this rule.

_From past Claude sessions here, Nov 4._
