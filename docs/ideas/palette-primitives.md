# Palette primitives and traits for d2editor

Idea one-pager, 3 November 2026. Carried into [ADR 0013](../adr/0013-editor-traits-from-d2.md) and [spec 0015](../specs/0015-palette.md) (both accepted 3 November 2026). Not itself an accepted ADR or spec; see [ADR 0012](../adr/0012-editing-in-scope.md), [spec 0012](../specs/0012-edit-api.md), [spec 0013](../specs/0013-d2editor.md) and [spec 0014](../specs/0014-drag-to-position.md) for what exists.

## Problem statement

How might we let someone build an architecture diagram on the canvas (drop in markdown, code, icon shapes and zones, drag shapes into zones, draw connections) while every gesture becomes plain D2 that D2 lays out, and D2 text stays the source of truth?

Users: architects sketching systems and D2 authors; the text panel stays primary for both.

## Recommended direction

**The palette creates D2; traits derived from D2 act on it; edit ops are the only boundary.**

- **Palette entries are data**: `{ id, label, icon, ops(ctx) → EditOp[] }`, where `ctx` carries the drop target and selection. Entries come from two sources: built-ins (markdown, code, icon shape, zone) and the document's own `classes`, one entry per class, so a team's `vpc`, `env` or `subnet` becomes a palette item without editor config. Patterns later are one more entry source whose `ops()` returns many ops.
- **Traits are derived, never assigned.** A trait is `{ name, applies(object, ctx) → boolean, op producers → EditOp[] }`, with `ctx` holding the engine, association and source ownership. Storing "resizable" beside the D2 text would be a second source of truth; D2 and the engine already decide it. A new component type usually needs no code; a new behaviour is one new trait.

  | Trait | Applies when (derived from) | D2 it reads/writes |
  | --- | --- | --- |
  | Movable (exists, spec 0014) | engine is TALA; exact at top level only | `top`, `left` |
  | Container | not `image`, `sql_table`, `class`, `text`, `code` or a block string (see findings) | key path |
  | Reparentable | not from an import; target is not itself or its own descendant | key path (`move`) |
  | Connectable | shape can be a connection end | `a -> b` |
  | Text-editable | has a label or block string | label / block value |
  | Iconable | any shape | `icon` |
  | Resizable (later) | shape honours `width`/`height` | `width`, `height` |

- **Gesture arbitration lives in one place**, by hit region: edge handle → connect, body → move or reparent, label → edit. Traits only say what is allowed.
- **Invariants guard across traits** before any op is sent: no move into a descendant, unique key within a parent, imported objects read-only, and the result is whatever D2 compiled. The worker re-checks, since the edit API publishes checked patches.
- **Adapters only where a second implementation is real**: an icon source (`search(query) → {label, url}[]`, starting with a bundled terrastruct manifest) and layout capability (`canPosition(engine)`). Everything else is plain functions. A component plugin registry is rejected: under [ADR 0009](../adr/0009-natural-web-forms.md) the painter, not the editor, owns how each D2 element looks.

## Key assumptions to validate

- [x] **d2oracle `Move` rewrites references**: holds on the root board, with four guards needed (findings 1–4). Not a kill risk.
- [x] **Trait predicates match D2**: checked per shape; the Container rule changed (finding 5).
- [x] **Reparenting should drop positions**: confirmed (finding 6).
- [ ] **The deepest container under the pointer is the intended target**, including at nested zone edges (VPC > subnet). Needs the UI; Playwright case in the MVP.
- [ ] **Remote terrastruct icon URLs are acceptable for now**: URLs work, licence unresolved (finding 8).

## Research findings (3 November 2026)

Probe: [research/palette.go](../../research/palette.go) against D2 v0.9.0 (`cd imports/d2 && mise exec -- go run ../../research/palette.go`). Not wired into `mise run check`.

