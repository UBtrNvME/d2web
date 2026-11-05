# 0016. d2editor's source pane becomes a CodeMirror 6 editor linked to the canvas

Status: accepted (user, 5 November 2026: "accept")
Delivery: partly delivered (5 November 2026). [Spec 0020](../specs/0020-source-pane.md) slice 1 is built: the CodeMirror view, diagnostics, the caret link and patch decorations. Widgets, completion and syntax highlighting are not built.
Context: ADR 0015 sends everything outside the curated inspector controls to "the source pane". Today that pane is a plain `<textarea id="src">` with a transparent `#marks` overlay for the last patch's ranges. It has no highlighting, no inline diagnostics (errors appear only as `offset N: message` in the status line) and no link to the canvas. The data for a link already exists: association `references` and property `source` ranges (spec 0004), diagnostic `range` in the same UTF-16 offsets, and checked patch ranges (spec 0012). Constraints: [ADR 0009](0009-natural-web-forms.md) (D2 owns semantics), [ADR 0012](0012-editing-in-scope.md) (edits go through the worker), [ADR 0013](0013-editor-traits-from-d2.md) and the keyword-table learning (field lists come from D2, not a hand-written schema), [ADR 0010](0010-web-performance.md) (bundle cost is reviewed).

Decision:
1. **The source pane is a CodeMirror 6 editor**, in `d2editor` only. d2web gains no editor dependency (editor UI is outside library scope).
2. **The text stays the only document state.** `history.ts` keeps whole-text undo; CodeMirror's history extension is not installed, so there is one undo stack. CodeMirror is a view of `state.text`.
3. **Widgets are projections of literals in the source.** Anything a widget changes is a text edit (typed, or a checked patch from `client.edit`); there is no second model.
4. **Value lists come from the D2 keyword table** (`packages/d2web-wasm/keywords`, `src/keywords.json`), never from a hand-written schema or from `d2lsp` completion (a hardcoded switch in v0.9.0).
5. **The link uses the last good association.** While a compile is pending the link is off, so stale ranges never select the wrong shape.

Alternatives:
- **Keep the textarea and add overlays**: no dependency, but diagnostics, caret mapping and widgets all fight the textarea; the overlay hack already exists for one feature.
- **Monaco**: more built in, but heavy, worker-based, and awkward with esbuild's single bundle and the page's own worker.
- **`d2lsp` through WASM for completion**: reuses upstream, but completion is a keyword switch with no graph awareness and duplicates the keyword table.

Consequences:
- One new development dependency set (`@codemirror/state`, `view`, `language`, `commands`), exact versions, in `pnpm-lock.yaml`. Bundle growth is measured and recorded in the spec before acceptance of delivery.
- `#marks` and the textarea's `input`/scroll wiring in `main.ts` are replaced; tests that type into `#src` need updating.
- The canvas stays editable. Whether it becomes read-only is a separate decision; this ADR does not need it, and a later `readonly` flag stays cheap.
- Reversed by: a bundle cost the user rejects, or undo that cannot stay a single stack; the textarea can return since the text is the only state.
