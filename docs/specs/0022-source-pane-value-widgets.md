# Spec 0022: d2editor source pane, value popovers

Status: **accepted** (user, 6 November 2026: "go ahead"). Direction chosen by the user the same day: option B (click a value, get its native control in a popover); literals must come from D2 itself with no extra round trips. Slice 3 of [spec 0020](0020-source-pane.md); amends [spec 0004](0004-association.md) (one optional field); builds on [spec 0021](0021-source-pane-highlight-complete.md) and [ADR 0016](../adr/0016-source-pane-codemirror.md) §3 (a widget is a projection of a literal in the source; what it changes is a text edit) and §4 (value lists from the keyword table).
Delivered: delivered 6 November 2026 (Go `literal` field built here; editor side built by a Codex worker, reviewed and verified here). Limits: root board and the entry file only; no widgets while the text does not compile; dist/main.js grew from 442,303 to 449,681 bytes, for the user to accept. Slice 4 (outline, folding, provenance) is not built. A spec is a short-lived brief: it must end `delivered` (or be marked not delivered); an agent that finds it otherwise tells the user.

## 1. Where the literals come from

D2 decides what a value is. The compile that already runs on every edit returns, for each property, the declaration that owns it (`properties[k].source`, the whole `key: value` statement). It gains one optional field, the value's own range from D2's syntax tree:

```
properties[k] = { value, source, literal?: { start: Pos, end: Pos, kind } }
kind = 'bool' | 'number' | 'unquoted' | 'double-quoted' | 'single-quoted'
```

- `literal` is set only when the value is a single-line scalar D2 parsed as one of those kinds, with no substitution (`${...}`), not a block string, and in a file the editor holds. Anything else has no `literal`, so no widget: the worker, not the page, decides.
- Positions are UTF-16 like every association range. Protocol version stays 2 (additive optional field, as spec 0019).
- No new worker call and no extra round trip: widgets use the association of the last good compile, which the page already holds. The slice 2 tokenizer is not consulted; it stays for highlighting and completion only.

Cost of this choice, stated plainly: there are no widgets while the text does not compile. The page keeps the last good ranges, mapped through later edits by CodeMirror, and hides a widget the moment an edit touches its range (see §3).

Property names are D2's own JSON names (`fontSize`, `fontColor`, `strokeWidth`), not the table's keywords (`font-size`); `capabilities.ts` already converts (`property()`), and the widget code reuses it.

## 2. The widget

A value that has a `literal` and whose keyword has a domain in `src/keywords.json` gets a dotted underline (a CodeMirror mark decoration on the literal's range). A `color` value (`fill`, `stroke`, `font-color`) also gets a small swatch before it, the one glyph in the text, because the colour is the information.

Clicking the value, or pressing Cmd/Ctrl-period with the caret in it, opens a native popover (`popover="auto"`, positioned under the value) holding the native control for its domain:

| Domain | Control |
| --- | --- |
| `color` | `<input type="color">` and a hex text field |
| `boolean` | a switch (`<input type="checkbox">`) |
| `enum` | a listbox (`<select size>`) with the table's values |
| `number` | `<input type="range">` with the table's `min` and `max` (step 1, or 0.05 for a 0 to 1 domain) and a number field |

Only keywords with `style: true` get numbers; `top`, `left`, `width` and `height` are the canvas gestures' (spec 0014). Alt-ArrowUp and Alt-ArrowDown at the caret step a number without opening anything; choices keep the slice 2 completion list (Ctrl-Space). If the same literal is the source of more than one object's property (a class or glob), the popover says "Used by N shapes" (counted from the association) so a change is never a surprise.

## 3. Writing back

- A change replaces exactly the `literal` range in the editor and goes through the same path as typing (`setText`), so it compiles, repaints and links to the canvas as typed text does. No `client.edit` call: the range is exact and the edit is a text edit (ADR 0016 §3).
- Keep the author's quoting. A colour is written `"#rrggbb"` (alpha kept if the author had it); a quoted literal stays quoted; an unquoted named colour is replaced by the quoted hex, because an unquoted `#` starts a comment in D2 (learning, 5 November 2026). Numbers and enums are written bare; booleans as `true` or `false`.
- One interaction, one history step: while the popover is open the text changes live but is not recorded; one `history.push` when it closes by a click outside or Enter. Escape restores the original text and records nothing.
- Throttled preview: a live change schedules at most one compile per animation frame; the existing run counter supersedes older ones, so the last good render stays until the newest lands. While that compile is pending the slice 1 canvas link stays off.
- Freshness: ranges belong to a compile. An edit that touches a widget's range (by typing, undo or anything but the widget itself) removes that widget until the next good compile returns fresh ranges.

## 4. Not in this slice

Named-colour pickers and alpha UI, gradients, expressions and vars, scrubbing by dragging, widgets while the text does not compile, layered or scenario boards other than the root, replacing the slice 2 tokenizer with the AST (a later, separate question), outline, folding and provenance (slice 4).

## 5. Tests

- Go (`go test ./compile`): `literal` is set with the right range and kind for bool, number, unquoted, double- and single-quoted values, in maps and dotted keys, with UTF-16 offsets after an emoji; absent for block strings, `${}`, and multi-line values.
- Unit: the writer produces the right replacement text for each kind (quotes kept, named colour to quoted hex, numbers clamped to the table's `min` and `max`).
- Chromium (`mise run test:editor`): the swatch and underline appear on a compiling document and disappear while it does not compile; the popover per domain edits only the value; the canvas repaints; one undo restores the text; Escape mid-change restores it; at most one compile in flight during a slider drag; an edit touching a range removes only that widget; a class-owned value shows "Used by N".
- Existing editor tests pass unchanged.

## 6. Decided and open

- Decided (user, 6 November 2026): the picker is the native `<input type="color">`.
- Decided: a class- or glob-owned value is edited where it is declared; the popover says "Used by N shapes". A per-shape change is a canvas action (inspector or toolbar, `client.edit`), not a source-pane widget.
- Open: bundle growth. Report `dist/main.js` before and after (442,303 bytes at the end of slice 2).
