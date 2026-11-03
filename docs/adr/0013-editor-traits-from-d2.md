# 0013. d2editor components: palette entries as data, traits derived from D2

Status: accepted (user, 3 November 2026: "Accept both, build")
Delivery: delivered (4 November 2026). Parts 1–2: palette entries are `{id, label, ops(ctx)}` with the naming base in context; `packages/d2editor/src/traits.ts` derives container, connectable, movable and has-handle, and one press arbiter asks them. Predicates have native D2 compilation tests. Part 3 holds. Browser regression verification is pending because Chromium cannot launch in the sandbox; see [tasks/todo.md](../../tasks/todo.md).
Context: The d2editor palette grows from one Shape button to markdown, code, icon shapes, zones and the document's own classes, with drag-to-connect and drop-into-zone ([idea](../ideas/palette-primitives.md), [spec 0015](../specs/0015-palette.md)). New components will keep arriving, so the editor needs a shape that extends without growing a second model of the diagram. Constraints:
- [ADR 0009](0009-natural-web-forms.md): D2 owns semantics and d2web's painter owns each element's web form; the editor paints nothing per component.
- [ADR 0012](0012-editing-in-scope.md): the only write path is the worker edit API, whose checked patches keep D2 text the source of truth.
- Probe evidence ([findings](../ideas/palette-primitives.md#research-findings-3-november-2026)): what a shape can do is decided by D2 and the engine, and is not what one would guess. D2 compiles children under every shape but `image`, yet `sql_table` and `class` turn children into rows, and `text`, `code` and markdown blocks lose their content; only TALA honours `top`/`left`.

Decision: Three parts, and no others.
1. **Palette entries are data**: `{ id, label, ops(ctx) → EditOp[] }`. Built-in entries and one entry per class the document defines; a later source (patterns, a curated icon set) is one more list of entries.
2. **Traits are derived, never stored**: `{ name, applies(object, ctx) → boolean }` over the association object, the board and the engine, each predicate checked against D2 by a test. Gestures ask traits what is allowed; one function arbitrates a press by where it lands (edge handle, body).
3. **Edit ops are the only write path**: palette entries and gestures produce `EditOp[]` for `client.edit`; invariants (no move into itself, imported declarations read-only, unique keys) are checked by the worker and, for early feedback, by the editor.
Adapters exist only where a second implementation is real: the icon source and the engine's position capability.

Alternatives:
- **A component plugin registry** (each component registers its creation, inspector, gestures and painting): duplicates the painter, which ADR 0009 gives to d2web, and guesses extension points no consumer has asked for.
- **Traits assigned per component and stored by the editor**: a second source of truth beside the D2 text that drifts from what D2 compiles (the `text` and `sql_table` cases above would be wrong).
- **Hard-coded per-shape behaviour in gesture code**: works for four entries, but every new shape edits every gesture.

Consequences:
- A new D2 shape usually needs no editor code; a new behaviour is one trait plus its D2 test.
- The editor depends on the association carrying what traits read: shape, content, parent, box, references' files. Class names and a code block's language are not carried yet and are added by spec 0015.
- Resizing, ports and inline editing stay out until a spec adds their trait.
- Reversed by a component that cannot be expressed as D2 plus edit ops, or by traits that cannot be derived from what the worker reports.

Delivery note (4 November 2026): the compilation tests reproduce image rejection and table/class rows. Current D2 preserves text/code/markdown/latex content when children are added, contrary to the historical research claim above; the editor retains the accepted container exclusions to keep existing gestures unchanged.
