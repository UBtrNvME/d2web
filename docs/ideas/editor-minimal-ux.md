# Minimal, gesture-led d2editor UI

Idea one-pager, 4 November 2026. Not an accepted ADR or spec. It proposes narrowing the "advertise everything" half of [ADR 0014](../adr/0014-advertised-capabilities.md) and [spec 0017](../specs/0017-capabilities.md) §3.3 after the user found the inspector cluttered. Only the user accepts the replacement.

## Principles (from the user)

1. The visual editor raises productivity; it does not document D2. The source pane is where power users get all of D2.
2. Omit what does not apply. Never show it disabled.
3. The canvas teaches by reacting (drop targets, handles, snapping), using familiar desktop idioms (Finder, Keynote, Figma): hover reveals, drag highlights, selection shows a few controls.
4. Keep ADR 0014's derivation: a control exists only if D2 honours it for that element, and the table is read from D2, not typed in. That is what makes omission correct.

## 1. What D2 forces (verified in `imports/d2` v0.9.0 by survey; line numbers in the survey are `compile.go` unless noted)

| D2 rule | Consequence for the UI |
| --- | --- |
| `image` takes no children outside a sequence diagram; `sql_table` / `class` children are rows; `text`/`code` stay childless in the editor | Such shapes are never highlighted as drop targets and offer no "add child" |
| `3d` only on rectangle/square/hexagon; `double-border` only on rectangle/square/circle/oval; `multiple` not on text/code/class/sql_table/image; `shadow` ignored on text/code/class/sql_table | The Effects controls appear per shape kind, or not at all |
| `top`/`left` only honoured by TALA and forbidden under grid, hierarchy and sequence-diagram parents | Free drag-to-place only where it works; elsewhere the drag reorders or reparents |
| `near` constants only on root-level shapes, not inside sequence diagrams or grids | Pin-to-corner shown only for root-level shapes |
| Grid children: no `top`/`left`, no edges from the grid to its own cells; grid is row/column count plus gap | In a grid the drag shows an insertion marker (reorder), not free placement |
| Sequence diagram: actors, spans (label cleared) and notes are derived from structure; messages only between actors/spans | Special containers: connect handles join actors; the user adds messages, not freeform lines |
| Connections cannot start from reserved keywords; endpoints on `sql_table` columns attach to the table; arrowheads come from a fixed list; arrowhead fields are connection-only | Connection controls are arrowhead and line style; the rest is source |
| `width`/`height` integers; circle/square need equal sides | A resize handle (if ever built) keeps the ratio on circle/square |
| `link` cannot target a board from a shape label/tooltip URL clash; `icon` needs `image` | Link and icon are single optional inputs on shapes only |
| Silently ignored vs error: shadow/filled ignored; 3d/double-border/multiple misuse fails at render | The editor must not offer a setting D2 silently ignores |

## 2. Gesture catalogue

| Semantic | Gesture and feedback | State |
| --- | --- | --- |
| Containment | Drag a shape over a container: container outline and tint; invalid targets (image, rows, content elements) do not react | Built; invalid targets already do not react |
| Connect | Hover shows four edge handles; drag draws a rubber band; valid targets highlight; empty space creates a shape | Built |
| Position (TALA) | Drag moves with snap guides; arrow keys nudge | Built; no guides yet |
| Position (other engines, grid) | Drag reparents or reorders; an insertion line shows where | Reparent built; reorder not |
| Rename | Double-click label edits in place | Not built (a field in the inspector today) |
| Create | Palette plus double-click on empty canvas | Palette built |
| Delete | Delete key, undo available | Key not confirmed |
| Connection select | Click the line; endpoints get dots; drag a dot to retarget | Not built |
| Resize | Corner handles, ratio-locked on circle/square | Not built; not in scope until asked |

## 3. Hierarchy: inheritance from one D2 element (user direction, 4 November 2026)

**Refinement (same day):** every selection is an *Element* and each kind inherits and adds. The inspector renders that chain: **Element** (name, stroke, opacity, text style) → **Node** (adds fill, a Type picker, children) or **Edge** (adds endpoints, arrowheads, dashed) → node kinds **Shape, Text, Table, Class, Image, Sequence, Grid** (each adds only its own surface). The Type picker is the one place a node changes kind, and any node kind can become any other: inherited values carry over, the kind's own section swaps. A change that would drop content (table columns, children a kind cannot hold) asks once and is undoable. Carry-over rules per pair (label to content, content to first row, children) are not yet verified against D2 and need probes before a spec. The table below is the earlier flat version of the same idea.

