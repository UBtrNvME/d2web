# Browser support

Update, 2 November 2026: the focused semantic/text/font/mount, ownership and regression set passed **34/34 in Firefox and 34/34 in Playwright WebKit**. The former WebKit C1 sequence-diagram discrepancy came from the old checkpoint reference's unsupported fragment-mask transport. The test now transports the reference's own mask as an image; it still requires zero pixel delta. Runtime fixes cover scaled updates, animated object boundaries, pending/concurrent fonts and inline-link names. See the [current audit](web-native-audit.md) and [task ledger](../tasks/todo.md) for integrated Chromium results. No baseline or tolerance was relaxed. Real Safari remains unverified; the table below is older evidence, not a new full cross-browser run.

Measured 31 October 2026 on one macOS machine (Playwright browsers; versions are whatever `pnpm exec playwright install` pinned). The default and the feature map's reference is Chromium. `D2WEB_BROWSER=firefox|webkit` (see `playwright.config.mjs`) reruns any browser suite in another engine; `mise run test:firefox` and `mise run test:webkit` run the d2web suites and the feature-map comparison in those engines.

| Browser | Status | Evidence |
| --- | --- | --- |
| Chromium | supported, the reference | every gate |
| Firefox | works; small paint differences | `test:client` 29/29 (mount, links, animation, events, content, e2e), `test:consumer` 3/3 (native ESM, wrong wasm MIME type, restrictive CSP), feature paint 242 ok and 10 equivalent (edges up to a pixel apart) of 255 cases against native D2 rendered in the same Firefox, none open except the intended differences |
| Safari / WebKit | **works in Playwright's WebKit 27.2; real Safari not verified** | the worker start failure is fixed (below). `test:webkit`: 37 passed, 2 skipped (links are not in Safari's default Tab order) across mount, client, e2e, consumer (native ESM, wrong MIME type, CSP), content, events, links, animation, a11y; feature paint 248 ok and 4 equivalent of 255, the same as Chromium |

## Firefox differences (same engine renders D2's native SVG and our painter)

Compared with Chromium these cases cross the strict pixel bar in Firefox, and all of them pass the one-pixel tolerant bar (status `equivalent`) (`tests/features/baseline.firefox.json` guards them; `docs/feature-map.md` stays Chromium-only):
- `shape/oval`, `shape/circle`, `style/text-transform=lowercase`, `language/vars`: 3.5-4.5 % of the image differs and 26-27 % of the inked pixels, just over the ink bar; consistent with curve and text antialiasing, not checked glyph by glyph.
- `render/pad-scale-center`: 1.5 % of the image, 36 % of the ink; the painter scales content with a CSS transform, native with vector scaling, and Firefox rasterises scaled text differently.
- `style/fill-pattern=paper`: the grain is a noise filter; the two noise textures differ in detail (both look like paper).
- The same gaps as Chromium (text, LaTeX, remote icon, link/tooltip size, sketch shapes, overrides) remain.

Nothing in the product failed on Firefox; the differences are measurements, not bugs, until someone decides they are.

## Not covered

Real Safari (only Playwright's WebKit ran), mobile browsers, other Firefox versions, and the slow research suites (they stay Chromium).

## WebKit worker start (fixed 31 October 2026)

A WebKit worker has about 1/13 of the main thread's native stack (3.6k against 45k nested JS calls, measured), and the Go wasm used to die in `go.run` with `RangeError: Maximum call stack size exceeded`. Cause, found by reproducing it in Node with a 75 KB stack and a full stack trace: goldmark's `extension` package compiled two linkify regexps at package init, and their `{1,256}` repeats expand into about 450 nested regexp-compiler frames. D2 only uses goldmark's `Table` and `Strikethrough`, never `Linkify`.

Fix: `packages/d2web-wasm/third_party/goldmark` is goldmark v1.8.5 minus its tests and tooling, with those two regexps compiled on first use (`lazyRegexp` in `extension/linkify.go`); `go.mod` has a `replace` for it. D2's own checkout stays pristine. The MIT licence file is kept. `packages/d2web-wasm/tests/stack.test.mjs` (in `check`) starts the shipped wasm under a 75 KB Node stack and fails without the patch. An upstream goldmark issue or pull request is not drafted or posted.

Not verified: real Safari (only Playwright's WebKit), and that other Go start-up code stays below WebKit's worker stack as D2 updates; the stack test is the early warning, with the 75 KB figure chosen because the unpatched build failed at it.

## Focus tooltip test in Firefox (fixed 2 November 2026)

`links.spec` "a focus tooltip flips inside the board…" failed only in Firefox, with Tip A hidden. Neither `:focus-visible` nor `:has()` was at fault: the object group matched `:focus-visible` and the tooltip showed as soon as it had focus. The test reached each object with `focus()` then Shift+Tab, Tab. Chromium and WebKit move focus out of the page on Shift+Tab from the first tab stop, so Tab comes back to it; Playwright's Firefox leaves focus where it is, so Tab moves on to the next object and shows Tip B instead. The test now reaches each object with Tab, as a keyboard user does.

That exposed a real bug in all three engines: Escape's `data-dismissed` was cleared by a `focusout` listener on the shadow host, but a focus move between two objects inside the same shadow root retargets to the host on both sides and is not dispatched to it. A dismissed tooltip therefore stayed hidden until focus left the whole diagram. `mount()` now listens on the shadow root.

## Other WebKit notes

- **Tab to links:** `events.spec` and `links.spec` skip their Tab-focus parts in WebKit. Safari leaves links out of the Tab order unless the user enables it; focusable D2 objects use `tabindex`.
