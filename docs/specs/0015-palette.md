# Spec 0015: d2editor, palette, zones and drag-to-connect

Status: **accepted** (user, 3 November 2026: "Accept both, build"); **built** 3 November 2026 on `claude/connection-route-box`: `mise run check`, `check:browser` and `test:editor` (23 Chromium cases, 6 for this spec) pass. A palette insert waits for the current text to compile, so a class typed just before is not overwritten (Codex review). Changes made while building are marked *Built:* below. Section 7 resolved as proposed: only a Container is a drop target. Builds on [spec 0013](0013-d2editor.md), [spec 0014](0014-drag-to-position.md) and the `move` op in [spec 0012](0012-edit-api.md); structure per [ADR 0013](../adr/0013-editor-traits-from-d2.md). Research and decisions: [palette primitives](../ideas/palette-primitives.md).

## 1. Objective

From an empty canvas, an author builds a 3-tier architecture diagram typing only names and labels: a VPC zone, three icon shapes inside it, a markdown note, and connections between them. Every action lands in their D2 text as a checked patch, and D2 lays it out.

## 2. D2's rules (pinned v0.9.0, `research/palette.go`)

- `|md …|` and `|<lang> …|` block strings are written by `set` with a `tag`; the language is the tag.
- `shape: image` needs `icon` already set, or the recompile fails; an entry sets `icon` first.
- Children: `image` refuses them; under `sql_table` and `class` a child becomes a row or field; under `text`, `code` or a block string a child replaces the content with the label. Every shape can be a connection end.
- `move` (spec 0012) carries descendants, rewrites connections, clears the shape's own `top`/`left`, and refuses a move into itself, imported declarations, a name the parent has, and keys scenarios or steps reference.
- Classes: `classes.<name>.<attr>` defines, `<id>.class: <name>` applies.

## 3. What the editor does

### 3.1 Palette

The Shape button becomes a palette group in the toolbar: **Shape, Markdown, Code, Icon, Zone**, then one button per class the board defines (section 4), labelled with the class name. A click inserts inside the selected shape when it receives drops (3.2), else at the top level, selects the new shape and focuses its name, in one edit:

| Entry | Ops (`k` is the key `create` returns; `p.` the parent prefix) |
| --- | --- |
| Shape | `create p.shape` |
| Markdown | `create p.note`, `set k` = `# Note`, tag `md` |
| Code | `create p.code`, `set k` = `print("hello")`, tag `python` |
| Icon | `create p.service`, `set k.icon` = placeholder (3.5), `set k.shape` = `image` |
| Zone | when the board has no `zone` class: `set classes.zone.style.stroke-dash` = `3`, `set classes.zone.style.fill` = `transparent`; then `create p.zone`, `set k.class` = `zone` |
| class `c` | `create p.c`, `set k.class` = `c` |

`k` is chosen by the editor before the edit: the base name, else `name 2`, `name 3`… (D2's own scheme), the first not among the board's object IDs. So each entry is one transaction and one undo step; if D2 still returns another key, the editor selects the key `create` returned.

The inspector gains, for a code block, a **Language** field (`set id` with the current code and the new tag) and for any shape an **Icon** field (`set id.icon`).

### 3.2 Traits (editor-side checks, derived per ADR 0013)

- **Container**: a shape whose `shape` is not `image`, `sql_table`, `class`, `text` or `code`, and whose `content` is not `markdown`, `code` or `latex`.
- **Movable** (positions): engine is TALA (spec 0014).
- **Reparentable**: a shape the user may drop elsewhere; the worker's refusals (2) are shown as status messages.
- **Connectable**: any shape.
- *Built:* **Receives drops**: a Container that already holds shapes or has the `zone` class. Every plain rectangle is a Container in D2, so without this, repositioning a shape beside a sibling on TALA would nest it. This needs each object's applied classes, so the association also gained `classes` per object (section 4).

### 3.3 Drop into a zone

Dragging a shape now works on every engine. While dragging, the **target** is the deepest container that receives drops (3.2) whose box holds the pointer, excluding the dragged shape and its descendants; the root when none does. The target is outlined.

- target is not the shape's parent: drop sends `move` with `parent` = target. No position is written.
- target is the parent, TALA: drop writes `top`/`left` (spec 0014, unchanged).
- target is the parent, other engines: the shape returns; the status says positions need TALA.
- a refused `move` returns the shape and shows the worker's message.

### 3.4 Drag to connect

Hovering a shape shows four 14 px **handles** at its box's edge midpoints (editor chrome in the scene's coordinate parent, like the selection outline; not painted by d2web). Pressing a handle and dragging draws a straight rubber-band line from the handle to the pointer.

- Over a shape (the deepest one whose box holds the pointer, or the nearest within 12 screen pixels of its box), that shape is outlined; releasing sends `create src -> dst`. *Built:* a container that receives drops is not a connect target; releasing in its empty area creates the shape inside it.
- Over empty space, releasing creates a shape in the deepest Container under the pointer and connects to it (`create p.shape`, then `create src -> k`), then focuses the new shape's name.
- Releasing on the source, or Escape, cancels. The Connect button's two-click mode stays.

Press arbitration: a handle connects; a shape body drags (3.3); empty space pans.

### 3.5 Icons and images

The editor's client uses `images: { mode: 'link' }` (spec 0010), so `https:` icons show as `<img>`. Until the curated icon set exists the Icon entry writes one placeholder, `https://icons.terrastruct.com/essentials/112-server.svg`, defined once in the editor. The curated set, with a sketched variant per icon, is a later spec.

## 4. d2web changes

- **Classes per board**: each board's association gains `classes: string[]`, the names its `classes` map defines after imports and inheritance, sorted. Read from D2's IR, since the graph keeps only applied classes. In v0.9.0 both scenarios and layers carry the root's classes. Additive, so the protocol version stays.
- **Code language**: an association object whose `content` is `code` gains `language: string` (the block tag).
- *Built:* **Applied classes**: an association object gains `classes?: string[]`, the classes D2 applied to it (for 3.2).

Both are worker additions with Go tests and a WASM-equals-native case.

## 5. Verification

Unit (node): trait predicates over association fixtures; target and hit functions (deepest container, exclusion of self and descendants, 12 px snap); palette ops per entry.

Go: the classes list (imports, scenario and layer inheritance) and `language`.

Browser (`editor.spec.mjs`, real worker):
1. Each palette entry inserts the text in 3.1 and focuses the name; Zone defines the class once, the second Zone does not redefine it; a class button appears for a class typed into the text.
2. Dragging a shape into a zone patches `move` text; on dagre too; dragging out to empty space moves it to the root; dropping in its own parent on TALA writes `top`/`left`.
3. Dropping onto a markdown block, a code block or an image does not target it.
4. A refused move (scenario reference) returns the shape and shows the message, text unchanged.
5. Handle drag onto a shape creates the connection; onto empty space creates a shape and the connection; Escape cancels.
6. The 3-tier flow from an empty canvas, typing only names.

`mise run check` and `check:browser` pass.

## 6. Not in this spec

Resize; connection ports or sides; editing markdown or code on the canvas; multi-select; alignment guides; patterns; the curated icon set; dragging connections; keyboard equivalents of the drag gestures beyond today's Connect button (a follow-up for spec 0006 accessibility).

## 7. Open

- Whether a drop target should also accept a non-Container shape by moving into its parent instead (proposed: no; the target is only ever a Container).
