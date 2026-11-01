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

- **Copy from code in Firefox and WebKit (stage A, fixed 2 November 2026).** Each token is an absolutely positioned (block-level) box, so those browsers serialised a selection as one token per line. `mount` now handles the `copy` event for a selection inside one `pre` and puts the text of the selected line spans on the clipboard (`getComposedRanges` where the selection is hidden in the shadow root). Checked with a real drag selection and the copy shortcut in Chromium, Firefox and WebKit. Limit: a selection that spans a code block and other text is left to the browser.

## Stage B1: markdown semantics without re-layout (1-2 November 2026)

Built by inference from D2's own output, pinned to D2 v0.9.0: heading levels from font size (32, 24, 20 px = `h1`..`h3`; sizes from `d2renderers/d2svg/github-markdown.css`), `strong`/`em`/`code` from the font asset, `a` from the scene link regions (one anchor per link; unsafe URLs stay href-less region anchors named after the object), lists, quotes, rules and fenced code from the bullet/bar/box rectangles. The association `label` (the source) only validates the result. Anything ambiguous stays unwrapped: headings of 16 px or less (h4..h6 look like body text), nested or wrapped list items, complex inline syntax, unmatched fences.

Checks: `semantic.spec.mjs` (10 tests) passes in Chromium, Firefox and WebKit, including the C1 test: zero pixel delta against the checkpoint painter for every content, table and shape case plus the markdown sample. `test:client` 62 passed, `test:features:paint` and `mise run check` pass. Links are left out of the Tab order in Safari/WebKit, so that assertion is skipped there as in `links.spec.mjs`.

At the B1 checkpoint, browser reflow (C2), h4..h6 and nested lists were not implemented. Stage B below adds opt-in reflow and h4..h6; nested lists still fall back.

## Stage B: optional markdown flow (2 November 2026)

Built and verified (2 November 2026): `semantic.spec.mjs` passes 13 of 13 in Chromium, Firefox and WebKit, `test:client` 65 passed, `test:features:paint` passes, `mise run check` passes. Opt-in; the default stays positioned.

API: `mount(host, { markdown: 'positioned' | 'flow' })`. Omitted or `'positioned'` keeps the existing painter and its output unchanged. Mount passes `flow: true` to `paintScene` only for `'flow'`. This affects HTML painting only. D2 still chooses geometry; no browser measurements are fed back to compilation.

For an association with `content === 'markdown'`, the association's `label` is parsed into one flowing HTML block at the original `:markdown` node's content origin. The block width is the x extent of `primBounds(n.Clip.Path)`, the viewport D2 used. The object group, `data-id`, accessible name, ARIA attributes and event delegation remain. Successful flow replaces the positioned markdown primitives; an optional D2 background rectangle remains. Inline links use the existing `hrefOf` safety boundary and replace their old scene hit regions, giving each source link one anchor and keyboard stop. If D2 disabled inline links (for example, a whole-object link), the object stays positioned.

Parser subset (`packages/d2web/src/markdown.js`): ATX h1–h6, paragraphs with soft line breaks, `**strong**`, `*em*`, single-backtick code, `[text](url)`, flat tight `- ` / numbered `. ` lists (including ordered starts), consecutive `> ` quote lines as one paragraph, exactly `---`, and triple-backtick fenced literals with an optional word/hyphen language name. Code fences preserve text and the final LF; inline code collapses spaces as D2 does. Link labels can contain supported inline markup. All text is HTML-escaped; raw HTML is never inserted.

Fallback is per whole object, before changing markup or consuming link regions. Unsupported/ambiguous syntax includes tables, underscore/intraword emphasis, strikethrough, images, entities, escapes, autolinks, reference links, link titles/complex destinations, nested emphasis/code combinations, nested/loose/continued lists, block content inside list items or quotes, setext headings, hard breaks, and unmatched/alternate fences. Empty markdown, missing source, unavailable required font faces, differing per-run fallback stacks for one face, nonstandard sizes, custom font families, strokes/decorations, transformed/effected/clipped ancestors and uncharacterized subtree shapes also stay in the existing positioned painter. This is a closed parser subset, not a CommonMark implementation.

Metrics come from the pinned upstream source, without editing it:

- `imports/d2/d2renderers/d2svg/github-markdown.css:25–34`: 16px body, line-height 1.5, wrapping; `:233–285`: heading scales, semibold face, line-height 1.25, quote/list padding; `:333–374`: first/last-child margins and 16px block margins; `:448–450`: list item spacing; `:589–648`: inline code 85%, code padding, fenced code 16px padding and line-height 1.45. Heading borders/padding are at `:70–75` and `:246–250`.
- `imports/d2/lib/textmeasure/markdown.go:22–64`: D2's matching measurement constants (heading/body/list/quote/rule/code sizes, line heights, padding and margins). `:330–334` and `:460–470`: SourceSansPro and SourceCodePro font selection. The flow CSS uses the scene's `font:SourceSansPro:regular|semibold|bold|italic` and `font:SourceCodePro:regular` through `fontStack` / `fontFamily`, including D2's supplied fallback assets. Colours/backgrounds come from the existing runs and rectangles.
- `imports/d2/d2renderers/d2scenebuild/markdown.go:146–147`: the D2 markdown clip viewport; `:284–307`: the run's measured `Ink` bounds. The fit reference box is that clip itself (below).

