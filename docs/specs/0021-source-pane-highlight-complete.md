# Spec 0021: d2editor source pane, syntax highlighting and completion

Status: **accepted** (user, 5 November 2026: "slice 2 yes you can include tokenizer"). Slice 2 of [spec 0020](0020-source-pane.md); [ADR 0016](../adr/0016-source-pane-codemirror.md) §4 (value lists come from the D2 keyword table).
Delivered: delivered 5 November 2026 (built by a Codex worker, reviewed and fixed here): tokenizer, highlighting and completion from the keyword table. Limits: lexical only, no object-name completion; completion reads the whole document per keystroke (about 70 to 100 ms at 20,000 lines). A spec is a short-lived brief: it must end `delivered` (or be marked not delivered); an agent that finds it otherwise tells the user.

## 1. What

1. **Tokenizer and highlighting.** A small hand-written CodeMirror `StreamLanguage` for D2: comments (`#`), quoted strings, block strings (`|md ... |`), keywords from the table (`style`, `shape`, `label`, ...), `->`/`--`/`<-`/`<->` arrows, `:` and braces, and numbers. An unquoted `#` starts a comment, as in D2, so a hex colour is highlighted only as the quoted string D2 requires (`"#rrggbb"`); no separate colour token. Colours come from CSS variables that follow the page theme (light/dark); no new palette beyond what `style.css` defines.
2. **Completion** (`@codemirror/autocomplete`, exact-pinned): after `style.` or inside a `style: {` block, the style keywords the table lists; after `shape:`, `shapes`; after `source-arrowhead`/`target-arrowhead` `shape:`, `arrowheads`; after a boolean keyword's colon, `true`/`false`; after `language:` or a block tag, `languages` (common first). All from `src/keywords.json`, never a hand-written list; a keyword's `only` (shape restriction) hides it when the enclosing shape is known and not listed.
3. Completion is a suggestion only: it inserts text; no edit API call, no second model.

## 2. Not in this slice

Graph-aware completion (object names, classes), snippets, widgets (slice 3), outline and folding (slice 4), `d2lsp` (a hardcoded keyword switch in v0.9.0).

## 3. Tests (`mise run test:editor`, Chromium)

- Comments, strings, keywords and arrows get distinct token classes.
- `shape: ` offers D2's shapes; `style.` offers the style keywords; a boolean value offers true and false.
- Accepting a completion changes the text once and is one `history.ts` step; Escape closes the list.
- Existing 47 editor tests pass unchanged.

## 4. Open questions

- Bundle growth: report `dist/main.js` before and after (400,369 bytes at the end of slice 1).
