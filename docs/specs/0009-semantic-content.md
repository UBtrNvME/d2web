# Spec 0009: semantic rich content (web-native layout contracts)

Status: **proposed**, built stage by stage; the user said "proceed" on 1 November 2026 and asked to keep a way back. Checkpoint: git tag `checkpoint/before-web-native-contracts` (commit d81f1af, painter at 73 % HTML elements, rich content as positioned text). Return with `git checkout checkpoint/before-web-native-contracts`, or compare with `git diff checkpoint/before-web-native-contracts`. Builds on [ADR 0009](../adr/0009-natural-web-forms.md) and [the audit](../web-native-audit.md).

## The contract

D2 decides the box. For markdown, code and tables the scene gives every text run an absolute position, and the scene node IDs carry the structure (`code:code-line:L:token:T`, `t:table-row:R:name|type|constraint`, `md:markdown:primitive:N`; the markdown source is in the association `label`). A web-native form must satisfy, in this order of strictness:

- **C1 (geometry)**: every visible glyph stays where D2 put it, within the existing pixel bars. Wrapping runs in semantic elements must not move anything.
- **C2 (fit)**: when content is laid out by the browser (stage B), its rendered box must fit inside D2's box for that object; overflow is a failing case, never silently clipped.
- **C3 (names)**: the element names, text and order a reader or `copy` gets are D2's text, in reading order.

## Stages (each lands only with its checks; each can be reverted alone)

**Stage A, semantics without re-layout (C1 + C3).** The painter groups D2's runs into semantic elements by their IDs, keeping the absolute positions:
- code: `pre > code`, one block per line (a `span` per line, tokens inside), so copy returns lines;
- sql_table and class: a `table` role (`role=table`, `row`, `cell`/`columnheader`) over the runs, names from the row/column parts of the IDs;
- markdown: the association `label` is the source; stage A only marks the object `role=document`-like grouping and keeps runs (headings and lists need stage B because the scene has no block structure).
Check: pixel bars unchanged for every `content/*`, `table/*` and `shape/*` case, plus DOM assertions (element roles, text order, copy text).

**Stage B, browser flow inside D2's box (C2).** Markdown rendered from its source as real `h1..h6`, `p`, `ul/ol`, `strong`, `em`, `a`, `code`, positioned in D2's box with D2's font and size. Check: fit test (scrollWidth/scrollHeight within the box, per case) and the existing bars; any misalignment is recorded as a case with its delta, which is what the checkpoint is for.

**Stage C (not started)**: multi-line labels as one paragraph, and a focus-visible tooltip. Each needs its own contract before work.

## Out of scope

Changing D2's layout from browser measurements (option 2 of the discussion): it would change D2's decisions and needs its own ADR.