D2 has two elements, **node** and **edge**. Style and layout keywords only decorate them. A few properties change what a node *is*; each gets its own editing surface instead of more fields. The inspector is layered, and a selection shows only its own layer plus the common one.

| Layer | What makes it so in D2 | Its editing surface |
| --- | --- | --- |
| 0. Edge | `a -> b` | Endpoints, arrowheads, line style (below). Always separate from nodes. |
| 1. Plain node | no special shape or content | Name (the key) and one-line label, fill, stroke, shape picker. |
| 2. Text node | block string `\|md …\|`, `\|python …\|`, `\|latex …\|` | **A text editor, not a label.** Multi-line, Enter inserts a line and Shift+Enter or a click away commits (or the reverse; see question 6). Language picker for code, preview for markdown. The element's name stays a separate, small field. |
| 3. Structured node | `shape: sql_table` (rows with type and `constraint`), `shape: class` (fields and methods) | **A row editor**: add, rename, reorder and delete rows inline, the type as a second column, constraints as chips (primary, foreign, unique). Dragging between tables connects rows. No generic style fields beyond fill and stroke. |
| 4. Diagram node | `shape: sequence_diagram`, grid (`grid-rows`/`grid-columns`), `hierarchy` | **A mode of its container**: sequence: add actor, add message between actors, add note and span, ordering by drag; grid: row/column counts as a stepper, cells reorder by drag. The ordinary free-form gestures are replaced, not mixed in. |
| 5. Media node | `shape: image` (needs `icon`) | Image picker or URL; no children, no label-style fields. |

A node moves between layers by an explicit "Turn into…" (plain, text, table, class, …) that writes the matching D2; it does not change silently. Labels and text stay distinct: the name identifies the element, the label or text is its content.

Edit surfaces for layers 2–4 are separate follow-up slices, each needing its own spec; this document fixes only the structure.

## 3a. Inspector, common layer (replaces the generated field list)

Selection also shows a small floating toolbar at the element; the side panel carries the following for layers 0 and 1, and layers 2–5 replace the Label field with their own surface.

- **Shape / container:** Label · Shape (a picker of icons) · Fill · Stroke · Stroke width · Opacity · Icon. A container adds nothing; a zone is a container.
- **Effects row, only when D2 honours it for the current shape:** 3D, Shadow, Double border, Multiple. A shape that supports none shows no row.
- **Text element (markdown/code):** Content opens in a popover; code adds Language.
- **Connection:** Label · Colour · Width · Dashed · Start and End arrowheads (pickers) · Reverse (once the edit op exists).
- **Nothing else.** Position, size, `near`, grid, `direction`, fonts, `link`, `tooltip`, `vars`, `classes` and SQL constraints are edited in the source pane. Where a gesture exists (position, grid reorder) it replaces the field.
- **Removed:** the Fields list, Gestures list, Actions list, "Declared at", every disabled control and every "Reset" for a field not shown. Where a value comes from an import or a class, the control shows a small marker and not a sentence.

## 4. Proposed decision (for the user)

Supersede ADR 0014's second paragraph: the editor renders a *curated, per-kind subset* of what D2 honours, by omission, with gestures as the primary affordance. Keep the derivation from D2 and the probe tests, so each shown control is verified to change the compile. Spec 0017's Delivered line then needs rewording, and the fields not in §3 leave the inspector.

## 5. Open questions for the user

1. Is the §3 control set right, or should something be added or dropped (for example Font size, Bold)?
2. In-place label editing (double-click) replaces the Label field and Rename form: build it as part of this slice?
3. Connection retarget by dragging an endpoint dot: in this slice or later?
4. Floating toolbar at the selection (Figma-style) or a single right-hand panel only?
5. Accept the supersession in §4, so a spec and plan can follow?
6. Text nodes: Enter for a new line with Shift+Enter or Cmd+Enter to commit (code editor style), or the reverse (chat style)? Proposed: Enter newline, Cmd+Enter or blur commits, Escape cancels.
7. Slice order for the layers: text node first (smallest, biggest daily use), then tables and classes, then sequence and grid? Proposed: yes.

## Not checked

The survey did not trace `d2oracle`, icons on connections, or how edges that leave a sequence diagram render. The gesture table's "State" column comes from reading `main.ts`, `palette.ts` and `traits.ts`, not from running the editor.
