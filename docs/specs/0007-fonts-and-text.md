# Spec 0007: fallback fonts, right-to-left text and font styles

Status: **proposed** (31 October 2026; the user asked for the specs, nothing is built, nothing accepted). Builds on [ADR 0006](../adr/0006-font-delivery.md) (consumer-approved fonts, never fetched or substituted by the library), [spec 0001](0001-compile-protocol.md) (`result.fonts`, scenes carry glyph assets) and [ADR 0009](../adr/0009-natural-web-forms.md) (D2 owns semantics; d2web translates).

## 1. What is known

- The worker's wasm resolves **no fallback fonts** (no host filesystem). Text outside the bundled Source Sans Pro (CJK, Arabic, emoji, many accents beyond Latin-1) is laid out and painted on the primary font; whether the primary font draws tofu for those glyphs was not confirmed (`docs/research-findings.md`).
- Natively, D2's CLI resolves fallbacks from host fonts: on one Mac a 23.5 MB CJK face, a 0.75 MB Arabic face and a 5 MB colour-emoji face. A scene keeps a per-glyph asset (`Glyph.Asset`), so a scene built with fallbacks says which font each glyph needs.
- A browser repaint of native scenes with a CSS font stack of the primary plus the scene's fallbacks rendered CJK, joined Arabic and colour emoji, and the scene's advance sum matched the browser-measured width to 0.01 px. Native D2 SVG text, which relies on the browser's own fallback choice, was about 1 px wider, so the native SVG is not a stable reference for non-Latin text.
- Not measured: longer right-to-left text and mixed-direction lines, bold and italic fallbacks, other operating systems, subsetting.

## 2. Proposal

1. **Consumer-listed fallback fonts.** `createClient` (or each compile) accepts `fonts: [{ name, url, sha256? }]`, in the order the consumer prefers. The client fetches each URL once (browser cache applies), verifies the optional checksum, and hands the bytes to the worker, which adds them to D2's font resolver chain behind the bundled fonts. Nothing is fetched that the consumer did not list (ADR 0006).
2. **Scene and paint.** The scene then carries the per-glyph assets D2 chose; `result.fonts` carries their bytes; the mount registers them (existing `fonts: 'register'` path) and paints each text run with a CSS font stack of its primary asset followed by the fallbacks that run uses. Layout comes from D2's own advances, so nothing re-measures text.
3. **Missing glyphs are reported, not hidden.** When a run contains a character no listed font covers, `result.diagnostics` gets a `warning` naming the character and its object (D2 object id from the association payload). The text is still painted with whatever the browser draws.
4. **Right-to-left and mixed text.** Painted as text with the browser's own bidi, because that is the web's natural form; the test checks that the scene's advance sum and the browser width agree for Arabic and Hebrew examples, and records any difference as measured.
5. **Bold and italic.** D2 bundles the bold and italic faces it uses for layout. Styles without a bundled face on a fallback font are painted as the web does (the browser may synthesise); the spec records which cases do.

Not in this spec: bundling any non-D2 font (size budget 15 MB gzip for the wasm, spec 0003), automatic CDN fonts, subsetting, text editing.

## 3. Test plan (proposed)

1. Unit: the font list is validated (names, URLs, checksum shape) and rejected with `ProtocolError` before any fetch.
2. Browser, Chromium and Firefox and WebKit: an Arabic, a Hebrew, a Japanese and an emoji label compile with the consumer's fonts, paint without tofu, and the scene's run width matches the browser's within 0.5 px; a label whose character is in no listed font produces the missing-glyph warning.
3. A checksum mismatch fails the compile with a clear error and does not register the font.
4. The mount does not fetch anything itself; a request log of the test page shows only the consumer's listed URLs.
5. Feature map: add Unicode families (CJK, Arabic, Hebrew, emoji, accents) to the catalog, compared with native D2 only as recorded measurements (native depends on host fonts), plus pixel guards against a stored reference from this runtime.

## 4. Open questions for the user

1. **Where the fetch happens.** Recommended: the client (page thread) fetches and verifies, then transfers bytes to the worker, so the worker stays fetch-free and offline. Alternative: the worker fetches.
2. **A tiny built-in fallback.** Recommended: none in v1; the library bundles only D2's own fonts. Alternative: bundle a small subset (for example Latin Extended) to avoid tofu on accents.
3. **Missing glyphs.** Recommended: a warning diagnostic, text painted by the browser's own fallback. Alternative: fail the compile.
4. **Which fonts the catalog tests use.** Recommended: free fonts checked into `examples/` (licence file kept), not system fonts, so results do not depend on the machine.

## 5. Verified, proposed, unknown

| Claim | State |
| --- | --- |
| The wasm resolves no fallback fonts; native resolves host fonts | verified (research findings) |
| Browser repaint with scene fallbacks renders CJK, Arabic, emoji; advances match | measured once, Chromium, one machine |
| The worker can take consumer font bytes into D2's resolver chain | proposed; the resolver hook in `compile.go` is not yet written |
| Long RTL and mixed-direction text agrees with D2's advances | unknown |
| Bold and italic on fallback fonts | unknown |
| Firefox and WebKit text metrics | unknown |
