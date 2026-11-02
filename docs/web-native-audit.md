# Web-native audit and browser review

## Current implementation (2 November 2026, after fixes)

The reviewed runtime defects now have fixes and regression coverage: text baselines are measured in local coordinates under scale; animated SVG fallback retains a named HTML object frame; font loads are shared and cannot register after disposal; recognized inline links are named by their own text. The native DOM implementation now owns paint topology, measurement, animation targets and event identity. `prepareBoard` exposes the complete typed scene, association and resources without a DOM; [spec 0011](specs/0011-rendering-contract.md) defines this input and single-owner consumer content.

`mise run check:full` passed after the fixes, including 87 Chromium product tests with 2 existing skips, the feature catalog, native/research comparisons and package/consumer/demo gates. The focused 34-test set passed in Firefox (34/34) and Playwright WebKit (34/34); the final copy/tooltip/content/semantic set passed 29/29 in each. The AWS demo replay displaced 0 of 53 labels after a blank-line edit at 64% fitted zoom; controlled updates at all five zoom levels had zero baseline movement and zero update pixel delta. WebKit's old C1 discrepancy was traced to the checkpoint reference's unsupported fragment-mask transport, not changed label geometry. The reference-only transport correction keeps its own paint independent and the zero-delta assertion unchanged. Exact final integrated results are in [the current task ledger](../tasks/todo.md#bug-fixes-and-rendering-contract-2-november-2026).

The missing upstream Git metadata was restored only after comparing all imported source files with the official pinned D2 commit; the imported source was unchanged. Root browser discovery now excludes nested worktrees/imports. Research census commands explicitly run the paint-artifact producer before its HTML consumer.

This remains a framework-independent native web runtime with incomplete semantic coverage. It is not a full React renderer or proof of complete browser/assistive-technology support. Native/browser font rasterization differences, native layout overlap and real Safari remain documented limits. No reference images or comparison thresholds were relaxed.

**Follow-up (2 November 2026, later):** object bounds are now D2's own box (association `box`), link regions carry the owner D2 added them for (association `links`, from D2's region order) instead of the containment estimate, and opt-in markdown flow renders D2's own goldmark document instead of a hand-written subset, so nested/continued lists, tables and D2's raw HTML elements flow; only images, the sketch/terminal fonts and D2's own measure/paint disagreement stay positioned ([spec 0009](specs/0009-semantic-content.md#stage-b-flow-from-d2s-own-markdown-document-2-november-2026), [spec 0004](specs/0004-association.md)). Real Safari and screen readers stay manual checks (below). Text: the browser shapes D2's runs with D2's fonts at D2's positions; glyph rasterisation differs by engine by nature and is closed as `equivalent` in the feature map, not a gap code can remove.

### Manual checks not automated here

