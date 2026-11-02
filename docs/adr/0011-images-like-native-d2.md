# 0011. Images and icons behave like native D2, adapted to the web

Status: proposed (written 2 November 2026 at the user's request; not yet accepted). Nothing here is implemented; the demo's regex-based inlining is a stopgap this would replace.

Context: a D2 source names images by link, for example `icon: https://icons.terrastruct.com/dev%2Fgo.svg` or `shape: image`. d2web compiles in a worker with a deliberately offline HTTP client (`packages/d2web-wasm/compile/compile.go`), so a remote image paints D2's placeholder and the consumer has had to "bake" its own images as `data:` URIs. That is clumsy and, until now, it was unclear which native behaviour it should match.

[Evidence](../research-findings.md#images-and-icons-what-native-d2-does-2-november-2026), from the pinned native `d2`:
- Native D2 has more than one image behaviour. SVG output fetches remote images at compile time and inlines them by default (`--bundle` is true); with `--bundle=false` the link is kept; local files are always read and inlined. PNG output uses the same `imageasset` resolver and `d2svgimport` as d2web's scene builder: it fetches and paints remote images, and an unreachable one paints a placeholder without failing.
- In default SVG output an unreachable image is an error (exit 1) with a partial result; in PNG it is a silent placeholder.
- An SVG with gradients outside `<defs>` (the Chrome and Safari icons) is rejected by the scene path natively, with the message d2web gives. That rejection is D2's rule, not a d2web deviation.
- d2web today equals the PNG/scene path minus the network and the file system.

Constraints already decided: the scene is self-contained and the worker stays offline ([spec 0001](../specs/0001-compile-protocol.md) §4, [ADR 0007](0007-product-scope-v1.md)); fonts are fetched by the page and handed to the worker ([spec 0007](../specs/0007-fonts-and-text.md)); D2 owns the semantics and d2web adds no policy or unrequested effects ([ADR 0009](0009-natural-web-forms.md)); link text is untrusted, and the painter already refuses `javascript:`, `vbscript:` and `data:` in `href` (ADR 0009 amendment); a failed compile returns no partial board (spec 0001 §3.3); performance is a standing constraint ([ADR 0010](0010-web-performance.md)).

Decision: d2web reproduces D2's image behaviours as explicit, consumer-chosen modes, with these web adaptations.

1. **A client `images` option names the mode.** Absent, the behaviour is today's: images are not fetched, and a remote image paints D2's placeholder (native PNG without the network). The two opt-in modes mirror native SVG:
   - `bundle` (native's default SVG behaviour): remote images become bytes inside the scene. The consumer supplies them, by a resolver function the client calls (fetching, caching, allowlisting and CORS handling are the consumer's), or by an explicit map keyed by the link exactly as written. The worker stays offline and reads the bytes from the request. SVG icons are imported as drawing primitives, exactly as natively.
   - `link` (native `--bundle=false`): the link is kept. The painter emits a real image element at the position D2 computed, and the browser loads it under the host page's CSP and CORS.
2. **Failure is a diagnostic, not a failed board.** An image that cannot be resolved in `bundle` mode paints D2's placeholder and adds a warning diagnostic naming the link, as native PNG does. This departs from default native SVG (an error with partial output) because d2web never returns a partial board. D2's own import rejections, such as gradients outside `<defs>`, stay errors with native's message.
3. **Local files do not exist in the browser.** A relative path is treated like any link the consumer must supply (the same `images` map or resolver); there is no file-system access.
4. **Untrusted sources.** `link` mode is opt-in because it makes the viewer's browser request whatever the D2 author wrote. Only `http`, `https` and image `data:` links reach an element; nothing else does, mirroring the link-safety rule.
5. **Limits follow D2's.** The byte, count and decoded-size limits the native raster resolver sets apply to what the worker accepts. Timeouts and origins belong to the consumer's fetch.
6. **Which links are needed comes from D2, not a regex.** The proposed way is a preflight that compiles without layout and returns the image links found after imports, vars and classes are resolved, so the consumer fetches once and the full compile runs once. This depends on D2's compiler exposing them before layout, which is unverified (see below).

Alternatives:
- **Keep only the placeholder** (today): clean but not native; every consumer must bake images, and the demo's regex shim misses links inside imported files, vars and classes.
- **The worker fetches by default**, as the native CLI does: it is the closest to native's default, but it is an unrequested effect (arbitrary requests from untrusted D2), it ignores the host's CORS, CSP and allowlist, and it breaks the self-contained scene. Rejected by ADRs 0007 and 0009.
- **Always keep the link**: matches only `--bundle=false`. It cannot give the SVG importer its bytes, so it cannot reproduce native's default SVG or PNG results.
- **Make the consumer bake every image, as the demo does**: this is the clunky status quo.

Consequences:
- The scene contract needs a way to carry a link-only image (an asset kind in spec 0001 §4; the painter currently reads only raster and vector assets). The protocol needs an `images` request field and, if the preflight is adopted, a new message. A spec numbered 0010 in `docs/specs` follows acceptance; it names each verified case.
- The demo's `inlineRemoteImages` is replaced by the client option and its test removed.
- `docs/feature-map.md` rows for remote icons change from "web-native, placeholder" to the chosen mode, and the capability matrix gains a row for images.
- `bundle` costs one more fetch before the first compile, or a second compile if the preflight is not possible. [ADR 0010](0010-web-performance.md) lists a worker-side cache of the laid-out diagram, which would make the second compile cheap.

Open before acceptance (evidence still to gather):
- Can the D2 compiler list the image links before layout, and does the scene builder have or need an asset kind for a link-only image? Unverified here.
- Native `.pdf`, `.pptx` and `.gif` behaviour, TALA, and the default limits and timeouts (the findings section says what was not established).
- Whether to offer a strict option that turns an unresolved image into an error, as native SVG does, and what the default is.
- Binary images that are not links: how a consumer supplies a local image, given that `files` is text only.

Reversal: if a host needs images fetched automatically and accepts the effect, a documented default resolver can be added later without changing these modes.
