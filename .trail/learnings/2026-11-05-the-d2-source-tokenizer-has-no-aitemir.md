---
title: The D2 source tokenizer has no colour token because an unquoted hash is a comment in D2
author: Aitemir
date: 2026-11-05
branch: enhanced-source-editing
cost: { minutes: 3, tokens: 4567 }
id: l-eabf1005
scope: repo
status: active
src: agent
touches:
  - docs/specs/0020-source-pane.md
  - docs/specs/0021-source-pane-highlight-complete.md
  - mise.toml
  - packages/d2editor/package.json
  - packages/d2editor/src/main.ts
  - packages/d2editor/src/source-language.ts
  - packages/d2editor/style.css
  - packages/d2editor/tests/editor.spec.mjs
  - packages/d2editor/tests/source-language.test.mjs
  - pnpm-lock.yaml
---

## Decided
packages/d2editor/src/source-language.ts has no colour token. D2 starts a comment at any unquoted `#`, so `fill: #3366cc` is a comment and D2 reports "missing value after colon". A hex colour is valid only as the quoted string `"#3366cc"`, and is highlighted as a string.

## Tried and ruled out
A colour token for unquoted `#rrggbb` (the first spec asked for it). It painted invalid text as valid and disagreed with D2's own error.

## Watch out
Check any highlighting or completion rule against what D2 actually compiles, not what looks natural. The status panel's D2 diagnostics exposed this in a screenshot; the first unit tests had encoded the wrong belief.

In the code: packages/d2editor/src/source-language.ts; the unquoted-hex assertion in packages/d2editor/tests/source-language.test.mjs.
