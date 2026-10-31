# 0003. Runtime shape: worker-hosted D2 wasm, shadow-root host, consumer-owned content

Status: accepted (user, 31 October 2026, after Checkpoint C discussion). Product implementation still needs the contracts it lists as unresolved.

Context: [research findings](../research-findings.md) sections on lifecycle, the measured-card loop, the persistent instance, the Web Worker and the shadcn consumer. A persistent wasm instance compiles a small board in 4.5 ms against 59 ms fresh; the same compile on the main thread blocks the page (zero timer ticks), in a worker the page ticked 275 times with a 12 ms longest gap. A shadow root plus an inner `all:initial` wrapper painted identically under hostile page CSS.

Decision:
- The D2 compiler, layout and theme run as Go/wasm in a dedicated Web Worker; one instance stays alive and serves requests one at a time.
- The consumer sends D2 source plus the measured pixel sizes of its own content (as `width`/`height` on nodes) and receives node boxes, edge routes and the scene; D2 owns layout.
- The painted diagram is mounted in a shadow root with per-mount ID prefixes; consumer content (for example a shadcn Card) is placed in the box D2 returns.
- Edge labels: D2 sizes space for its own label text only. A consumer may draw its own edge label by giving D2 a placeholder label with `style.font-color: transparent` and overlaying its element at the label position D2 returns; the overlay is not sized by D2 (whitespace-only placeholders crash TALA), so a label larger than the placeholder can overlap the edge. Containers are drawn as frames that adapt to D2's box.
- Bursts of changes use latest-wins; terminating the worker is the only abort and is used only when an in-flight compile has long left.

Alternatives: main-thread wasm freezes the page above about 25 nodes with TALA. A fresh instance per request costs about 13x per small compile. A plain mount without a shadow root leaks host CSS (selectors resized every painted element). Server-side compilation was not examined.

Consequences: containers cannot be sized by the consumer (see ADR 0005 for engines) and consumer edge labels are placeholder-sized, not measured by D2 (the user accepted this limit and asked whether to request size support upstream; not requested); the worker and wasm packaging, other browsers and the public message contract are unresolved. Reverse this if worker support, CSP or packaging proves unworkable for target consumers.
