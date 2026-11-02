# Spec 0013: d2editor, first slice (canvas editing on GitHub Pages)

Status: **accepted** (user, 2 November 2026, with the recommended section 9 answers); **built** 2 November 2026: `mise run check` and `mise run check:browser` pass, including 12 Chromium editor cases (section 10). Not yet deployed: Pages publishes `/editor/` after merge to `main`. Idea: [d2editor](../ideas/d2editor.md). Consumer of the [edit API](0012-edit-api.md) under [ADR 0012](../adr/0012-editing-in-scope.md); a new directory under `packages/` as [ADR 0008](../adr/0008-repository-layout.md) foresees. d2editor is an application; d2web stays a library and gains nothing from this spec.

## 1. Objective

The author edits their own D2 diagram on a canvas in the browser and every change lands in their D2 text as a minimal, checked patch, with D2's own layout. Success: open the page on GitHub Pages, paste or load a `.d2` file, add, connect, restyle, relabel, rename and delete objects by pointer and keyboard, watch objects move to D2's new layout, and download text whose diff against the original is only the edits.

First user: the author. One diagram file, one human. Agents, comments and the palette are later slices (section 8).

## 2. What the page does

- **Two panes:** the D2 source (a plain `<textarea>`, editable by hand) and the canvas (`d2web.mount`). Typing in the source recompiles with d2web's existing latest-wins rule; canvas edits patch the source.
- **Select:** click or Tab to an object (d2web's typed events carry its D2 ID and board). Escape clears. Selection is application state; it never touches the text.
- **Inspector** for the selection: label, fill, stroke, shape (D2's shape list), each a `set` operation; rename (`rename`); delete (`delete`). Values shown are D2's, with "where does this come from" from the association's property sources (spec 0004).
- **Add:** a toolbar "Shape" button creates a top-level object (`create`, D2 picks the key); with a container selected it creates a child. **Connect:** select a source, press "Connect", click the target (`create` with `a -> b`).
- **Each action** is one `client.edit` transaction. On `patch`: replace the text with `patch.text`, highlight the changed ranges in the source pane, compile, `mount.update`. On `unchecked`: a dialog shows the reason, any changed labels and D2's formatted alternative, applied only on "Use formatted text". On any other error: a message names the operation and D2's reason; the text is unchanged.
- **Layout snap:** after the compile, every object still present animates from its old box to D2's new box (Web Animations, keyed by D2 ID through `ids.renamed`; created objects fade in). Honour `prefers-reduced-motion`.
- **Change highlights:** objects created, renamed or targeted by the last edit get a short outline pulse on the canvas.
- **Undo / redo:** a stack of whole texts (spec 0012 §6); Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z; each step is a new revision and recompiles.
- **Files:** open a local `.d2` (file input), download the current text, a short list of example diagrams. The last text is kept in `localStorage` as a convenience (wrapped in try/catch; the page works without it).
- **Boards:** a board picker from the compile result's `available`; edits go to the shown board.

## 3. Package and toolchain

```
packages/d2editor/
  package.json        private, depends on the workspace `d2web`
  src/main.ts         page wiring: panes, selection, inspector, actions
  src/history.ts      undo/redo text stack
  src/snap.ts         old box -> new box animation from two associations
  index.html, style.css
  tests/*.spec.mjs    Playwright, Chromium
```

Native TypeScript and DOM, no framework (ADR 0001; the idea's "not doing": no React rewrite). esbuild bundles `src/main.ts` like the d2web build. mise tasks: `editor` (serve locally), `editor:build` (into `packages/d2editor/dist`), `test:editor` (Playwright, joins `check:browser`). The worker, wasm and `wasm_exec.js` come from d2web's build.

**GitHub Pages:** `pages.yml` adds `packages/d2editor/dist` as `_site/editor/`, so the existing demo stays at `/` and the editor is at `/editor/`. Pages deploys from `main` only, so the editor appears once this work is merged.

## 4. Code style

As `packages/d2web/src`: small modules, plain functions, types from d2web's exports, one-line comments for the why, no classes unless state needs one.

```ts
async function apply(ops: EditOp[]) {
  const before = state.result;
  const r = await client.edit({ revision: state.revision, files: { 'main.d2': state.text }, entry: 'main.d2', board: state.board, ops });
  if (r.patch) return commit(r.patch.text, { highlight: r.patch.edits, ids: r.ids, before });
  if (r.error?.code === 'unchecked') return offerFormatted(r.error);
  if (r.error?.code !== 'stale') showError(r.error!);
}
```

## 5. Testing

Playwright in Chromium against the built page with the real worker (`packages/d2editor/tests`): restyle, relabel, create, connect, rename and delete each change the text by the patch only and repaint; an `unchecked` edit (the keyword-label fixture) shows the dialog and leaves the text unchanged until approved; undo and redo restore exact texts; typing in the source pane and then editing on the canvas uses the newest text; a layer board edit; keyboard-only path (Tab to an object, inspector, Enter). Unit tests (`node --test`) for `history.ts` and the box pairing in `snap.ts`.

## 6. Boundaries

- Always: every text change goes through `client.edit` or the user's own typing; the D2 text is the only document state; failures leave the text as it was.
- Ask first: adding any dependency; free positioning; persisting anything beyond `localStorage`; changes to d2web's public API.
- Never: write the text from a canvas model; add d2web features for the editor's convenience; publish reformatted text without the user's approval.

## 7. Success criteria

1. `mise run editor:build` produces a static site; `test:editor` passes in Chromium; `check` and `check:browser` stay green.
2. Every canvas edit in the tests changes the source only within `patch.edits`.
3. The page works from `/editor/` on GitHub Pages after merge (worker and wasm load from the same origin).
4. Keyboard-only editing works for select, inspector, rename and delete.

## 8. Later slices (not in this spec)

Grouped compile over a short window; shared edit log and agents over MCP or a WebSocket; comments on objects; the palette of D2 classes with drop targets; editing on ELK or dagre and rendering on TALA; multi-file workspaces.

## 9. Open questions

Answered 2 November 2026 with the recommendations: seeds `[1]` while editing and the default when idle; create, then focus rename; a plain textarea; `/editor/` beside the demo.

1. **Engine while editing:** TALA with seeds `[1]` during editing and the default seeds when idle (spec 0001 §3.2), or always the default? Recommended: seeds `[1]` while editing, so each edit lands faster.
2. **New object names:** D2's free key (`probe_new` style, `create` picks it) then an inline rename prompt, or ask for a name first? Recommended: create, then focus the rename field.
3. **Source pane:** a plain `<textarea>` with patch highlights drawn beside it, or a code editor dependency (CodeMirror)? Recommended: textarea now; an editor dependency is an "ask first".
4. **Pages path:** `/editor/` beside the demo, or make the editor the site root and move the demo? Recommended: `/editor/`.

## 10. Implementation and remaining acceptance

The page, checked edit flow, whole-text history, layout snap, files/storage, editing/idle seeds, Pages staging and 12 Chromium acceptance cases are present in `packages/d2editor`. Snap pairing and built-file response checks pass in Node. Gate results are in the [handoff](../../tasks/todo.md#d2editor-handoff-2-november-2026). Browser-verified in Chromium; not deployed until merge.

Differences and open items:

- The accepted continuation deliberately imports `../../d2web/src/index.ts`; there is no new private package/workspace dependency or lockfile change. The root TypeScript configuration already includes the editor. Page wiring remains in `main.ts`, with separate `history.ts` and `snap.ts`.
- Association `properties` now carries a declared `shape` with its source (user: "Yes, add shape", 2 November 2026; spec 0004 amended, `TestShapePropertyAndSource`). The inspector shows it; an undeclared shape shows as D2's default.
- The editor now uses the demo's `spawnWorker()` defaults, resolving dependencies beside the bundle, and the dev server listens on IPv4 and IPv6 loopback. Static dependency responses are tested. The original localhost `importScripts` failure was `localhost` resolving to `::1` while the server listened on `127.0.0.1` only; with both, the page loads its worker and wasm (checked by hand in the browser pane).
- The Pages test assembles the actual demo/editor files into an ignored `_site` directory and serves those files through `page.route`. Keyboard behaviour and the snap are covered by the Chromium cases; a locally listening `_site` server and live Pages are not tested.
- Infinite canvas (user request, 2 November 2026; d2web's mount leaves zoom and pan to the consumer, spec 0002): `src/canvas.ts` moves the host under a clipped viewport with a dot grid. Drag or wheel pans, Ctrl/Cmd+wheel or pinch zooms at the pointer (10%–800%), header buttons and `+`/`-`/Shift+1/Shift+0 zoom, fit and reset; the board is fitted on load, open, example and board switch; a keyboard-focused object is panned into view. A drag never selects. Verify: `canvas.test.mjs` (in `test:unit`) and the canvas case in `editor.spec.mjs`.
- Found by the keyboard case and fixed in d2web's edit API: deleting a file's only object returned a single blank line instead of an empty file (`TestDeletingEverythingLeavesAnEmptyFile`).
