# Spec 0014: d2editor, drag to position

Status: **accepted** (user, 3 November 2026: "Approve, build it", including the section 4 d2web change); **built** 3 November 2026 in four commits on `claude/d2editor-idea-probes` (`c158330`, `abb1dc1`, `ccadad4` and the docs commit): `mise run check` and `test:editor` pass; the full `check:browser` was not run. Not checked: touch input; nested drops in containers TALA resizes or moves land off the drop point by design (section 3).
Delivered: delivered, except the zoom unit case named in section 5. A spec is a short-lived brief: it must end `delivered` (or be marked not delivered); an agent that finds it otherwise tells the user. (Audited 4 November 2026.)

## 1. Objective

The author drags a shape on the canvas and it stays where they drop it. The position lands in their D2 text as D2's own `top` and `left` keywords, through one checked edit (spec 0012), and TALA lays the rest of the diagram out around it. D2 still owns layout: nothing is positioned by the editor's own model.

## 2. D2's rules (pinned v0.9.0, checked in source and in the browser)

- `top` and `left` are non-negative integers (`d2compiler/compile.go`) and must be set together (`d2talalayout/adapter_validate.go`).
- **Only TALA honours them.** dagre and ELK ignore them in D2's library compile, which d2web uses; only the `d2` CLI refuses such a diagram ("layout engine … does not support locked positions", `d2plugin.FeatureSupportCheck`, called from `d2cli/main.go` alone). Found while building task 3; the first draft said every compile refuses.
- Coordinates: every fixed shape in one container shares an origin, `origin = painted top-left − (left, top)` (`layoutgraph/graph.go`, `fixedOrigin`). At the top level the origin is (0, 0): `a: {top: 100; left: 200}` paints at box X 200, Y 100, also with other fixed shapes far from the origin. Inside a container the origin is the container's corner plus TALA's `ContainerPadding` (60), more when the container has icons.

## 3. What the editor does

- **Drag a shape** (TALA selected): the shape follows the pointer at once (its painted nodes are translated, as the layout snap does); on release one `client.edit` sets `<id>.top` and `<id>.left`, the text is patched, TALA recompiles and the snap animates the rest. A press that moves less than 4 px stays a click (selects).
- **Drag empty space** pans, as now. Connections are not dragged.
- **Other engines:** a drag on a shape pans and the status says positions need TALA. A diagram with `top`/`left` lays out on dagre or ELK as if they were absent, as in D2's library (the `d2` CLI would refuse it).
- **The new value** (integers, never below 0):
  1. the shape already has `top`/`left`: old value + drag distance (exact);
  2. else a sibling in the same container has them: origin from that sibling (exact);
  3. else top level: origin (0, 0) (exact);
  4. else (nested, first fixed shape in its container): the container's box corner + 60, an estimate.

  Only the top level is exact. Rules 1, 2 and 4 assume the container keeps its place and TALA's rectangle padding, but TALA's padding depends on the container's shape (a quarter for circles), icons, inside labels and size, and pinning a child can grow or move the container (a connection into it can move it whole). So a nested drop can land off the drop point: measured about 59 px in a circle on a first drop, and about 160 px when a connected container moved. Rule 2 beside a fixed sibling in a plain rectangle landed within 1 px.

  A measure-and-correct loop (up to eight secant steps against the container's painted corner, best attempt kept, one Undo step) was built on 3 November 2026 after stop-time reviews and brought most nested drops within 1 to 2 px, but some circle positions stayed about 20 px off under every variant (TALA keeps a circle's children inside it). The user chose to simplify instead ("Simplify instead"): the loop was removed and the code is the task 3 version. Measuring and correcting remains the upgrade path if nested accuracy matters.
- Distances are in diagram units: screen pixels divided by the zoom.
- Undo restores the text before the drag (each drag is one history step). Removing a position is a text edit (or Undo).

## 4. d2web change (needs acceptance)

The association (spec 0004) gains `properties.top` and `properties.left` with their value and source when declared, exactly as `shape` was added (2 November 2026). Without them the editor cannot read the written values, and rules 1 and 2 would be estimates. No other d2web API changes; hit-testing uses mount's existing `hover` events.

## 5. Testing

- Go: `top`/`left` appear with source when declared and are absent otherwise.
- Node: the position rules (each of the four cases, clamping at 0, rounding, zoom).
- Chromium (`test:editor`): dragging a top-level shape writes exactly `top`/`left` by the patch; a second drag adds the distance; a nested shape beside a fixed sibling lands exactly; empty-space drag pans with no edit; on dagre a diagram with positions still compiles, and a shape drag makes no edit, pans and shows the hint; Undo restores the text.

## 6. Boundaries

- Always: one checked edit per drop; D2's values and errors as they are.
- Never: write positions from a canvas model; move shapes on engines that ignore positions; add other d2web API.
- Not in this slice: dragging connections or labels, multi-select, resizing (`width`/`height`), snapping to a grid, an "unpin" button, positions for dagre/ELK.
