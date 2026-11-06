# Spec 0024: d2editor side bar, no palette, visual editing behind a flag

Status: **accepted** (user, 6 November 2026: "remove the visual editing and have it behind the flag, remove the palette, inspector + outline should be like we have it in the vscode, outline should not move the source editing component"). Amends [spec 0013](0013-d2editor.md), [0014](0014-drag-to-position.md), [0015](0015-palette.md), [0016](0016-drag-past-origin.md) and [0023](0023-source-pane-outline-fold-provenance.md) §8 (the outline's place).
Delivered: delivered 6 November 2026. Limits: the flag is the page's `?visual=1` query only (no stored setting); the Chromium suite ran against the sandbox's Chromium 1243 through a local Playwright config, not `mise run test:editor`. A spec is a short-lived brief: it must end `delivered` (or be marked not delivered); an agent that finds it otherwise tells the user.

## 1. Visual editing is off by default

Without `?visual=1` the canvas selects and pans; nothing on it writes text. Behind the flag, unchanged from specs 0014 to 0019 and 0017 §3.4:

- dragging a shape (position, move into a zone or out, reorder, message order);
- the hover handles and drag-to-connect, the end dots and their retarget;
- the Connect tool (the only control in the header's "Visual editing" group, hidden without the flag);
- the selection toolbar (colours, delete) and double-click label and text editing;
- arrow-key moves of a focused shape.

Selecting (click, Tab, caret link), the selection outline, the inspector, rename and delete in the inspector, the Type picker, undo and redo, and every source-pane feature work without the flag: they edit through the same checked patches. A shared link made with the flag keeps it (`&visual=1`), and a `?script=` link opened with it keeps it after the query is dropped.

## 2. The palette is gone

The header buttons Shape, Markdown, Code, Icon, Zone and the per-class buttons are removed with `entries()` and its placeholder icon. New shapes come from typing, from the inspector's own actions (Add actor, Add note, table and class rows) and, behind the flag, from drag-to-connect. `src/palette.ts` is now `src/targets.ts`: only the drop and connect targeting and `freeKey`, which the flagged gestures and the kinds' actions still use.

## 3. Side bar

The outline leaves the source column and joins the inspector in one side bar on the right (280 px, fixed, so the canvas no longer changes width when a selection appears), as VS Code's side bar does:

- two panes, **Outline** and **Inspector**, each a header (twistie, small capitals) over its own scrolling body; each opens and closes alone and the open outline never takes more than 45% of the bar;
- the outline is a `role="tree"` as in spec 0023, with 22 px rows, indentation by depth, a full-width row highlight for the caret's object and the kind of container dimmed at the right; its provenance disclosure is unchanged;
- the Inspector pane says "Select an object to edit its properties." until something is selected; the Outline pane says "No objects to show." while no good association exists;
- the source column holds only the title, the editor and the status, so opening, closing or filling a pane cannot move the editor.

On narrow screens the side bar stacks under the canvas and the outline starts closed (spec 0023 §8).

## 4. Not here

Persisting the flag or the pane states, a pane resize handle, drag to reorder panes, collapsible inspector sections, a setting in the UI to turn visual editing on.

## 5. Tests

`mise run test:editor`: the drag, handle, connect, toolbar, label and arrow-key tests open the page with `?visual=1`; the palette tests are removed; new tests pin that without the flag nothing on the canvas writes text and the inspector still does, that the flag shows the Connect tool, and that the outline and inspector panes never move the source editor or the canvas. `targets.test.mjs` keeps `freeKey`, `dropTarget` and `connectTarget`.