1. **`Move` rewrites root-board references.** `a -> db` becomes `vpc.a -> db`; moving a container with descendants carries its inner connections; moving out to the root works; `MoveIDDeltas` reports the new IDs. A connection declared inside the old parent is kept there as `svc: {_.vpc.a -> b}`: correct, but awkward text.
2. **Scenarios and steps are not rewritten.** With `scenarios: { s: { a -> b } }`, moving `a` leaves the scenario's `a -> b`, which now creates a second `a` there (scenarios inherit the base board). Layers are separate boards, so leaving them is correct. The `move` op must reject a move whose key is referenced in an inheriting board until this is handled.
3. **Moving into itself or its own descendant crashes the Go runtime** (stack overflow in `d2graph` `AbsID`). That is a fatal error, not a panic: the edit API's `recover` cannot catch it, and in WASM it kills the worker. The `move` op must check this before calling `Move`.
4. **Imported objects and name collisions.** Moving an object defined in an imported file writes nothing, but the deltas still report it as moved; with a local override (`a.style.fill` in the entry) only the override moves, duplicating `a`; an imported connection to a local shape does the same. Reject a move when any declaration of the shape, its descendants or their connections is in another file. Moving `a` into a container that already has an `a` silently renames it to `a 2`: surface that, or reject it.
5. **Which shapes hold children.** D2 compiles children under every shape except `image`, which fails with "image shapes cannot have children". But under `sql_table` and `class` a child becomes a row or field, and `text`, `code` or a `|md|` block with a child becomes a plain container whose content is replaced by its label. So Container excludes all six. Every shape tested can be a connection end.
6. **Pins after a reparent distort the zone.** Keeping `top: 900; left: 900` grew the VPC on TALA to 1073×1086; without pins TALA packs it at 246×186. Nested pins are offset by the container's padding (40/60 landed at 100/120). So `move` clears `top`/`left`.
7. **Palette entries work through existing ops.** `Set` with a tag writes `|md …|` and `|go …|` blocks; classes and `class:` set fine (the definition is written flattened as `classes.zone.style.stroke-dash: 3`); `Create "a -> b"` works. Order matters for icons: `shape: image` before `icon` fails to recompile ("image shape must include an icon field") and returns a nil graph, so the entry's ops set `icon` first.
8. **Icons.** AWS, GCP and Azure URLs on icons.terrastruct.com return SVGs. The site says the icons are free to use and existing URLs never change, but names no licence and publishes no manifest. AWS permits its icons for architecture diagrams but says nothing about redistributing them. Referencing URLs only (no copied images) is the lower-risk path; the manifest has to be built by hand, and the licence question goes to Terrastruct before shipping a vendored list.
9. **Document classes are not exposed to the browser.** The association and scene carry no class definitions, so the class-derived palette (direction C) needs the worker to report `classes` names, a small protocol addition.

## MVP scope

In:

1. `move` edit op wrapping d2oracle `Move`, specified as an addendum to spec 0012, with guards from findings 2–4 and pin clearing from finding 6.
2. Worker reports the document's class names (finding 9).
3. Palette entries: markdown (`|md|`), code, icon shape (`shape: image` plus a placeholder `icon:` until the curated set exists), zone.
4. Class-derived palette entries from the document's `classes`.
5. Traits: Container, Reparentable, Connectable, Text-editable; Movable already exists.
6. Drop-to-reparent: dropping a shape into a zone emits `move`, on every engine.
7. Drag-to-connect: edge handle on hover, rubber-band line as editor chrome, target highlight from `mount` hover events, snap to the nearest shape within a few pixels, `create a -> b` on drop. A drop on empty canvas creates a shape plus the connection and focuses its name.

Done when: from an empty canvas, a 3-tier AWS diagram (VPC zone; ALB, EC2 and RDS icons; a markdown note; connections) is built typing only labels; a Playwright case covers it; `mise run check` and `check:browser` pass.

## Not doing (and why)

- **Patterns or templates**: compositions, not primitives. Later as a palette entry source.
- **Resizable**: fits the trait model, but spec 0014 excluded it and the 3-tier test does not need it.
- **Connection ports or side anchors**: D2 has none; routing is the layout engine's (ADR 0009).
- **Component plugin registry**: speculative, and rendering is not the editor's concern.
- **Inline markdown/code editing on the canvas**: the inspector and text panel cover it.
- **Multi-select, alignment guides, grid**: separate gestures, no bearing on the 3-tier test.
- **Position-preserving reparent**: TALA nested placement is not exact yet (spec 0014).

## Decisions (user, 3 November 2026)

- `move` is its own edit op, so `rename` keeps its meaning.
- A zone's look is a generated `classes: { zone: … }` block added on first use, so the user restyles it in D2.
- ~~The icon manifest is vendored as names and URLs only~~ (superseded below).
- **Icons: our own curated set, later.** For now the icon entry inserts a placeholder icon; the curated list replaces it in a later slice, which also settles the licence question (finding 8). Every curated icon ships a sketched variant beside its plain one, used when the diagram renders in sketch mode.
- **The editor offers D2's sketch look.** A Sketch toggle sends `render.sketch` (already supported by d2web), is restored on reload and carried in share links (`sketch=1`).
- The code entry's language is picked in the inspector, starting from a plain code block.

## Status (3 November 2026)

- Done: MVP step 1, the `move` edit op (`packages/d2web-wasm/edit/edit.go`, row in spec 0012, `EditOp` in `packages/d2web/src/protocol.ts`), with Go tests for the rewrites, pin clearing and every refusal, and a WASM-equals-native case in `edit.spec.mjs`.
- Done: the editor's Sketch toggle (`packages/d2editor`), covered in `editor.spec.mjs`.
- Done (3 November 2026): the rest of the MVP per [spec 0015](../specs/0015-palette.md): palette entries, class buttons, drop into a zone, drag-to-connect, worker class lists and code language.
- Next: the curated icon set with sketched variants (its own spec).
- Verified: `mise run check` and `mise run check:browser` pass. One earlier `check` run failed a WASM test with a 61 s timeout under parallel load (the hang `tests/examples.mjs` documents); the rerun passed.
