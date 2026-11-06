# Spec 0023: d2editor source pane, outline, folding and provenance

Status: **accepted** (user, 6 November 2026: "accept"; both open questions left at the spec's defaults: provenance without naming the origin, outline in the source column). Slice 4 of [spec 0020](0020-source-pane.md); amends [spec 0004](0004-association.md) (two optional fields); builds on [spec 0022](0022-source-pane-value-widgets.md) and [ADR 0016](../adr/0016-source-pane-codemirror.md) §2 (text is the only state), §3 (a view is a projection, an edit is a text edit) and §5 (the last good association).
Delivered: delivered 6 November 2026 (Go `bodies` and `inherited` built here; editor side built by a Codex worker, reviewed and verified here). Limits: root board and the entry file only; provenance does not name the origin (class or glob); dist/main.js grew from 449,681 to 468,646 bytes, for the user to accept. A spec is a short-lived brief: it must end `delivered` (or be marked not delivered); an agent that finds it otherwise tells the user.

None of the three changes the text, so none touches `history.ts`. All three read the last good association and are hidden or frozen the way spec 0022 §1 says while the text does not compile.

## 1. Where the data comes from

D2 decides structure. The outline needs nothing new (`parent`, `kind`, `label`, `references`). `references` are key paths only (`a`, not `a: {...}`), so two things the association did not carry are added, both from D2's syntax tree like `literal`:

```
Object.bodies?: [ { start: Pos, end: Pos } ]   // one per declaration of this object that has a multi-line map value, from its `{` to its `}`
```

- Only maps that span more than one line, in the entry file's text; none for single-line maps, block strings or imported files. Positions are UTF-16 like every association range. Protocol version stays 2 (additive, as spec 0019 and 0022).
- No new worker call and no new round trip. The slice 2 tokenizer is not consulted for structure (it stays for highlighting and completion).

```
Property.inherited?: true      // the property's `source` lies outside every full declaration (`key: value` statement) of this object
```

- `inherited` is set by the worker from D2's own references (their whole map keys), so a class, a glob or another statement that supplies the value is told apart from the object's own declaration, including single-line maps and dotted keys (`b.style.opacity: 0.5`). The page never decides ownership from ranges or from the tokenizer.

## 2. Outline

A tree of the root board's objects in the source pane's side column, built from the association: shapes nested by `parent` in declaration order, then connections as `src -> dst` under the board. Each row shows the label (the id when the label is empty) and the kind of container, no other chrome.

- Clicking a row puts the caret on the object's first reference and selects it on the canvas, exactly as a canvas selection does (spec 0020 §1.3). The row of the caret's innermost object (`objectsAt`) is marked current as the caret moves.
- Keyboard: it is a native `role="tree"` with roving focus; Up/Down move, Left/Right collapse and expand, Enter jumps. Collapsing a row hides its children only in the outline, not in the text.
- It lists nothing while no good association exists, and keeps the last good tree while the text does not compile (rows are not links then: a click does nothing until a compile lands).
- Layered and scenario boards other than the root are not listed (the board picker already switches boards).

## 3. Folding

A fold gutter on the source pane. A fold is a `bodies` range of a shape that has one: it folds from after the `{` to before the `}`, leaving `a: {…}` on the line. Ranges belong to the compile they came from; an edit that touches a fold's lines unfolds it and removes it until the next good compile returns fresh ranges (the spec 0022 §3 freshness rule). Folded state is view state, never saved in the text and never in history. Keyboard: the CodeMirror fold bindings (Ctrl-Shift-[ and ]).

A fold does not hide diagnostics: an error inside a folded range unfolds it.

## 4. Provenance

Where does this value come from? For the selected object the outline row's detail (a disclosure under the current row) lists the properties with `inherited: true`, so a value that arrives from a class, a glob or another declaration is visible. Each line reads `fill: red` with the source's line number; activating it puts the caret on the property's `literal` (or its `source` when there is none) and opens nothing else. A property declared in the object's own declarations is not listed, because that is the common case and needs no note.

This slice does not classify the origin ("class kit", "glob") because the association does not say which; the line number and the jump are what D2 gives. Whether D2's IR can name the class or glob without a second parse is the one thing to check in step 1 below; if it can, it is a separate additive field and spec, not this one.

## 5. Order of work

1. Go: `inherited` (a class-supplied, a glob-supplied and an own value, a dotted own value, a connection) and `bodies` from D2's AST in `compile/association.go`, with a test for single and multiple declarations, nested maps, single-line maps (none), UTF-16 offsets after an emoji and a key naming several objects (only the last gets the map). A file with a syntax error has no association, so it needs no case. Protocol type and spec 0004 amendment. Origin finding (6 November 2026): the graph's `Scalar` holds only the value and its `MapKey`, with no class or glob name, so naming the origin would need a walk of D2's IR from the worker; not done here.
2. Editor: outline module (pure tree builder with a node unit test, then the DOM), fold service and gutter, provenance list. Chromium tests below.

## 6. Not in this slice

Dragging in the outline to reorder or reparent (a canvas gesture, spec 0015), rename, filter or search, folding of comments or block strings, fold-all commands beyond the CodeMirror defaults, classifying the origin of a value, a minimap, breadcrumbs, imported-file outlines.

## 7. Tests

- Go (`go test ./compile`): see §5.1.
- Unit: the tree builder (nesting by `parent`, connections last, empty label falls back to the id, stable under reordered input).
- Chromium (`mise run test:editor`): the outline lists nested shapes and connections; clicking a row moves the caret and selects on the canvas; the caret moving to another object moves the current row; typing an error keeps the tree but disables its links; arrow keys move and collapse; a multi-line shape folds from the gutter and shows `{…}`; a single-line map has no fold; an edit inside a fold unfolds and removes it until the next compile; an error inside a fold unfolds it; a class-supplied value is listed with its line and jumps to its literal, an own value is not listed; undo history is unchanged by folding and outline use.
- Existing editor tests pass unchanged.

## 8. Open

- Layout: the outline sits in the existing source column above the editor, collapsed by default on narrow screens. The user may prefer another place; the tree builder does not depend on it.
- Bundle growth: report `dist/main.js` before and after (449,681 bytes at the end of slice 3). CodeMirror's `foldGutter` and `foldService` come from `@codemirror/language`, already a dependency, so no new package is expected.
- Is "provenance" as small as §4 intended, or does the user want the origin named (class, glob) at the cost of a worker change?
