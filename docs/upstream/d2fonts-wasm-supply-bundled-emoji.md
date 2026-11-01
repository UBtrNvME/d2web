# d2fonts: let a wasm host supply D2's bundled Noto Color Emoji

Draft for the user to review and post; nothing has been sent. Written against D2 v0.9.0 (commit d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda). d2web carries it as a patch; whether D2 wants it is unknown.

## Problem

The wasm build omits the embedded Noto Color Emoji and says "the wasm host supplies resolved font data" (`d2renderers/d2fonts/noto_color_emoji_wasm.go`). That is true for ordinary fallback fonts (`FallbackResolver`), but D2 draws colour emoji only through its trusted path, which accepts only its own authenticated copy of the font. A host has no way to supply that copy, and a font listed through the public resolver does not work: D2's COLRv1 file fails the compile ("unsupported COLRv1 paint without an outline fallback"), and a bitmap font is accepted but ignored. Emoji then get the primary font's placeholder advance and the browser paints wider emoji.

## Change

- `d2fonts.SetBundledNotoColorEmoji(data []byte) error` (js/wasm only): registers the bytes through the same size and SHA-256 check the native loader uses, so any other font is refused, and makes `bundledNotoColorEmoji` return them.
- `internal/fontface`: the registry and COLRv1 plan code in `noto_color_emoji_native.go` embeds nothing, so it now builds on wasm too; the wasm stub file is deleted.

Not measured: the wasm size change, and whether the trusted path's behaviour on wasm matches native beyond d2web's one test (`packages/d2web/tests/browser/emoji.spec.mjs`).

d2web build: `D2WEB_ALLOW_PATCHED=1 mise run build` adds the `d2webpatched` tag; the client option is `createClient({ emoji: { name, url, sha256? } })`.
