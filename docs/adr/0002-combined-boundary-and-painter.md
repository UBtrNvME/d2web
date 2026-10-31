# 0002. Combined boundary, HTML-first painter, explicit fonts

Status: accepted for research scope (Checkpoint A, 31 October 2026). Not an architecture selection; Checkpoint B and R5 remain open.

Context: R1 and R2 evidence in [research findings](../research-findings.md) and [capability matrix](../capability-matrix.md). All 114 plain corpus boards are within 5% of native pixels in each painter; HTML-first with CSS masks renders 72% of primitives as real HTML.

Decision:
- Boundary: a prepared D2 scene for paint plus a thin association layer keyed by (revision, board path, ID) with source spans.
- Painter: R3 and R6 probe HTML-first with CSS masks.
- Fidelity bar: 5% raster difference from native SVG, with failures recorded.
- Fonts: explicit consumer-approved assets only; no fallback fetching; misses reported.

Alternatives: scene-first alone lost source ownership; semantic-first alone duplicated paint and measurement. All-SVG painting gives no per-element HTML for consumer replacement or accessibility. A 1% bar passes 85 of 114 cases until HTML edge snapping is traced. Bundled fallback fonts add large bytes (CJK 23.5 MB) and policy.

Consequences: the public contract, renderer coverage (full shape set, images, animation), lifecycle and edit atomicity stay unresolved. Reverse this if R3/R6 show HTML-first cannot isolate styles or support consumer content replacement.
