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

## Stage A execution handoff (1 November 2026)

Scope: code, SQL tables and classes only, in the HTML painter. Markdown remains unchanged per the task. Implementation is prepared but **not accepted as complete**: browser execution and Git delivery are blocked by this session's permissions.

- DOM: existing object groups, names, scene IDs, positioned primitives and baseline markers remain. Code gains `pre > code > span` (one block span per line), with the original token nodes inside each span. Only code tokens lose the painter's synthetic trailing LF; explicit line breaks and whitespace gaps come from D2's association label. Tabs expand to four spaces as D2's scene builder does. Copy is tested through the rendered selection, which is distinct from `innerText` for absolutely positioned runs.
- SQL tables and classes gain an inner `role=table`, `row`, `columnheader` and `cell` hierarchy with `display:contents`. A multiline header stays one columnheader. The outer `role=group` and accessible name stay intact; `a11y:false` suppresses the ARIA roles. Actual class IDs are `class-header[-label]`, `class-field:R:prefix|name|type` and `class-method:R:prefix|name|type`, rather than the SQL `table-row` pattern.
- Files: `packages/d2web/src/paint.js`, new `packages/d2web/tests/browser/semantic.spec.mjs`, `mise.toml`'s `test:client` list, and this handoff. No baseline, threshold, Markdown painter or imported source changes.
- The new spec has six tests: two code copy/line cases, SQL and class roles/order/events/association, multiline header plus accessibility opt-out, and a direct mounted comparison with the checkpoint painter over every content/table/shape catalog case. The checkpoint comparison requires the existing `checkpoint/before-web-native-contracts` tag, bundles that painter with the current mount/client, and attaches every pixel delta. It requires zero changed pixels at the existing per-channel difference threshold; it does not update any baseline.

Verification performed via mise:

- `mise run check`: passed (27.20 seconds; all 61 task definitions valid, including typecheck, native/Node-WASM and research gates). Final rerun after review: passed in 22.42 seconds (`/tmp/d2web-stage-a-check-final.log`).
- `mise exec -- node --check packages/d2web/tests/browser/semantic.spec.mjs`: passed.
- Native product compile and painter inspection: all 51 catalog cases in the content/table/shape families plus three custom cases compiled and painted. An assert-based HTML parser check confirmed identical scene ID order and every original absolute-position attribute against the checkpoint; seven code objects had exact D2 text and line structure, and 13 table/class objects had named tables with one columnheader. Temporary evidence: `/tmp/d2web-stage-a-markup.json`. This checks markup, not rendered geometry, selection behaviour or pixels.
- `mise exec -- pnpm exec playwright test packages/d2web/tests/browser/semantic.spec.mjs --reporter=line`: six failed at Chromium launch.
- `mise run test:client`: 60 failed at Chromium launch.
- `mise run test:features:paint`: one failed at Chromium launch, before catalog measurements. No new native comparison results or status-regression assessment; the checked-in baseline is unchanged.
- `mise exec -- env D2WEB_BROWSER=firefox pnpm exec playwright test packages/d2web/tests/browser/semantic.spec.mjs --reporter=line --output=artifacts/d2web-semantic-firefox`: six failed at launch (SIGABRT).
- `mise exec -- env D2WEB_BROWSER=webkit pnpm exec playwright test packages/d2web/tests/browser/semantic.spec.mjs --reporter=line --output=artifacts/d2web-semantic-webkit`: six failed at launch (exit 134 / Abort trap 6).
- Chromium's launch error is `bootstrap_check_in ... MachPortRendezvousServer ... Permission denied (1100)`; all browser failures occur before assertions. Full browser gates were not repeated after these infrastructure failures. No misalignment delta can be reported: no browser screenshot was produced. Logs are `/tmp/d2web-stage-a-{check,chromium,client,feature-paint,firefox,webkit}.log`.

Git: the worktree was initially clean on `claude/research-results-review-277fb1`, seven commits ahead of its upstream. `mise exec -- git switch -c web-native/stage-a` failed because the shared Git directory `/Users/Aitemir_Kuandyk/Projects/My/d2web/.git` is read-only in this session. The four scoped files remain uncommitted on that original branch. No commit or push was attempted on the original branch. No branch, main, tag or baseline was pushed or rewritten. The imported Studio checkout is absent here.

Next: in a session that can launch the installed browsers and write the shared Git directory, create `web-native/stage-a`, run all six semantic tests in Chromium/Firefox/WebKit plus `mise run test:client` and `mise run test:features:paint`, inspect recorded deltas and compare every content/table/shape status with `tests/features/baseline.json`. Resolve any copy/geometry mismatch without relaxing checks. Once those gates pass, commit with trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and push only `web-native/stage-a`, without force.

## Known gaps found while building

- **Copy from code in Firefox and WebKit (stage A, open).** `pre > code > span` per line is correct and `textContent` is D2's text, but a rendered selection copies one token per line there, because each token is an absolutely positioned (block-level) box. Chromium copies the source lines. A fix needs the tokens of a line to flow inline (stage B territory: lay the line out in the browser inside D2's box and check it against D2's token positions) or a `copy` handler; neither is done. The test asserts the copy text in Chromium only and says so.

## Stage B1: markdown semantics without re-layout (1-2 November 2026)

Built by inference from D2's own output, pinned to D2 v0.9.0: heading levels from font size (32, 24, 20 px = `h1`..`h3`; sizes from `d2renderers/d2svg/github-markdown.css`), `strong`/`em`/`code` from the font asset, `a` from the scene link regions (one anchor per link; unsafe URLs stay href-less region anchors named after the object), lists, quotes, rules and fenced code from the bullet/bar/box rectangles. The association `label` (the source) only validates the result. Anything ambiguous stays unwrapped: headings of 16 px or less (h4..h6 look like body text), nested or wrapped list items, complex inline syntax, unmatched fences.

Checks: `semantic.spec.mjs` (10 tests) passes in Chromium, Firefox and WebKit, including the C1 test: zero pixel delta against the checkpoint painter for every content, table and shape case plus the markdown sample. `test:client` 62 passed, `test:features:paint` and `mise run check` pass. Links are left out of the Tab order in Safari/WebKit, so that assertion is skipped there as in `links.spec.mjs`.

Not done (stage B proper): browser reflow of markdown inside D2's box (C2), h4..h6, nested lists. Still open from stage A: copy from code in Firefox and WebKit.