- **Real Safari** (Playwright's WebKit is automated): enable *Develop > Allow Remote Automation* or run `sudo safaridriver --enable` once, then run a WebDriver smoke of the demo; or open `mise run demo` in Safari and check: the AWS example paints, Tab moves through objects, a link opens, a tooltip shows on focus, copy from a code block returns its lines. Flow markdown has no demo switch; check it through a page that mounts with `{ markdown: 'flow' }`.
- **Screen readers** (VoiceOver: Cmd+F5; NVDA on Windows): each object is a named group in paint order with its D2 label; connections announce their spelling as a description; tooltips are read on focus; code reads line by line; SQL/class tables navigate as tables; flowed markdown reads headings, lists and tables with their roles. Record the browser and reader versions with the result.

## Review baseline before these fixes (2 November 2026)

The following findings and measurements describe the pre-fix implementation and explain the work above.

d2web has a framework-independent native browser foundation: Go/WASM compilation in a worker, TypeScript lifecycle and events, HTML/SVG paint and Web Animations. SVG geometry is a valid native web form. The implementation is **not yet fully web native or free of rendering defects**. HTML element share and closed catalog rows do not prove semantic content, clipping, accessible behaviour or consumer replacement.

The review covers production source and docs, the Chromium client suite and feature catalog, focused Firefox/WebKit text checks, the user's AWS URL-shortener diagram (already present in `packages/d2web/demo/index.html`), and 17 additional text/container/layout cases. Measurements and screenshot pairs are in ignored `artifacts/browser-review/`; they are local evidence, not checked-in baselines. The original 1 November element census is retained below as history.

### Confirmed defect: updating under zoom shifts and clips text

**Priority at review: P1; fixed in the follow-up above.** `packages/d2web/src/mount.ts` `calibrate()` measures the baseline marker with `getBoundingClientRect()`, then subtracts that screen-pixel distance from the scene-coordinate `data-y`. An ancestor CSS scale changes the measured distance. Repeating `update()` with the same result therefore changes positioned text geometry, even though D2 has not changed anything.

Reproduction through the demo UI in Chromium:

1. Choose **URL shortener on AWS** and let the demo fit it to the canvas.
2. Add one blank line to the source, or change a render setting so the demo recompiles at its existing zoom.
3. The positioned text moves relative to shapes, routes and D2's markdown clip. Zooming above 100% before recompiling can move the markdown heading above its clip and cut it off.

Controlled replay with the same AWS compile result, matched icon bytes, native SVG and DOM screenshots measured this baseline shift for `edge.r53:label:0` (scene pixels):

| Ancestor scale during update | Baseline shift caused by update |
| --- | --- |
| 40% | +9.59 px |
| 75% | +4 px |
| 100% | 0 px |
| 150% | -8 px |
| 200% | -16 px |

At 200%, the heading was visibly clipped. At 40%, the native/web difference after update was about 4.63% of the whole image: this real defect can remain below the catalog's 5% image threshold. Shape-only scale assertions do not cover it. Evidence: `zoom-review.json`, `aws-url-shortener-chromium/zoom-*.{native,before-update,after-update}.png`, and `demo-review.json` with UI screenshots.

The next runtime fix belongs in baseline calibration: measure in the text's local coordinate system or correctly convert screen distances, then add a regression that updates the same board before and after zoom. Cover headings, multiline labels, connection labels, markdown clips, ancestor scale and the scene's own render scale. Changing D2's boxes or hiding overflow would conceal the defect. This review changes documentation, not that runtime code.

### Other confirmed browser defects and contract gaps

| Finding | Browser evidence and consequence | Smallest follow-up |
| --- | --- | --- |
| P1: animated shapes lose the object boundary | `x: Lift {style.animated: true}` produces an SVG `g` with no group role, name or tabindex. A bubbling click emits no D2 event. Replacing it with a consumer button gives a 0 by 0 rendered button under the SVG group. | Preserve the HTML object boundary around effect fallback; test animation together with accessibility, events and consumer content. |
| P2: disposal during font loading leaks a registration | Hold a real `FontFace.load()` continuation, dispose, then release it: update rejects with `MountError` but one font remains in `document.fonts`. | Check disposal before acquiring the late registration and cover pending-load disposal. |
| Inline markdown links use the whole object as their accessible name | Two links in one positioned markdown block both have the raw block as `aria-label`; the existing tests expect this. This follows the older object-level naming rule but loses per-link meaning. | Clarify the inline-link contract separately from the object group, then update naming and tests. |
| Painter replacement still reaches into mount | Mount interprets scene primitives for bounds, requires text baseline markers, assumes object-parent topology and binds primitive animations through `firstElementChild`. | Keep these rendering details behind a painter contract while preserving lifecycle and D2 identity. This is the unfinished boundary in ADR 0009. |

The first three rows have Chromium reproductions in `behavior-review.json`. The last row is source review, not a new browser failure.

### Text differences that need to be distinguished from the zoom defect

- Native SVG embeds subset fonts while HTML uses the scene's fonts and browser typography. At 100% in the matched-seed AWS comparison, all 53 positioned runs matched native text content; the longest paragraph was 2.45 px narrower in HTML. This is a measured width difference, distinct from the much larger vertical displacement caused by updating under scale. Existing `shape/text` and Unicode notes document kerning-related differences; the review does not prove the cause of every differing glyph.
- The AWS `create`/`POST /links` label is partly covered by a neighbouring Lambda icon in both native and web output, including the current matched-seed replay. This is native layout overlap, not evidence of a new DOM clip. Always compare the same TALA seeds: main changed from `[1]` to `[1,2,3]` during this review (`0212cf4`, merged in `21ae1ab`). A layout from the older default can differ substantially from plain native `d2`.
- Positioned markdown deliberately retains D2's clip. Flow markdown is opt-in, uses a closed subset and exposes fit metrics; unsupported tables, nested/continued lists and uncharacterized styles remain positioned. Flow is not a general workaround for incorrect baseline calibration of the other labels.
- The unscaled supplemental audit matched 743 positioned text runs over 21 render variants of 18 cases, both in the initial seed-1 pass and the updated-main seeds-1,2,3 pass. This verifies content matching and records bounds; it does not establish absence of every glyph-level clip, every board, every font or every browser.

### Verification and local setup limits

The Chromium client suite completed **79 passed, 2 skipped**, including a rerun after the TALA-seed merge; the focused text/font/mount set completed **24 passed**. Both initial and updated-main catalog passes rendered **298 board rows**: 276 `ok`, 8 `equivalent`, 1 `differs`, 3 `size-mismatch`, 10 `scene-checked`. Five catalog cases have intended `web-native` classifications in the generated report; nine rows are extra boards. The raw `shape/text` difference and link/tooltip canvas differences remain visible in the raw artifacts. Catalog closure does not cover update-under-zoom or the combined animation cases above.

Focused Firefox text/font/mount checks passed **24/24**. The same WebKit set passed **23/24**; its C1 checkpoint comparison failed for `shape/sequence_diagram` with a changed-pixel ratio of `0.0008539786415447126` against the required zero, and an isolated repeat failed with exactly the same ratio. Paired screenshots show connection-label placement differing from the checkpoint. This contradicts a blanket claim of current three-engine zero-delta verification. The cause is not established; no threshold or baseline was changed. Real Safari remains unverified.

This checkout's `imports/d2` lacks its `.git` metadata. `mise run check` stops at `reference:fetch`; this is not a green integrated gate. Ordinary patch detection can accidentally discover the outer repository and misidentify the pristine snapshot as patched, causing an invalid emoji build tag. Review commands used `GIT_CEILING_DIRECTORIES="$PWD/imports"` to keep patch checks local without changing imported source. The root Playwright test directory also discovers a nested `.claude/worktrees` checkout and loads Playwright twice. An ignored review config excludes `.claude`, `imports` and `node_modules`, while inheriting browser launch flags, viewport settings and screenshot thresholds from `playwright.config.mjs`.

Exact commands, current-revision reruns and the handoff are recorded in [the task ledger](../tasks/todo.md#browser-review-2-november-2026). The locked dependencies were restored for this review. No production renderer, imported source, accepted ADR, baseline or threshold was changed; no commit or push was made by this review. The 147-run native corpus, complete cross-browser product suites, real Safari and published-package integrations are outside the completed browser checks.

## Historical element census (1 November 2026)

The following counts predate the semantic content and focus-tooltip work. They are a historical baseline, not current completeness claims. Current semantics are described by [spec 0009](specs/0009-semantic-content.md): code has `pre`/`code`, SQL/class output has table roles, selected markdown gets semantic wrappers, multiline labels get a paragraph role and focus tooltips have a real tooltip element. Content still uses positioned runs by default.

What the painter emitted on 1 November, per feature family, against the web form each family names in `tests/features/web-forms.mjs` (ADR 0009). Measured over the 279 catalog cases that need no consumer fonts, by mounting each in Chromium and counting elements in the shadow root. The throwaway script is not kept; rerun the idea with `[data-k=rect|ellipse|text|image]` (HTML), `svg[style*="overflow:visible"]` (SVG fallback), `a[data-k=link]` and `[role=group]`.

### Historical totals

- 1652 painted elements are real HTML (positioned `div` for rectangles and ellipses, `div` for text, `img` for raster images); 603 nested SVGs carry what HTML cannot draw. **73 % of painted elements are HTML.**
- 810 `role=group` objects with D2's names, descriptions and nesting; real `<a>` elements for every link.

### What stays SVG, and why that is the target form

Paths (connection lines, non-rectangular shape outlines, arrowheads), gradient and pattern fills, dashed or translucent strokes, filters, masks, clips and blends, and vector icons. The named web form for these families is SVG, so a high SVG share there is correct, not a gap (sketch 50 %, sequence 52 %, themes 59 % HTML because themes repaint every shape).

### Historical per-family census

| Family | Cases | HTML share | Verdict |
| --- | --- | --- | --- |
| containers, label positions, grid, size | 2 / 33 / 6 / 2 | 100 % | met: HTML boxes and text, groups, geometry from D2 |
| content | 20 | 96 % | partly met: links are `<a>`, raster icons are `img`; markdown, code and tables are positioned text boxes, not `p`/`pre`/`code`/`table` |
| board, language, tooltip | 5 / 8 / 8 | 83-89 % | met as designed; tooltips are `title`, no focus display |
| shapes, styles, arrowheads, connections, near, colour, effects, table | 25 / 30 / 18 / 10 / 9 / 10 / 9 / 6 | 67-81 % | met: SVG for outlines and lines, HTML for text and boxes |
| icon positions | 33 | 75 % | met: vector icons stay inline SVG (the named form allows it) |
| direction, layout engines, config, themes | 5 / 3 / 9 / 21 | 59-64 % | met: lower share only because more lines are drawn |
| sketch, sequence, animation, render | 2 / 2 / 2 / 1 | 50-71 % | met: D2's drawing is SVG by nature; animation is the Web Animations API on the painted element |
| unicode (10) | not measured | | checked against D2's advances instead |

### Gaps recorded at the historical census

1. **Rich content is not semantic HTML.** Markdown, code blocks and SQL/class tables arrive from D2 as laid-out text runs and rectangles, so they are positioned text, with no `p`, `pre`, `code`, `table` or heading elements and no text reflow. Making them real elements means taking D2's markdown source (the association data carries it) and laying it out in HTML while keeping D2's box size. That conflicts with "faithful default" unless it is made an explicit, tested layout contract.
2. ~~Tooltips show through `title` only, not on keyboard focus~~ Fixed 2 November 2026 (spec 0009 stage C): focus shows a `role=tooltip` element.
3. **Text is one `div` per run**, not a paragraph per label, so selection across lines works but copy returns line fragments.
4. **Safari** and **Thai/Devanagari** shaping are unchecked.

The old census judged the remaining named forms met or SVG by design. The current review above adds failures in combined lifecycle, zoom and animation scenarios that an element census cannot detect.
