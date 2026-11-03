# Drag past the origin (shift siblings)

## Problem Statement
How might we let an author drag a shape up or left past D2's `top`/`left` minimum (integers ≥ 0) without the canvas stopping them, using only D2's own text?

## Recommended Direction
The origin is invisible (the board is cropped to its content), so only relative positions are real. Write the dragged shape at 0 on the overshooting axis and add the overshoot to every other pinned shape in the same container, in one checked edit. Show the predicted result in the DOM at once, compensate the camera so nothing moves on screen, and always animate from the prediction to the worker's result. Side-effect lines get an accent mark in the source pane.

## Key Assumptions to Validate
- [x] Several `top`/`left` sets go in one edit (yes, up to 256 ops).
- [x] Top-level painted position equals (`left`, `top`) (yes, natively).
- [ ] Unpinned shapes stay put relative to the pinned ones (they drift up to 5 px; the animation absorbs it; pin-all only if this is not acceptable).
- [ ] Camera compensation and the snap animation land in one frame (Chromium pixel check).
- [ ] Same results on WASM and other seeds.

## MVP Scope
Top level and nested shift, visible overflow, optimistic DOM prediction, camera compensation, two diff marks, Chromium cases.

## Not Doing (and Why)
- Reparenting by dragging out of a container: spec 0015's `move`, decided by where the shape is released.
- Pinning unpinned siblings by default: freezes autolayout; only if drift forces it.
- A visible origin marker or a hard stop: breaks the infinite illusion.
- dagre/ELK positions: they ignore `top`/`left`.

## Open Questions
- (Settled: released in its own parent, padding band included, is a shift.)
