# Spec 0020: d2editor source pane (CodeMirror 6, diagnostics, canvas link)

Status: **accepted** (user, 5 November 2026, with [ADR 0016](../adr/0016-source-pane-codemirror.md)). Builds on [spec 0004](0004-association.md) (ranges), [spec 0012](0012-edit-api.md) (patch ranges) and [spec 0013](0013-d2editor.md) (the page, `history.ts`).
Delivered: slice 1 delivered 5 November 2026 (built by a Codex worker, reviewed and fixed here): the CodeMirror view, diagnostics with hover, the caret link and patch decorations. Limits: root board and the entry file only; no syntax highlighting. Not delivered: later slices (section 2). A spec is a short-lived brief: it must end `delivered` (or be marked not delivered); an agent that finds it otherwise tells the user.

## 1. Slice 1 (this spec)

1. **Replace `<textarea id="src">` with a CodeMirror 6 view.** No history extension; `history.ts` stays the one undo stack, and Cmd/Ctrl-Z routes to it as today. Line endings are preserved as in `main.ts` (textarea normalised CRLF; keep the document's endings until the user types).
2. **Inline diagnostics.** Each `Diagnostic.range` ({start, end}, UTF-16 offsets) becomes an underline with the message on hover. The status line keeps the summary. A diagnostic without a range goes only to the status line.
3. **Canvas link, both ways.**
   - Caret moves: `objectsAt` over the last good association selects the innermost object (no scroll jump on the canvas beyond `camera.reveal`).
   - Canvas selection: the caret moves to `references[0].start` and that range is scrolled into view; it does not steal focus from the canvas.
   - The link is off while a compile is pending or the last compile failed.
4. **Patch highlights** (today's `#marks`) become CodeMirror decorations, same ranges and the same `side` styling.

## 2. Not in slice 1

Syntax highlighting beyond a minimal D2 tokenizer, completion, colour swatches, dropdowns, scrubbing, refactors, ghost previews, multi-file switching (compile takes a single entry file). Each is a later spec; value lists will read the keyword table (ADR 0016 §4).

## 3. Tests (`mise run test:editor`, Chromium)

- A syntax error underlines its range; fixing it clears the underline.
- A caret inside `a.b`'s declaration selects `a.b`; selecting a shape on the canvas puts the caret on its first reference.
- While compiling, a caret move does not change the selection.
- Undo after typing and after a canvas edit uses one stack: type, drag, undo, undo returns the original text.
- Existing editor tests that type into `#src` pass against the new view.

## 4. Open questions

- Bundle growth: measure `dist/main.js` before and after; the user decides if the figure is acceptable (ADR 0010).
- Minimal tokenizer: hand-written stream parser or none in slice 1?
- Pin exact CodeMirror versions at least two weeks old.
