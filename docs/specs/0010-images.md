# Spec 0010: images and icons

Status: **accepted with the recommended answers to questions 1-6** (user, 2 November 2026: "Use the options which are provided"; section 4 records them). Drafted the same day after [ADR 0011](../adr/0011-images-like-native-d2.md) was accepted. **Built in five slices on 2 November 2026** (section 6 records what the build showed and where it differs from the design). Implements ADR 0011's decision on top of [spec 0001](0001-compile-protocol.md) (protocol and scene), [spec 0004](0004-association.md) (association), [spec 0007](0007-fonts-and-text.md) (the page fetches, the worker stays offline) and the rules of [ADR 0009](../adr/0009-natural-web-forms.md) and [ADR 0010](../adr/0010-web-performance.md).

## 1. What is known

All of it from the [findings](../research-findings.md#images-and-icons-what-native-d2-does-2-november-2026) and the [probe](../../research/images.go); none of it needs the network.

- Native D2 has two image behaviours. The SVG writer fetches and inlines remote images by default (`--bundle`), or keeps the link (`--bundle=false`); the scene exporters (PNG, PDF, PPTX, GIF) fetch and paint, give an unreachable image a placeholder, and reject an SVG whose gradients sit outside `<defs>`. d2web's scene builder is the exporters' code, with the network and file system withheld.
- `d2compiler.Compile` returns the graph before layout. Walking it lists every image link, however it arrives (imports, vars, classes, globs, edges, layers, scenarios, steps), and that list is the set the scene builder then asks its resolver for. The preflight costs under 1 ms natively and about 27 ms in WASM, against 63 ms and 732 ms for the full layout and build of the same four-board test source.
- `imageasset.Resolver` is a concrete type, but its `HTTPClient` is public: a transport that answers from a map made an image a real scene asset, with no patch to D2. The resolver asks for a URL **without its fragment** (`#frag` is dropped) and with the host's case preserved, so the string D2 reports for an icon and the URL it requests can differ.
- The scene's asset set is closed (`FontAsset`, `RasterAsset`, `VectorAsset`), and every unavailable image shares one placeholder asset, so a scene cannot say which link an image was. The icon of a shape or connection is the scene node `<object id>:icon`.
- The painter reads raster and vector assets only; an unresolved image is the vector placeholder today.

## 2. Design (accepted)

### 2.1 The consumer chooses a mode

`createClient({ images })`. Absent, nothing changes: no preflight, no fetch, the placeholder (today's behaviour; a regression test pins it).

```ts
images?:
  | { mode: 'bundle'; resolve: (source: string, ctx: { signal: AbortSignal }) => Promise<Blob | ArrayBuffer | Uint8Array | null>;
      supplied?: Record<string, Blob | ArrayBuffer | Uint8Array>;   // known bytes by link, tried before `resolve`
      fallback?: 'link';                                             // links that stay unresolved are shown as links (2.3); default: placeholder
      limits?: { bytes?: number; count?: number; timeoutMs?: number; concurrency?: number } }
  | { mode: 'link' };
```

A small helper covers the common case so most consumers do not write `resolve` by hand; it is never the default:

```ts
fetchImages({ allow: string[] /* origins, e.g. 'https://icons.terrastruct.com' */, credentials?: 'omit' | 'same-origin' | 'include' /* default 'omit' */, fetch?: typeof fetch })
  // returns a `resolve`: a link whose origin is not in `allow` resolves to null (unresolved); otherwise the response body as a Blob, or null on a non-2xx or network failure
```

- `bundle` is native's default SVG behaviour (fetch at compile time, bytes inside the scene), with the page doing the fetching: the consumer's `resolve` is where origins, credentials, caching and CORS are decided. `resolve` returning `null`, throwing, timing out or exceeding a limit leaves that link unresolved (2.4).
- `link` is native's `--bundle=false`: the link is kept and the browser loads it.
- `fallback: 'link'` (decision 1) makes a link that `bundle` could not resolve (a CORS failure, an unsupplied origin) show as a link per 2.3, because an `<img>` needs no CORS. Without it an unresolved link is the placeholder. `mode: 'link'` and `mode: 'bundle'` are otherwise exclusive.

### 2.2 Bundle flow

1. **Preflight.** The client sends `{ type: 'preflight', id, files, entry }`. The worker parses and compiles without layout and answers `{ type: 'images', id, links: [{ board, id, kind, source }], error? }` where `kind` is `icon`, `image` (a `shape: image`) or `edge-icon`, `id` is the D2 object or connection id, `board` is `''` or `layers.x`, `scenarios.x`, `steps.x`, and `source` is D2's own string for the link. A D2 error in the source is returned as `error` and the client skips the fetch: the normal compile that follows returns the same error.
2. **Select.** The client keeps only links the builder will request: `http:` and `https:` links, and anything else that is not a `data:` URI (relative paths and other schemes go to `resolve` as written, since a browser has no file system and `files` stays text only, decision 4; the consumer may supply bytes or return `null`). A `data:` URI is never fetched. Distinct links are fetched once; the fragment is ignored when deciding what is distinct.
3. **Resolve.** For each missing link the client calls `supplied[source]` then `resolve(source, { signal })`, with the concurrency, byte, count and time limits in 2.5, an in-memory cache keyed by link (capped by the same limits) so a later compile with the same links makes no call, and the signal aborted when a newer compile supersedes this one (spec 0001 §3.4).
4. **Compile.** The compile request carries `images: Record<string, { type: string; data: Uint8Array }>` keyed by the link exactly as the preflight reported it. The worker serves them through the resolver's HTTP client: a request is answered from the entry whose key, **with its fragment removed**, equals the request URL; everything else gets an error, which D2 maps to its placeholder. `type` is the response's content type (`image/svg+xml`, `image/png`...); D2 sniffs the bytes as it does natively.
5. **Result.** SVG bytes come back as drawing primitives (D2's `d2svgimport`), raster bytes as embedded raster assets, both through the existing asset painting. `echo.images` repeats the mode used.

The preflight is skipped when the options give nothing to resolve (`supplied` covers every link) and in `link` mode. It adds one worker round trip, not a second layout (ADR 0010, strategy 3).

### 2.3 Link flow

In `mode: 'link'` there is no preflight and no fetch by the library; with `bundle` and `fallback: 'link'` the same applies to the links that stayed unresolved, and the worker reports only those. The compile paints D2's placeholder as today, and the worker adds, per object whose icon is a link the painter may show, an entry to the association payload (spec 0004): `AssociationObject.image?: { source: string; role: 'icon' | 'image' | 'edge-icon'; node: string }`, where `node` is the scene node (`<id>:icon`). The painter replaces that node's placeholder with `<img src="…" alt="" referrerpolicy="no-referrer" decoding="async">` positioned in the box D2 computed, `object-fit` from D2's aspect. Only `http:`, `https:` and `data:image/*` links produce an element (the allowlist of ADR 0009's link-safety rule); `javascript:`, `file:`, relative paths and anything else keep the placeholder. Loading is governed by the host page's own CSP `img-src`. A link that fails to load shows the browser's broken-image state inside D2's box: D2 has no say after layout, as in native SVG.

### 2.4 Unresolved images are a warning, not a failed board

A link that was requested but not supplied (or whose fetch failed, timed out, was too large or over the count) paints D2's placeholder, and the result's `diagnostics` gets a `warning` per link naming the link, the board and the object ids that use it (from the preflight). The diagnostic gains an optional `code` (`'image-unresolved'`, additive, protocol `v` stays 1; decision 6). With `fallback: 'link'` the warning is still reported, with the message saying the link is shown instead. D2's own rejections, such as the gradients outside `<defs>` error, stay **errors** with D2's message, because that is what native does and a failed compile returns no board (spec 0001 §3.3). There is no strict option in v1 (decision 2): a consumer who wants native SVG's failure can turn `code: 'image-unresolved'` diagnostics into its own error.

### 2.5 Limits

Defaults follow D2's raster resolver (`d2cli/raster.go`) where it has one, and are the consumer's to change:

| Limit | Default | Source |
| --- | --- | --- |
| Bytes per image (encoded) | 4 MiB | the worker's existing `MaxFetchedBytes` |
| Images per compile | 256 | the worker's `MaxAssets` |
| Cumulative encoded bytes | 32 MiB | the worker's `MaxCumulativeEncodedBytes` |
| Time per `resolve` call | 15 s | decision 3 (D2's CLI uses one minute; a page should not wait that long) |
| Concurrent `resolve` calls | 6 | proposed (browser per-host connection limit) |

The worker enforces the byte, count and cumulative limits again on what it receives. Exceeding one makes that image unresolved (2.4); it never fails the board.

### 2.6 Safety

- **Bundle**: the consumer's `resolve` is the policy point; the library fetches nothing itself. SVG bytes are parsed by D2's importer into primitives and never inserted as markup, so scripts, `foreignObject` and external references in an SVG cannot reach the page (to be verified with hostile inputs, test 12). Raster bytes are decoded by D2 and embedded.
- **Link**: opt-in, because rendering untrusted D2 makes the viewer's browser request whatever the author wrote (the same exposure as opening a native SVG). The scheme allowlist, `referrerpolicy="no-referrer"` and the host's CSP are the controls; the documentation says so in the same words.
- Credentials: the library never attaches any. A consumer's `resolve` decides (its own `fetch` options).

## 3. Test plan (proposed; each case is a verified case when it passes)

1. Unit: `images` is validated (mode, `resolve` a function, limits positive integers) with `ProtocolError` before any message is sent.
2. Unit, fake worker: bundle flow order is preflight, then `resolve` once per distinct link (a `#fragment` variant does not add a call), then a compile whose `images` keys are the preflight's `source` strings.
3. Unit: concurrency never exceeds the limit; a link that throws, returns `null`, times out or is too large is unresolved and the compile still happens.
4. Unit: a newer compile aborts the older one's `resolve` signals and its result is discarded (latest wins).
5. Unit: the cache means a second compile with the same links makes no `resolve` call, and is bounded.
6. Worker (Go): the map-backed transport serves by fragment-less URL, answers unknown URLs with an error, enforces the limits again, and never makes a network request (no `net` dial in the wasm).
7. Browser, Chromium, Firefox, WebKit: a source with an icon, a `shape: image` and an edge icon, with bytes supplied for each, paints real vectors and raster; the board's geometry and ink match the same source compiled natively with local files of the same bytes, within the existing 5% bar (feature-map case `icon-remote` becomes a compared case).
8. Browser: an unresolved link paints the placeholder and the result carries one `image-unresolved` warning naming the link, board and object ids; the board is otherwise unchanged.
9. Browser: an SVG with gradients outside `<defs>` makes the compile fail with D2's message and no boards, as native PNG does.
10. Browser, default (no `images` option): no preflight message, no request, placeholder: identical to today.
11. Browser, `link` mode: the painted `<img>` sits at D2's icon box with D2's aspect; `javascript:`, `file:`, relative and unknown schemes produce no element; a request log shows only the browser's own image loads and nothing from the library.
12. Browser, hostile bytes supplied by `resolve` (an SVG with `<script>`, `onload`, `foreignObject`, an external `href`, a billion-laughs style `use` chain): either D2 rejects it or the painted DOM contains none of them, and nothing executes.
13. Association: in `link` mode each object with an allowed link has `image.source` and `image.node`, and the node exists in the board's scene (`<id>:icon`, shape, image shape and edge).
14. Performance (ADR 0010): on the ecosystem demo example the preflight is under 5% of the compile; the compile count is unchanged; the camera-path measurements of ADR 0010 are unaffected.
15. Demo: the regex `inlineRemoteImages` and its test are removed and the demo uses `images: { mode: 'bundle', resolve: fetchImages({ allow: ['https://icons.terrastruct.com'] }), fallback: 'link' }`.
16. Unit: `fetchImages` resolves allowed origins with `credentials: 'omit'` by default, returns `null` for an origin outside `allow`, for a non-2xx and for a network failure, and never throws.
17. Browser: with `fallback: 'link'`, a link `resolve` returned `null` for is painted as an `<img>` by 2.3 (and still produces the `image-unresolved` warning), while a link that resolved is real vectors; without `fallback` it is the placeholder.
18. Docs: `docs/feature-map.md` and the capability matrix change the image rows; spec 0001 §4 "Self-contained" is amended to say links may be carried on the association side.

## 4. Decisions taken in review (user, 2 November 2026: "Use the options which are provided", that is, the recommended answers)

1. **Fallback to link: yes**, as `fallback: 'link'` on `bundle`, default off.
2. **Strictness: no strict option in v1.** An unresolved image is a warning; consumers can escalate it themselves.
3. **Timeout default: 15 s** per `resolve` call.
4. **Local binary images: no file system.** A relative path is a link like any other and goes to `resolve` or `supplied`; `files` stays text only.
5. **Helper: yes**, `fetchImages({ allow, credentials, fetch })`, not the default.
6. **`code` on diagnostics: yes**, optional and additive.

Still unknown, to be settled by the tests below and recorded here: the association entry's exact fields once `link` mode is built, TALA's effect on images, arrowhead and table icons, and Firefox and WebKit behaviour.

## 5. Verified, proposed, unknown

| Claim | State |
| --- | --- |
| The compiler lists image links before layout, from imports, vars, classes, globs, edges, layers, scenarios and steps | verified: `research/images.test.mjs` (native; the WASM half matched by hand, the test's WASM run cannot start in the authoring sandbox) |
| The list equals what the scene builder requests, `data:` URIs excepted | verified: same test |
| Supplied bytes reach the builder through the resolver's HTTP client with no patch | verified: same test |
| The resolver requests the URL without its fragment | verified: probe run, `#frag` dropped from `…a%20b.svg?x=1&y=2#frag` |
| The scene has no link-only asset; unavailable images share one placeholder | verified: `d2scene` source |
| The icon node is `<id>:icon` for shapes and connections | verified (Go test and Chromium test 13); a `shape: image` is `<id>:image` |
| Native PDF, PPTX and GIF match PNG | measured once, dagre |
| The preflight in the worker protocol, the `images` field, the client modes, `fetchImages`, the fallback and the diagnostics | verified: sections 3 and 6 |
| The painter's `<img>` in `link` mode matches D2's icon box | verified in Chromium: the element is positioned from D2's `Image` primitive box and aspect; not compared pixel-for-pixel with native `--bundle=false` output |
| TALA changes nothing about images; arrowhead and table icons | unknown (the Chromium tests use dagre-free default TALA for icon, image and edge icon; arrowhead and table icons not tried) |
| Firefox and WebKit behaviour of any of it | unknown (not run) |

## 6. As built (2 November 2026)

Commits `21aa5cc` (worker), `aa58b71` (client), `b08982d` (link mode), `09d2427` (relative paths, Chromium tests), `187f007` (demo). What the build showed, including every place it differs from the design above:

**Differences from the design**

- **Board paths** in the preflight and in diagnostics are the compile result's paths (`""`, `/layers/x`, `/scenarios/y`), not `layers.x`, so a consumer can match them to `available`. The root board's empty `board` is omitted from a diagnostic, like every other diagnostic.
- **A `shape: image` paints as the node `<id>:image`**, not `<id>:icon` (an icon on a shape or connection is `<id>:icon`). The association entry's `node` names whichever it is.
- **D2 refuses unsafe schemes itself.** `javascript:`, `file:`, `ftp:`, `//host/...` and a malformed `data:` URI fail the compile with D2's message in every mode, as native does. The painter's allowlist (`http`, `https`, image `data:`) is therefore a second line of defence; the only links that reach the placeholder are `http(s)` and relative paths.
- **Relative paths (decision 4) needed two things D2 does not do in a browser.** D2 reads a relative or absolute path from the file system, and the browser's `wasm_exec.js` answers every file call with "not implemented", which failed the whole compile (also before this spec). The worker now (1) answers the resolver's `Cache` for those paths from the supplied bytes, so a supplied relative path is a real asset, and (2) reports "no such file" instead of "not implemented", so an unsupplied one is the placeholder and a warning. This changes the default (no `images`) behaviour for a relative path from a failed compile to the placeholder, which is what native PNG does for a missing file. The cache key (`"file:" + absolute path`) is read from the pinned D2 v0.9.0 source; if it changed, the path would be unresolved, never wrong.
- **The preflight is skipped** when no file contains the word `icon` (any image needs one), not when `supplied` covers every link, which cannot be known without the preflight. The worker still warns about any link it was not given.
- **A failed link is remembered for 60 s** (a resolved one until evicted by the count or the 32 MiB cumulative limit), so a hanging link does not stall every keystroke by the 15 s timeout.
- **The request carries `linkImages: true`** (set by the client for `link` mode and for `bundle` with `fallback: 'link'`) to ask the worker for the association entries; `echo.images` is `'bundle'` or `'link'` when the request chose a mode and absent otherwise.

**Test plan state**

| Test | State |
| --- | --- |
| 1 option validation | verified (`images.test.mjs`) |
| 2 flow order, distinct links, fragment, keys, requested boards only | verified (`images.test.mjs`) |
| 3 failures, concurrency, count | verified (`images.test.mjs`) |
| 4 latest wins, abort without respawn | verified (`images.test.mjs`); relative path in Chromium |
| 5 cache, bound, failed-link memory | verified (`images.test.mjs`) |
| 6 worker transport and limits | verified (`compile/images_test.go`, `protocol.test.mjs`; the Node/WASM half cannot start in the authoring sandbox, run by hand: preflight and compile output equal native) |
| 7 bundle paints real vectors and raster | verified in Chromium; **the comparison with native output within 5% was not run** (no `d2` binary in the authoring sandbox), and Firefox and WebKit were not run |
| 8 unresolved warning | verified in Chromium |
| 9 gradient rejection | verified in Chromium |
| 10 default unchanged | verified (client unit test, Chromium: no preflight, no request, placeholder); a relative path now degrades to the placeholder instead of failing, as above |
| 11 link mode | verified in Chromium: element at D2's box, `no-referrer`, only the browser's own image requests; unsafe schemes are D2 errors |
| 12 hostile bytes | verified in Chromium: no script, `foreignObject`, handler or external reference reaches the DOM, nothing runs, no request |
| 13 association | verified (Go and Chromium) |
| 14 performance | preflight 9.7 ms against a 1532 ms compile on the ecosystem example once warm (0.6%), 160 ms against 3073 ms on the first run in a fresh worker (5.2%); one compile per update; the camera path is untouched. One machine, headless Chromium, no throttle |
| 15 demo | verified in Chromium (`test:demo`): shim and its test removed; icons fetched by the page and painted as vectors; with the fetch refused they are `<img>` and the status line counts them |
| 16 `fetchImages` | verified (`images.test.mjs`) |
| 17 fallback | verified (Go, client, Chromium) |
| 18 docs | done: feature map text, capability matrix row 5a, spec 0001 section 4, README, ADR 0011 status. The `icon-remote` case was not re-measured with `images` set |

**Still unknown:** Firefox and WebKit, native comparison of a supplied-bytes board, TALA's effect on images, arrowhead and table icons, cold-preflight cost on a phone, and whether a `Blob` URL or `ImageBitmap` path would avoid copying large rasters (not needed so far).
