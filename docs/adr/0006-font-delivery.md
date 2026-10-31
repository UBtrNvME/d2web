# 0006. Font delivery: consumer-approved assets, loadable on demand

Status: accepted (user, 31 October 2026, after Checkpoint C discussion). Applies to the library design; the Checkpoint A rule (no fallback fetching the consumer did not approve) is unchanged.

Context: ADR 0002 set explicit consumer-approved font assets with no fallback fetching. WASM resolves no fallback fonts; fallback bytes are large (CJK 23.5 MB). D2 measures text with its own bundled fonts, so a different font shifts text.

Decision:
- The library bundles the fonts D2 itself uses for layout; any other font is listed by the consumer (name, URL, optionally a checksum) and loaded on demand from that URL, including a CDN the consumer approves. Common fonts may be bundled so that most boards need no request.
- The library never picks or fetches a font the consumer did not list; a missing glyph or font is reported, not silently replaced.

Alternatives: bundle everything (tens of megabytes); automatic CDN fallback (the library chooses a third party, privacy and availability).

Consequences: text measured with D2's fonts and painted with another font can differ by a pixel or two; mismatch reporting and caching are open.
