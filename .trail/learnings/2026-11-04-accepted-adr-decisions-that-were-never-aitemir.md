---
title: "Accepted ADR decisions that were never built are a real gap; build them, don't amend"
author: Aitemir
date: 2026-11-04
standing: true
id: l-a45535ae
scope: repo
status: active
src: init-sessions
touches:
  - tests/docs-check.mjs
---

## Decided
- An audit found ADR 0013's traits were accepted but not in the code. The team chose to build what the ADRs say and add delivery lines, rather than rewrite the decisions.
- In the code: ADRs get a `Delivery:` line and are superseded explicitly, never silently edited. Specs are short-lived briefs and each needs a `Delivered:` line; tests/docs-check.mjs (in test:unit) enforces this and that cited paths exist.

_From past Claude sessions here, Nov 3._
