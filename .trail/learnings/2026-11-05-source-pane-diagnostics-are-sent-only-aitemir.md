---
title: "Source pane diagnostics are sent only when they change, because every update closes the hover tooltip"
author: Aitemir
date: 2026-11-05
branch: enhanced-source-editing
cost: { minutes: 54, tokens: 124148 }
id: l-107fdebc
scope: repo
status: active
src: agent
touches:
  - AGENTS.md
  - README.md
  - docs/adr/0016-source-pane-codemirror.md
  - docs/adr/README.md
  - docs/specs/0020-source-pane.md
  - packages/d2editor/index.html
  - packages/d2editor/package.json
  - packages/d2editor/src/main.ts
  - packages/d2editor/style.css
  - packages/d2editor/tests/editor.spec.mjs
---

## Decided
The source pane re-sends diagnostics to CodeMirror only when the list differs from the last one shown. Compiles repeat the same diagnostics (the idle TALA recompile fires one second after typing stops), and each update closes an open hover tooltip, so the message vanished as it opened.

## Tried and ruled out
- Adding the linter extension: no effect, setDiagnostics already installs the hover tooltip.
- Dropping the tooltip assertion from the test: it hid a real bug.

## Watch out
- Test helpers that expose CodeMirror cannot be init scripts: CodeMirror reads the document body at load and fails before the page exists. Add the script tag after load, and again after any reload.
- Undo steps one keystroke at a time because every input is one history step. The old textarea did the same.

In the code: diagnose() in packages/d2editor/src/main.ts; withCm in packages/d2editor/tests/editor.spec.mjs.
