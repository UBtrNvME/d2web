# Browser support

Measured 31 October 2026 on one macOS machine (Playwright browsers; versions are whatever `pnpm exec playwright install` pinned). The default and the feature map's reference is Chromium. `D2WEB_BROWSER=firefox|webkit` (see `playwright.config.mjs`) reruns any browser suite in another engine; `mise run test:firefox` runs the d2web suites and the feature-map comparison in Firefox.

| Browser | Status | Evidence |
| --- | --- | --- |
| Chromium | supported, the reference | every gate |
| Firefox | works; small paint differences | `test:client` 29/29 (mount, links, animation, events, content, e2e), `test:consumer` 3/3 (native ESM, wrong wasm MIME type, restrictive CSP), feature paint 241 of 255 cases ok against native D2 rendered in the same Firefox |
| Safari / WebKit | **unknown** | the Playwright WebKit build is not installed here, so nothing was run |

## Firefox differences (same engine renders D2's native SVG and our painter)

Compared with Chromium these cases cross the pixel bar in Firefox (`tests/features/baseline.firefox.json` guards them; `docs/feature-map.md` stays Chromium-only):
- `shape/oval`, `shape/circle`, `style/text-transform=lowercase`, `language/vars`: 3.5-4.5 % of the image differs and 26-27 % of the inked pixels, just over the ink bar; consistent with curve and text antialiasing, not checked glyph by glyph.
- `render/pad-scale-center`: 1.5 % of the image, 36 % of the ink; the painter scales content with a CSS transform, native with vector scaling, and Firefox rasterises scaled text differently.
- `style/fill-pattern=paper`: the grain is a noise filter; the two noise textures differ in detail (both look like paper).
- The same gaps as Chromium (text, LaTeX, remote icon, link/tooltip size, sketch shapes, overrides) remain.

Nothing in the product failed on Firefox; the differences are measurements, not bugs, until someone decides they are.

## Not covered

WebKit and Safari, mobile browsers, other Firefox versions, and the slow research suites (they stay Chromium).
