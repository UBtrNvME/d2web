# 0005. Layout engine policy: TALA by default, ELK or dagre as an explicit large-board switch

Status: accepted (user, 31 October 2026, after Checkpoint C discussion). The user prefers TALA and expects ELK/dagre to be less accurate; the research shows only that they are different layouts, so a quality comparison is still open.

Context: Chromium WASM timings on synthetic boards: TALA 0.5 s at 25 nodes, 2.7 s at 50, 18-24 s at 100, 55-70 s at 150 (native is about 5x faster with the same growth); dagre 1.0 s and ELK 3.5-5.6 s at 1000 nodes. The engines give different layouts; no quality comparison exists.

Decision:
- TALA is the default and the fidelity reference (the user's stated preference).
- ELK or dagre are available only as an explicit consumer choice (the engine is named in the request), never switched silently.

Alternatives: always TALA (unusable interactively above about 50 nodes); automatic switching (changes the picture without the consumer knowing).

Consequences: a consumer that wants interactivity on big boards accepts a different layout. A quality comparison and a node-count guideline are open.
