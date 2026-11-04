# 0014. Elements advertise their fields, actions and values, derived from D2

Status: accepted (user, 4 November 2026: "Accept"; spec 0017 defaults taken); the second paragraph of the decision (render every field, unavailable ones disabled with a reason) is superseded by [ADR 0015](0015-editor-kinds-inheritance.md)
Delivery: partly delivered (4 November 2026). The derivation half is built: the keyword table exported from D2 and probed against it (`packages/d2web-wasm/keywords`), and `capabilities()` deciding which fields D2 honours. The rendering half was replaced by ADR 0015 and spec 0018: the inspector shows a curated subset by kind and omits what does not apply. Reverse and arrow direction stay open (`tasks/todo-0017.md` 5b).
Context: The d2editor inspector offers a fixed handful of fields (label, fill, stroke, shape, icon, language) and gestures (move, connect, reparent) that the author must already know about. The author asked for every element, connections included, to advertise the fields it has, the actions that can be performed on it, every interaction, and every value each field accepts. Constraints:
- [ADR 0009](0009-natural-web-forms.md): D2 owns semantics. A hand-written table of fields and enums in the editor would be a second model that drifts from D2 (the failure [ADR 0013](0013-editor-traits-from-d2.md) already rejected for traits).
- [ADR 0012](0012-editing-in-scope.md): the only write path is the worker edit API; each field edit is a `set` op, so a field is advertised only if its op is accepted.
- d2web must not add application policy; d2editor is a separate consumer.

Decision: Two parts.
1. **A capability description is derived, never hand-kept**: for an association object, `capabilities(object, ctx)` returns `{fields, actions, interactions}`. Fields come from D2's own reserved-keyword tables (`d2ast`, `d2target`) with their value domain (enum, number range, colour, boolean, free text), exported once by the Go worker build and checked by a test that compares them with D2's source at the pinned v0.9.0; actions come from the edit ops the worker accepts for that object; interactions come from the traits and the press arbiter (ADR 0013).
2. **The editor renders the description and nothing else**: the inspector lists fields and actions from it, offers only valid values, shows each field's source (declared, class, or D2 default), and marks a field or action unavailable with D2's reason (for example `top`/`left` off TALA, children under `image`, imported declarations read-only). Connections get their own description (arrowheads, direction, stroke fields, endpoints).

Alternatives:
- **Hand-written field schema in d2editor**: fastest, but it guesses D2's enums and ranges and rots on a D2 upgrade.
- **A schema API in d2web's public client**: widens the public surface before a second consumer asks; start inside the worker and the editor, promote on evidence.
- **Discover values by trial edits**: slow and writes text; rejected.

Consequences:
- A new D2 keyword appears in the editor when the pinned D2 source is updated and the derivation test passes, with no editor code.
- The worker gains one read-only message or `ready` field, so the protocol version question (spec 0001, 0012) must be answered in the spec before building.
- Fields D2 accepts but the web painter does not yet draw are advertised with that limit stated, not hidden.
- Reversed by a D2 version whose keyword tables cannot be read from the build, or by capabilities that depend on state the association cannot carry.
