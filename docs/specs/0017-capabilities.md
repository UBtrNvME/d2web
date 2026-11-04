# Spec 0017: d2editor, advertised fields, actions and interactions

Status: **accepted** (user, 4 November 2026: "Accept"), with ADR 0014 and the proposed defaults for §6: a "not drawn yet" note and a build-time JSON export. **Built** 4 November 2026 on `capabilities-0017` except the reverse action and arrow direction (blocked, see the Delivered line); `mise run check` and `test:editor` (32 cases) pass.
Delivered: partly delivered, and its rendering superseded (4 November 2026). Built and still true: the keyword table from D2 with probed domains and `capabilities()` for fields and their reasons. Replaced by [spec 0018](0018-element-kinds.md): §3.3 (show every field, disabled with a reason), §3.4 (the interactions panel) and the actions list are gone from the inspector, and `capabilities()` no longer returns actions or interactions; arrow-key moves remain. Not delivered: §3.5 reverse and arrow direction (a `reconnect` edit op the spec forbade in this slice).

## 1. Objective

Select a shape, a container, a content element or a connection and see, without prior D2 knowledge: every field it has, every value each field takes, every action available, every gesture that works on it, and why anything unavailable is unavailable.

## 2. Today (read from `packages/d2editor/src/main.ts`, `traits.ts`)

- Fields: label, fill, stroke, shape, icon (not for connections), code language. Free text except shape (a fixed list in the editor).
- Actions: rename, delete, palette create, connect, move, reparent.
- Gestures arbitrated by `press()`: handle → connect, body → move (TALA) or reparent.
- Not shown: opacity, stroke-width, stroke-dash, border-radius, fill-pattern, shadow, 3d, multiple, double-border, font fields, `near`, `link`, `tooltip`, `width`/`height`, `top`/`left`, grid keywords, `direction`, SQL constraints, connection arrowheads and direction.

## 3. Behaviour

3.1 **Description.** `capabilities(object, ctx)` returns:
- `fields[]`: `{key, label, domain, value, source, available, reason?}`. `domain` is one of `enum(values)`, `number(min,max,step)`, `color`, `boolean`, `text`, `reference`.
- `actions[]`: `{id, label, ops?, available, reason?}` (rename, delete, move into, add child, reverse connection, and so on).
- `interactions[]`: `{gesture, region, result}` taken from `press()` and the traits, for example `handle → connect`, `body → move on TALA`, `body → reparent elsewhere`.

3.2 **Source of values.** Keyword names and domains are exported from D2 (`d2ast` reserved keywords, `d2target` shapes, arrowhead names, style ranges) by the Go build and read by the editor. No enum is typed into TypeScript. A Node test compares the export with `imports/d2` at the pinned commit, so a D2 upgrade fails visibly.

3.3 **Inspector.** Sections per object kind: Content, Style, Layout, Interaction, Connection (arrowheads, direction, endpoints). Enums are selects, ranges are number inputs with bounds, colours keep the picker, booleans are checkboxes, and every control has a "reset to D2's default" that removes the declaration (`set` with a nil value). Each field shows its source as today. An unavailable field is shown disabled with D2's reason, not omitted.

3.4 **Interactions panel.** A short list on the selection: what a drag on the handle, the body and the label does here, and which keyboard keys work. Closes the open gap in the ledger: no keyboard way to move a shape.

3.5 **Connections.** Description includes source and target (clickable, selects the endpoint), direction (`->`, `<-`, `<->`, `--`), source and target arrowhead shape and fill, label, stroke fields, `animated`, and the action reverse.

3.6 **Edits.** Every control is one `client.edit` with `set`/`delete` ops; a field is advertised only if the worker accepts its op. Unchecked results use the existing dialog.

## 4. Testing

- Node: the exported keyword table equals D2's at the pinned commit; `capabilities` for a shape, a container, an `image`, a `sql_table`, a code block and a connection, each compared with a real D2 compile (a field marked available changes the compile, an unavailable one is refused or ignored as stated).
- Chromium (`test:editor`): selecting each kind lists the expected sections; setting an enum and a range changes the text only within `patch.edits`; reset removes the declaration; a disabled field shows its reason; reverse changes the direction.
- Run `mise run check` and `mise run test:editor`; report browser coverage that could not run.

## 5. Boundaries

- Always: values from D2's source; writes through `client.edit`; D2's default shown as a default.
- Never: a hand-typed enum or range; fields written from editor state; new d2web public API in this slice.
- Not in this slice: resizing handles, ports, inline label editing, `classes` authoring beyond picking an existing class.

## 6. Open questions for the user

1. Accept ADR 0014 and this spec as written?
2. Fields that D2 accepts but the web painter does not draw yet (to be listed by the build): advertise with a "not drawn yet" note (proposed), or hide?
3. Export route: a field on the worker's `ready` message (needs the protocol version decision from spec 0012) or a build-time generated JSON file shipped with d2editor (no protocol change; proposed).
