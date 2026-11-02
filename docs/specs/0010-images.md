# Spec 0010: images and icons

Status: **proposed** (drafted 2 November 2026 after [ADR 0011](../adr/0011-images-like-native-d2.md) was accepted; nothing in it is built, and nothing here is accepted until the user says so). Implements ADR 0011's decision on top of [spec 0001](0001-compile-protocol.md) (protocol and scene), [spec 0004](0004-association.md) (association), [spec 0007](0007-fonts-and-text.md) (the page fetches, the worker stays offline) and the rules of [ADR 0009](../adr/0009-natural-web-forms.md) and [ADR 0010](../adr/0010-web-performance.md).

## 1. What is known

All of it from the [findings](../research-findings.md#images-and-icons-what-native-d2-does-2-november-2026) and the [probe](../../research/images.go); none of it needs the network.

- Native D2 has two image behaviours. The SVG writer fetches and inlines remote images by default (`--bundle`), or keeps the link (`--bundle=false`); the scene exporters (PNG, PDF, PPTX, GIF) fetch and paint, give an unreachable image a placeholder, and reject an SVG whose gradients sit outside `<defs>`. d2web's scene builder is the exporters' code, with the network and file system withheld.
- `d2compiler.Compile` returns the graph before layout. Walking it lists every image link, however it arrives (imports, vars, classes, globs, edges, layers, scenarios, steps), and that list is the set the scene builder then asks its resolver for. The preflight costs under 1 ms natively and about 27 ms in WASM, against 63 ms and 732 ms for the full layout and build of the same four-board test source.
- `imageasset.Resolver` is a concrete type, but its `HTTPClient` is public: a transport that answers from a map made an image a real scene asset, with no patch to D2. The resolver asks for a URL **without its fragment** (`#frag` is dropped) and with the host's case preserved, so the string D2 reports for an icon and the URL it requests can differ.
- The scene's asset set is closed (`FontAsset`, `RasterAsset`, `VectorAsset`), and every unavailable image shares one placeholder asset, so a scene cannot say which link an image was. The icon of a shape or connection is the scene node `<object id>:icon`.
- The painter reads raster and vector assets only; an unresolved image is the vector placeholder today.

## 2. Proposal

### 2.1 The consumer chooses a mode

`createClient({ images })`. Absent, nothing changes: no preflight, no fetch, the placeholder (today's behaviour; a regression test pins it).

```ts
images?:
  | { mode: 'bundle'; resolve: (source: string, ctx: { signal: AbortSignal }) => Promise<Blob | ArrayBuffer | Uint8Array | null>;
      supplied?: Record<string, Blob | ArrayBuffer | Uint8Array>;   // known bytes by link, tried before `resolve`
      limits?: { bytes?: number; count?: number; timeoutMs?: number; concurrency?: number } }
  | { mode: 'link' };
```

- `bundle` is native's default SVG behaviour (fetch at compile time, bytes inside the scene), with the page doing the fetching: the consumer's `resolve` is where origins, credentials, caching and CORS are decided. `resolve` returning `null`, throwing, timing out or exceeding a limit leaves that link unresolved (2.4).
- `link` is native's `--bundle=false`: the link is kept and the browser loads it.
- The two modes are exclusive in v1. A `fallback: 'link'` for links `resolve` cannot supply (a CORS failure does not stop an `<img>`) is open question 1.

### 2.2 Bundle flow

1. **Preflight.** The client sends `{ type: 'preflight', id, files, entry }`. The worker parses and compiles without layout and answers `{ type: 'images', id, links: [{ board, id, kind, source }], error? }` where `kind` is `icon`, `image` (a `shape: image`) or `edge-icon`, `id` is the D2 object or connection id, `board` is `''` or `layers.x`, `scenarios.x`, `steps.x`, and `source` is D2's own string for the link. A D2 error in the source is returned as `error` and the client skips the fetch: the normal compile that follows returns the same error.
2. **Select.** The client keeps only links the builder will request: `http:` and `https:` links, and anything else that is not a `data:` URI (relative paths and other schemes go to `resolve` as written, since a browser has no file system; the consumer may supply bytes or return `null`). A `data:` URI is never fetched. Distinct links are fetched once; the fragment is ignored when deciding what is distinct.
3. **Resolve.** For each missing link the client calls `supplied[source]` then `resolve(source, { signal })`, with the concurrency, byte, count and time limits in 2.5, an in-memory cache keyed by link (capped by the same limits) so a later compile with the same links makes no call, and the signal aborted when a newer compile supersedes this one (spec 0001 §3.4).
4. **Compile.** The compile request carries `images: Record<string, { type: string; data: Uint8Array }>` keyed by the link exactly as the preflight reported it. The worker serves them through the resolver's HTTP client: a request is answered from the entry whose key, **with its fragment removed**, equals the request URL; everything else gets an error, which D2 maps to its placeholder. `type` is the response's content type (`image/svg+xml`, `image/png`...); D2 sniffs the bytes as it does natively.
5. **Result.** SVG bytes come back as drawing primitives (D2's `d2svgimport`), raster bytes as embedded raster assets, both through the existing asset painting. `echo.images` repeats the mode used.

The preflight is skipped when the options give nothing to resolve (`supplied` covers every link) and in `link` mode. It adds one worker round trip, not a second layout (ADR 0010, strategy 3).

### 2.3 Link flow

No preflight and no fetch by the library. The compile paints D2's placeholder as today, and the worker adds, per object whose icon is a link the painter may show, an entry to the association payload (spec 0004): `AssociationObject.image?: { source: string; role: 'icon' | 'image' | 'edge-icon'; node: string }`, where `node` is the scene node (`<id>:icon`). The painter replaces that node's placeholder with `<img src="…" alt="" referrerpolicy="no-referrer" decoding="async">` positioned in the box D2 computed, `object-fit` from D2's aspect. Only `http:`, `https:` and `data:image/*` links produce an element (the allowlist of ADR 0009's link-safety rule); `javascript:`, `file:`, relative paths and anything else keep the placeholder. Loading is governed by the host page's own CSP `img-src`. A link that fails to load shows the browser's broken-image state inside D2's box: D2 has no say after layout, as in native SVG.

### 2.4 Unresolved images are a warning, not a failed board

A link that was requested but not supplied (or whose fetch failed, timed out, was too large or over the count) paints D2's placeholder, and the result's `diagnostics` gets a `warning` per link naming the link, the board and the object ids that use it (from the preflight). The diagnostic gains an optional `code` (`'image-unresolved'`, additive, protocol `v` stays 1). D2's own rejections, such as the gradients outside `<defs>` error, stay **errors** with D2's message, because that is what native does and a failed compile returns no board (spec 0001 §3.3). A strict option is open question 2.

### 2.5 Limits

Defaults follow D2's raster resolver (`d2cli/raster.go`) where it has one, and are the consumer's to change:

| Limit | Default | Source |
| --- | --- | --- |
| Bytes per image (encoded) | 4 MiB | the worker's existing `MaxFetchedBytes` |
| Images per compile | 256 | the worker's `MaxAssets` |
| Cumulative encoded bytes | 32 MiB | the worker's `MaxCumulativeEncodedBytes` |
| Time per `resolve` call | 15 s | proposed (D2's CLI uses one minute; a page should not wait that long) |
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
15. Demo: the regex `inlineRemoteImages` and its test are removed and the demo uses `images: { mode: 'bundle', resolve }`.
16. Docs: `docs/feature-map.md` and the capability matrix change the image rows; spec 0001 §4 "Self-contained" is amended to say links may be carried on the association side.

## 4. Open questions for the user

1. **Fallback to link.** Recommended: add `fallback: 'link'` to `bundle` (default off), so a link the consumer cannot supply because of CORS still loads in an `<img>`, which needs no CORS. Alternative: keep the two modes strictly exclusive.
2. **Strictness.** Recommended: no strict option in v1; an unresolved image is a warning, and consumers can turn warnings into failures themselves. Alternative: `strict: true` to fail the compile like native's default SVG.
3. **Timeout default.** Recommended: 15 s per `resolve` call. Alternative: D2's one minute.
4. **Local binary images.** Recommended: no file system; a relative path is a link like any other and goes to `resolve` or `supplied`. Alternative: extend `files` to carry binary values.
5. **A helper for the common case.** Recommended: ship a small `fetchImages({ allow: [origins], credentials: 'omit' })` in the package so most consumers do not write `resolve` by hand, but not as the default. Alternative: documentation only.
6. **`code` on diagnostics.** Recommended: add an optional `code` field now (additive). Alternative: message text only.

## 5. Verified, proposed, unknown

| Claim | State |
| --- | --- |
| The compiler lists image links before layout, from imports, vars, classes, globs, edges, layers, scenarios and steps | verified: `research/images.test.mjs` (native; the WASM half matched by hand, the test's WASM run cannot start in the authoring sandbox) |
| The list equals what the scene builder requests, `data:` URIs excepted | verified: same test |
| Supplied bytes reach the builder through the resolver's HTTP client with no patch | verified: same test |
| The resolver requests the URL without its fragment | verified: probe run, `#frag` dropped from `…a%20b.svg?x=1&y=2#frag` |
| The scene has no link-only asset; unavailable images share one placeholder | verified: `d2scene` source |
| The icon node is `<id>:icon` for shapes and connections | read from `d2scenebuild/assets.go`; for `shape: image` to be confirmed by test 13 |
| Native PDF, PPTX and GIF match PNG | measured once, dagre |
| The preflight in the worker protocol, the `images` field, the client modes and the diagnostics | proposed |
| The painter's `<img>` in `link` mode matches D2's icon box | proposed (test 11) |
| TALA changes nothing about images; arrowhead and table icons | unknown |
| Firefox and WebKit behaviour of any of it | unknown |
