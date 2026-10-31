# Browser support

Measured 31 October 2026 on one macOS machine (Playwright browsers; versions are whatever `pnpm exec playwright install` pinned). The default and the feature map's reference is Chromium. `D2WEB_BROWSER=firefox|webkit` (see `playwright.config.mjs`) reruns any browser suite in another engine; `mise run test:firefox` and `mise run test:webkit` run the d2web suites and the feature-map comparison in those engines.

| Browser | Status | Evidence |
| --- | --- | --- |
| Chromium | supported, the reference | every gate |
| Firefox | works; small paint differences | `test:client` 29/29 (mount, links, animation, events, content, e2e), `test:consumer` 3/3 (native ESM, wrong wasm MIME type, restrictive CSP), feature paint 242 ok and 10 equivalent (edges up to a pixel apart) of 255 cases against native D2 rendered in the same Firefox, none open except the intended differences |
| Safari / WebKit | **unsupported for now (user decision, 31 October 2026)**: the worker cannot start the wasm; the rest works | Playwright WebKit 27.2 (a Safari-class engine, not Safari itself). In a Worker the Go wasm dies in `go.run` with `RangeError: Maximum call stack size exceeded`; the same wasm on the page thread starts. With the wasm on the page thread, feature paint is 248 ok and 4 equivalent of 255, the same as Chromium, and the mount, animation, content and association suites pass |

## Firefox differences (same engine renders D2's native SVG and our painter)

Compared with Chromium these cases cross the strict pixel bar in Firefox, and all of them pass the one-pixel tolerant bar (status `equivalent`) (`tests/features/baseline.firefox.json` guards them; `docs/feature-map.md` stays Chromium-only):
- `shape/oval`, `shape/circle`, `style/text-transform=lowercase`, `language/vars`: 3.5-4.5 % of the image differs and 26-27 % of the inked pixels, just over the ink bar; consistent with curve and text antialiasing, not checked glyph by glyph.
- `render/pad-scale-center`: 1.5 % of the image, 36 % of the ink; the painter scales content with a CSS transform, native with vector scaling, and Firefox rasterises scaled text differently.
- `style/fill-pattern=paper`: the grain is a noise filter; the two noise textures differ in detail (both look like paper).
- The same gaps as Chromium (text, LaTeX, remote icon, link/tooltip size, sketch shapes, overrides) remain.

Nothing in the product failed on Firefox; the differences are measurements, not bugs, until someone decides they are.

## Not covered

Real Safari, mobile browsers, other Firefox versions, and the slow research suites (they stay Chromium).

## WebKit details

- **Worker start failure (blocking for the shipped design):** fetch, compile and instantiate succeed in a WebKit worker; `go.run` then throws a stack overflow. The same call works on the main thread, so WebKit's worker threads have a smaller native stack than the Go runtime's start-up needs. Not fixed and not worked around. The user chose to declare Safari unsupported for now (31 October 2026); the other options stay open for later: a main-thread fallback that blocks the page during compiles, or a Go build with a shallower start-up (not investigated). Whether real Safari behaves like Playwright's WebKit is not verified.
- **Test mode:** `D2WEB_MAIN_THREAD=1` makes the test harness host the wasm on the page thread behind the same client interface. One Go runtime per page, so the specs that respawn or time out workers (`client.spec`, `e2e.spec`, `consumer.spec`) do not run in this mode.
- **Tab to links:** `events.spec` and `links.spec` Tab-focus tests fail in WebKit. Safari does not put links in the Tab order unless the user turns that preference on; this is platform behaviour, not a d2web defect (focusable D2 objects use `tabindex`). Not isolated further.
