# Spec 0016: d2editor, drag past the origin

Status: **accepted** (user, 3 November 2026: "accept"; the padding band counts as inside, the default proposed). **Built** 3 November 2026 (uncommitted): `mise run check` and `test:editor` (19 Chromium cases) pass; the full `check:browser` was not run. Extends [spec 0014](0014-drag-to-position.md) and works with [spec 0015](0015-palette.md) §3.3 (drag to move between containers). Idea and decisions: [drag past the origin](../ideas/drag-past-origin.md).

## 1. Objective

The author drags a shape up or left of where D2's `top`/`left` can express (they must be integers ≥ 0, spec 0014 §2) and the canvas never stops them. The infinite canvas stays an illusion kept by the editor; the text stays D2's own keywords.

## 2. Why it works in D2

Every fixed shape in one container shares an origin, and the board is cropped to its content, so the origin is never seen: only positions relative to each other are real. A negative position is written as the dragged shape at 0 on that axis and every other pinned shape in the same container moved by the overshoot. Measured 3 November 2026 (native compile, TALA seed 1, scratch scripts, not WASM):

- Top level: painted box X,Y equals (`left`, `top`) exactly; `render.pad` only widens the viewBox.
- Shifting all pinned shapes by (+40, +25) moved the pinned ones by exactly that and the unpinned ones by (39..40, 30..35): **unpinned shapes drift up to 5 px**, at the top level and inside a container (which grew).
- One `client.edit` takes up to 256 `set` ops as one transaction; `patch.edits` lists each changed range.

## 3. Behaviour

- The drag preview follows the pointer anywhere. The scene's inline `overflow:hidden` (`paint.js`) is overridden in the editor's adopted stylesheet with `[data-d2-scene] { overflow: visible !important }`.
- **Virtual state first.** On release the DOM already shows the predicted result: the dragged shape where it was dropped and its container's other shapes moved by the overshoot, camera compensated by the same amount so nothing on screen moves. The worker's compile is the truth.
- **Always animate the difference.** When the compile returns, every element whose painted box differs from the DOM's prediction animates to it (the layout snap, starting from the predicted state, not the last compile). Exact predictions do not move; drift and nested estimates glide.
- **The edit.** One `client.edit`: the dragged shape's `top`/`left` (clamped to 0 on the overshooting axis) plus `set` ops adding the overshoot to each other shape of the same container: pinned ones by their written values, unpinned ones pinned at their painted position plus the overshoot (user, 3 November 2026: "Yes", after the first-drag gap was found: with nothing pinned the dragged shape would otherwise land off the drop point). This only happens on an overshoot. One Undo step.
- **Shift or reparent.** Where the shape is released decides (spec 0015 §3.3, the palette spec: `dropTarget`). Released over another receiving container, or out to the root, it is a `move` (D2 places it there) and nothing here applies. Released in its own parent, even in the container's padding band left of its origin, it is a shift. Only that case writes `top`/`left`.
- **Diffs.** Every changed range is marked in the source pane. The dragged shape's own lines use the normal mark; lines changed as side effects (shifted siblings) use a second, accent mark.

## 4. Testing

Built and passing 3 November 2026 (`test:editor` 21 Chromium cases, three full runs):

- Node (`position.test.mjs`): the overshoot on x, on y and nested (only that container's shapes shift, against the container's origin); none when nothing overshoots; unpinned siblings pinned at their painted position.
- Chromium: a drop past the left origin keeps the shape visible mid-drag past the board's box; with the compile held (only the one the edit causes), the dropped shape stays under the pointer and the sibling has not moved on screen (the virtual state); per-frame sampling from release to the settled board shows the dropped shape never moves and the sibling stays within 6 screen px of where it stood; the relative layout survives; two mark classes; Undo restores the text in one step. A drop past the top origin, the same by y. A nested drop in the container's padding band shifts that container's pinned sibling. - Diff size: one overshoot drag on `a`/`b` (two unpinned shapes, one connection) rewrites 8 lines (both shapes' blocks: `top`, `left` and braces). Measured by the test (annotation `changed lines`, bounded at 10).

## 5. Boundaries

- Always: one checked edit per drop; D2's values; the prediction is replaced by the worker's result.
- Never: write positions from a canvas model; pin unpinned shapes except on an overshoot; add d2web API.
- Not in this slice: reparenting (spec 0015), dagre/ELK positions, a visible origin marker, nested circle accuracy (spec 0014 §3).

## 6. Found while building

- Ownership frames of an object's outer nodes are zero-sized, so screen positions are the union of their painted descendants (as `canvas.reveal` does).
- A compile finishing for the text a drop is editing (the idle one, say) would repaint and wipe the dropped shape's preview before the edit's result; it is ignored (`dropping`), found as a flaky test.
- A shape dropped outside the visible canvas is pulled back by the focus `reveal` (24 px margin); that is kept. The Chromium case pans first so the origin is in view.
- A patch range that touches both the dragged shape and a sibling counts as the author's; touching ends are not overlap.

## 7. Open

- Unmeasured: WASM versus native, several seeds (the drift figures), the pad/center `d2-config` variants, touch input, the full `check:browser`.
- Not built, by decision: dagre/ELK positions. Reparenting is spec 0015's `move`; a drop there is not a shift.
