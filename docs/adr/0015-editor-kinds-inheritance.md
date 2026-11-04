# 0015. d2editor shows an element's kind and inheritance, and omits what does not apply

Status: accepted (user, 4 November 2026: "I accept")
Delivery: partly delivered (4 November 2026). Slice 1 of [spec 0018](../specs/0018-element-kinds.md) is built: the registry with Shape and Text, the layered inspector, the Type picker, the text surface, the code language search and the edge panel. Table, Class, Image, Sequence and Grid kinds, in-place label editing, the floating toolbar and endpoint retargeting are later slices.
Context: [ADR 0014](0014-advertised-capabilities.md) made the inspector list every field D2 has, with unavailable ones disabled and a reason. In use that is clutter. The author's direction: the visual editor exists to raise productivity, so it shows only what applies and matters; power users edit the rest in the source pane. D2 has two primitives, node and edge, and a few properties change what a node is (a block string, `shape: sql_table`, `class`, `image`, `sequence_diagram`, grid). Any node can become any other kind. Constraints: [ADR 0009](0009-natural-web-forms.md) (D2 owns semantics), [ADR 0012](0012-editing-in-scope.md) (edits go through the worker), [ADR 0013](0013-editor-traits-from-d2.md) (traits derived from D2).

Decision:
1. **Inheritance.** Every selection is an Element (name, stroke, opacity, text style). A Node adds fill, a Type picker and children; an Edge adds endpoints, arrowheads and dashed. Node kinds (Shape, Text, Table, Class, Image, Sequence, Grid) each add only their own surface. The inspector renders that chain: inherited sections first, then the kind's own.
2. **Omit, never disable.** A control that D2 does not honour for the element is not shown. Fields outside the curated set are edited in the source pane. This replaces the second paragraph of ADR 0014; its derivation from D2 (keyword table, probes) stays and is what decides "does not apply".
3. **Kinds are data in a registry.** A kind is a descriptor: how to detect it from an association object, its parent kind, its sections, and how to read and write the canonical node state. Adding a kind, a control or a D2 keyword touches one place each (spec 0018 §4).
4. **Any node kind converts to any other** through a canonical node state (name, text, style, children, rows), so N kinds need N descriptors, not N² conversions. Lossy conversions ask once and are undoable.

Alternatives:
- **Keep the flat generated field list with filters**: smaller change, but it keeps the single mixed panel the author rejected.
- **A separate hand-built panel per kind with no shared base**: simple to start, but inherited controls drift apart and conversions need pairwise code.
- **Pairwise conversion table**: explicit, but grows with the square of the kinds.

Consequences:
- ADR 0014's second paragraph and spec 0017 §3.3 (unavailable fields shown disabled) are superseded when this is accepted; its derivation test stays. Spec 0017 keeps its `Delivered:` line, reworded at that point.
- Fields outside the curated set (position, size, `near`, grid, fonts, `link`, `vars`) lose their inspector control; gestures cover position, the source pane covers the rest.
- A D2 upgrade that changes a keyword's domain or shape restrictions flips what is shown, with no editor code, and the kind probes fail visibly if a kind's detection or conversion breaks.
- Reversed by: conversions that cannot be made lossless-or-confirmable through edit ops (ADR 0012), in which case Type becomes read-only and kinds are created only from the palette.
