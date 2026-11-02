# Spec 0014: d2editor, drag to position

Status: **accepted** (user, 3 November 2026: "Approve, build it", including the section 4 d2web change).

## 1. Objective

The author drags a shape on the canvas and it stays where they drop it. The position lands in their D2 text as D2's own `top` and `left` keywords, through one checked edit (spec 0012), and TALA lays the rest of the diagram out around it. D2 still owns layout: nothing is positioned by the editor's own model.

## 2. D2's rules (pinned v0.9.0, checked in source and in the browser)

- `top` and `left` are non-negative integers (`d2compiler/compile.go`) and must be set together (`d2talalayout/adapter_validate.go`).
- **Only TALA honours them.** dagre and ELK reject the whole compile: "layout engine … does not support locked positions" (`d2plugin/plugin_features.go`).
- Coordinates: every fixed shape in one container shares an origin, `origin = painted top-left − (left, top)` (`layoutgraph/graph.go`, `fixedOrigin`). At the top level the origin is (0, 0): `a: {top: 100; left: 200}` paints at box X 200, Y 100, also with other fixed shapes far from the origin. Inside a container the origin is the container's corner plus TALA's `ContainerPadding` (60), more when the container has icons.

## 3. What the editor does

- **Drag a shape** (TALA selected): the shape follows the pointer at once (its painted nodes are translated, as the layout snap does); on release one `client.edit` sets `<id>.top` and `<id>.left`, the text is patched, TALA recompiles and the snap animates the rest. A press that moves less than 4 px stays a click (selects).
- **Drag empty space** pans, as now. Connections are not dragged.
- **Other engines:** a drag on a shape pans and the status says positions need TALA. Switching a diagram that has `top`/`left` to dagre or ELK shows D2's own error; the menu does not hide it.
- **The new value** (integers, never below 0):
  1. the shape already has `top`/`left`: old value + drag distance (exact);
  2. else a sibling in the same container has them: origin from that sibling (exact);
  3. else top level: origin (0, 0) (exact);
  4. else (nested, first fixed shape in its container): the container's box corner + 60. Exact without icons; with an icon the shape lands up to the icon padding off, and later drags are exact.
- Distances are in diagram units: screen pixels divided by the zoom.
- Undo restores the text before the drag (each drag is one history step). Removing a position is a text edit (or Undo).

## 4. d2web change (needs acceptance)

The association (spec 0004) gains `properties.top` and `properties.left` with their value and source when declared, exactly as `shape` was added (2 November 2026). Without them the editor cannot read the written values, and rules 1 and 2 would be estimates. No other d2web API changes; hit-testing uses mount's existing `hover` events.

## 5. Testing

- Go: `top`/`left` appear with source when declared and are absent otherwise.
- Node: the position rules (each of the four cases, clamping at 0, rounding, zoom).
- Chromium (`test:editor`): dragging a top-level shape writes exactly `top`/`left` by the patch; a second drag adds the distance; a nested shape beside a fixed sibling lands exactly; empty-space drag pans with no edit; on dagre a shape drag makes no edit and shows the hint; Undo restores the text.

## 6. Boundaries

- Always: one checked edit per drop; D2's values and errors as they are.
- Never: write positions from a canvas model; move shapes on engines that ignore positions; add other d2web API.
- Not in this slice: dragging connections or labels, multi-select, resizing (`width`/`height`), snapping to a grid, an "unpin" button, positions for dagre/ELK.