After `await mount.update(...)`, each flowed block has `data-flow-fit` containing JSON:

```json
{"d2":{"x":0,"y":0,"width":120,"height":24},"width":125,"height":24,"deltaWidth":5,"deltaHeight":0}
```

Numbers above illustrate the schema. `d2` is D2's own box for the object: the clip path D2 applied to the markdown, in markdown-local coordinates. (A first version used the union of the text runs' ink and wrongly reported 3 px / 9 px overflow, because ink leaves out code-block padding and rules.) `width` and `height` are the maximum of the flowed block's offset and scroll dimensions, in local CSS pixels (browser integer rounding, independent of viewport scaling); deltas subtract D2's union dimensions. `data-flow-d2` exposes that reference even in pure painter markup. Measurements are a snapshot at update, before consumer content replacement; they do not refresh after external font/CSS changes or hidden-host visibility changes. Consumers controlling fonts must make them ready before measuring. The union is distinct from the clip viewport: glyph extents can start above the origin or be narrower than the layout width. The flowed block, fenced code, markdown group and scene viewport leave overflow visible; no fixed height or markdown clip hides a C2 failure.

Checks in `semantic.spec.mjs` (already registered in `test:client`): real element tree/text including h4–h6, object/inline-link events and identity, one link anchor/focus stop, URL safety, clip width/reference bounds, visible overflow, byte-identical explicit/default positioned mode, and whole-object fallbacks. The original C1 checkpoint test is unchanged. The C2 test compiles every catalog entry and requested board, records each markdown object's fit or positioned-fallback status, prints the rows, and attaches `stage-b-flow-fit.json`. Width/height fit checks are soft literal zero-overflow assertions; **no tolerance has been accepted**. Positive deltas can make this diagnostic test fail, while still attaching all measurements. Set the first real threshold only after reviewing browser results.

Execution handoff:

- Changed files: `src/{markdown.js,paint.js,paint.d.ts,mount.ts}`, `tests/markdown.test.mjs`, `tests/browser/semantic.spec.mjs` under `packages/d2web/`, root `mise.toml` (`test:unit` includes parser checks), and this spec. Initially clean working tree; all changes remain uncommitted. No dependencies, imports, baselines or thresholds changed.
- `mise exec -- node --test packages/d2web/tests/markdown.test.mjs`: passed, three tests covering accepted markup, unsupported/ambiguous inputs, object identity, link overlay removal and whole-object fallback (including differing font stacks). Regressions were observed before implementation/fixes.
- `mise exec -- node --check` on `src/{markdown.js,paint.js,mount.ts}` and both edited/new test files: passed after final code edits.
- `mise run check`: passed after final code edits in 43.28 seconds; all 61 task definitions valid, including the new parser/painter tests, typecheck, native/Node-WASM and research gates. Log: `/tmp/d2web-stage-b-check-final.log`.
- Native product compiler inspection over all 298 catalog boards: default/`flow:false` HTML byte-identical to the committed painter, 24 markdown objects, 18 flowing and six positioned fallbacks. Real semantic sample produces one flow block and consumes its original inline link region. This proves emitted markup and unchanged default output, not browser layout or pixels.
- Pending reviewer commands: `mise run test:client` (C1, flow DOM/events and attached C2 deltas), `mise run test:features:paint` (default paint regression), then other browser/full gates as appropriate. No browser run was attempted, per task. C2 fit, browser copy/reading order and cross-browser wrapping remain unverified; no actual height/width deltas are available yet.

Measured over the 298 catalog boards plus the sample (Chromium; the same assertions pass in Firefox and WebKit): 24 markdown objects, **19 flow, 5 stay positioned**. All 19 fit: width delta 0 and height delta 0 for the 18 theme notes, width delta 0 and 18 px *shorter* than D2's box for the full sample (D2's box keeps trailing space the flow does not). The flowed quote bar, rule and code block sit within 0.4 px of D2's positions. The assertion is the strict one: no object may be wider or taller than D2's box.

Fallbacks, all deliberate: `content/markdown` (underscore emphasis and a lazy list continuation), `content/markdown-rich` (strikethrough), `content/markdown-table` (GFM table), and the one-line notes in the sketch and terminal themes (hand-drawn and monospace fonts differ, so the parser refuses). Nested lists and wrapped list items are still positioned. Positioned stays the default; flow is for consumers who want browser reflow.

Open: the 18 px of slack under the full sample (where D2's trailing space comes from), and the five fallbacks above if they should be flowed.
