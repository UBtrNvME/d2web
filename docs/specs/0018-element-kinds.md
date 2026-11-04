# Spec 0018: d2editor, element kinds and the layered inspector

Status: **accepted** (user, 4 November 2026) with [ADR 0015](../adr/0015-editor-kinds-inheritance.md). Answers in §8: one Text kind with a Markdown / Code / LaTeX switch, and a language switch for Code; the proposed commit keys; slice 1 first. Supersedes the "advertise every field, disabled with a reason" part of [spec 0017](0017-capabilities.md) §3.3. Idea and boards: [minimal UX](../ideas/editor-minimal-ux.md) (the design preview is the "d2editor Layered UI" canvas).
Delivered: delivered (4 November 2026): all five slices of §7 are built (`tasks/todo-0018.md`), with the new ops of [spec 0019](0019-structure-edit-ops.md); only sequence groups are left to the source pane. Deviations: no loss sheet yet (Shape and Text lose nothing; `retype` falls back to the browser's `confirm`), no separate markdown preview (the canvas is the preview), the language search is a native `datalist`. A spec is a short-lived brief: it must end `delivered` (or be marked not delivered); an agent that finds it otherwise tells the user.

## 1. Objective

Select an element and see only: what it is (its kind), the controls it inherits, and the controls its kind adds. Change a node's kind from one Type picker. Anything D2 does not honour for the element is absent. Everything else is in the source pane. The system must be extendable by adding a descriptor, without touching the inspector.

## 2. Model

```
Element            name · stroke · opacity · text style (when it has text)
├─ Node            + fill · Type picker · children
│  ├─ Shape        + label · shape icons · effects (3D, shadow, double border, multiple)
│  ├─ Text         + content (md | code + language switch | latex)
│  ├─ Table        + columns · types · constraints            (slice 2)
│  ├─ Class        + fields · methods · visibility            (slice 2)
│  ├─ Image        + source                                   (slice 3)
│  ├─ Sequence     + actors · messages · notes                (slice 4)
│  └─ Grid         + columns · rows · gap                     (slice 4)
└─ Edge            + endpoints · arrowheads · dashed
```

A selection renders the sections of its path from the root. An association object matching no descriptor (for example `hierarchy`) renders Element and Node sections plus "Other kind: edit in source".

## 3. Behaviour

3.1 **Detection.** `kindOf(object)` returns the most specific descriptor whose `detect` matches the association (`kind`, `content`, `properties.shape`, `properties.gridRows` and so on). Detection reads the association, never the text.

3.2 **Sections and controls.** A section is `{id, title, controls[]}`. A control is `{keyword, widget}` where `widget` is one of a small vocabulary (`text`, `textarea`, `color`, `number`, `range`, `segmented`, `chips`, `toggle`, `rows`). A control is shown only if D2 honours its keyword for the element: this is decided from the keyword table (`only`/`not` per shape, connection set) and the compile probes of spec 0017 §4. A control that fails is dropped from the list, not disabled. Reset exists only on a control whose value is declared, and only as a small affordance on that control.

3.3 **Type picker.** Shown for nodes. Lists the registered node kinds. Choosing one runs the conversion of §3.4 as one `client.edit`, so one undo step restores it. The picker lists only kinds that exist in the registry; it never offers a kind that is not built.

3.4 **Conversion.** Each node descriptor implements `read(object) → Canonical` and `write(canonical, object) → EditOp[]`, where `Canonical = {name, text, style, children, rows}`. Converting A to B is `B.write(A.read(object))`. `loss(A, B, object)` names what B cannot hold (rows, children, content); when non-empty a confirm sheet states it ("This removes 2 columns. You can undo it.") before the edit. Cancel leaves the text unchanged. The ordered-pair matrix of the registered kinds is tested (§5).

3.5 **Edge.** Label, colour (stroke), width, solid or dashed, start and end arrowhead, and, once the worker supports it, reverse. No Type picker.

3.6 **Not in the inspector.** `top`, `left`, `width`, `height`, `near`, `direction`, grid fields outside the Grid kind, fonts beyond the text style, `link`, `tooltip`, `vars`, `classes`. They stay editable in the source pane. Position keeps its gestures (spec 0014, 0016).

3.7 **Removed.** The Fields, Gestures, Actions and "Declared at" lists and every disabled control. Where a value comes from an import, the control shows a small marker with the file in its tooltip; Reset is hidden for it (as in spec 0017).

3.8 **Traits stay.** [ADR 0013](../adr/0013-editor-traits-from-d2.md) traits (`container`, `connectable`, `movable`, `has-handle`) remain the only source of gesture behaviour and are still derived from D2. Kinds consume them and never duplicate them: conversion keeps children only where `container` applies to the target, and a kind that changes gestures (Sequence, Grid) does so by contributing to a trait's `applies`, not by adding gesture code. The press arbiter and drop-target highlights are unchanged by slice 1.

## 4. Extending the system

| To add | Do | Never |
| --- | --- | --- |
| A new D2 keyword or shape | Rebuild the keyword table from D2; controls that reference it appear when a kind lists them | Type a value list into the editor |
| A new node kind | One new file in a kinds folder under d2editor's `src` (to be created) exporting a descriptor (`id`, `extends`, `detect`, `sections`, `read`, `write`), added to the registry | Edit the inspector or other kinds |
| A new control widget | Add it to the vocabulary with a render and a read function; kinds then reference it by name | Build kind-specific DOM in `main.ts` |
| A D2 upgrade | Run the probes; a changed domain or restriction changes what shows, and a broken `detect` or `write` fails its test | Patch around a failing probe |

The registry and the vocabulary are the only extension points. Third-party kinds are not a goal.

## 5. Testing

- Node, per kind: `detect` selects exactly its objects across a corpus of D2 snippets; `read` then `write` of the same kind is the identity on the text; unmatched objects get the fallback.
- Node, matrix: for every ordered pair of registered node kinds, compile the converted text with D2; the result has no error, keeps name and style, and `loss` equals what disappeared (a generated test, so a new kind is covered by adding it).
- Node, applicability: for each kind and a sample of shapes, every shown control changes the compile when set, and no control is shown that D2 ignores (spec 0017 probes, kept).
- Chromium (`mise run test:editor`): selecting each kind shows its sections and none of the removed lists; the Type picker converts and one undo reverts; a lossy conversion shows the sheet and Cancel changes nothing; an edge shows no Type picker.
- Run `mise run check` and `mise run test:editor`; report browser coverage that could not run.

## 6. Boundaries

- Always: kinds and keyword applicability derived from D2 and the association; writes through `client.edit`.
- Ask first: adding an edit op to the worker (needed if a kind cannot be written with `set`, `create`, `rename`, `delete`, `move`); changing the keyword export format.
- Never: a hand-typed enum, range or shape restriction; a disabled control; a kind the registry does not contain in the Type picker.

## 7. Slices (for the plan)

1. Registry, Element and Node sections, Shape and Text kinds, Type picker for Shape and Text, removal of the old lists, edge panel.
2. Table and Class (row editor, constraint chips); first probe: can `set` write a `sql_table` column and `constraint`?
3. Image; in-place label editing; floating toolbar.
4. Sequence and Grid modes.
5. Endpoint retarget and reverse (needs the `reconnect` op blocked in spec 0017).

## 8. Decisions (user, 4 November 2026)

1. ADR 0015 and this spec accepted.
2. Text is one kind with a Markdown / Code / LaTeX switch. Code has its own language switch: the common languages as a menu with search over every language D2 highlights (list exported from D2's highlighter at build, not typed in). A tag D2 does not know is still written as typed, as the source pane allows.
3. Text commit keys: Enter newline, Cmd+Enter or click away saves, Escape cancels.
4. Slice 1 first.
5. Writing a block string: the editor already does it with `set` plus `tag` (`main.ts`, the language field), so no new edit op is expected. Task 1 of the plan confirms md, code and latex.
