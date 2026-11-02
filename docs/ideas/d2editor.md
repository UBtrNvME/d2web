# d2editor: a shared D2 canvas for you and your agents

Status: idea, refined 2 November 2026. Not accepted: [ADR 0007](../adr/0007-product-scope-v1.md) keeps editing out of d2web v1, so building this needs a new ADR from the user. First user: the author, for their own diagrams.

## Problem Statement

How might we let me and my agents edit the same D2 diagram, see each other's changes land in D2's own layout, and talk about them, without ever damaging the D2 text?

## Recommended Direction

One ordered log of D2 edit operations (`d2oracle` set, create, delete, rename, connect), shared by the canvas and by agents connected over a socket or MCP. The editor applies each operation to its own state at once, groups operations over a short window, compiles once, then animates every object from its old box to D2's new one (Web Animations, keyed by D2 ID through the log's rename map), and highlights what changed and who changed it. Comments are attached to objects, carry their source position and follow renames.

Restyles show at once through the painter (d2web paints D2's values); structural edits show a ghost until the compile lands. D2 text is the only persisted state; the log is replayable history on top of it. d2web gains one thing: a transactional edit API in its worker (edit a copy, compile, publish only if valid, never change state on error, recover from `d2oracle` crashes). The editor itself is a new `d2editor` package that consumes d2web.

A palette on the canvas offers common elements, and every palette item is a D2 class: the diagram's own `classes`, plus classes from an imported shared file (read-only in v1). Dropping an item writes `{class: name}`. Where it is dropped decides the D2 meaning: on empty canvas, a top-level object; on a container, a child of it; on a node, a new object connected from that node. Editing a palette item edits the class, so every instance updates, which is D2's own behaviour. "Save selection as palette item" moves an object's inline style into a new class. Items with a picture follow [authoring guide](../d2-authoring-guide.md) rule 18 (`shape: image`, 128x128).

Considered and set aside: text patches as the only edit unit (kept as a fallback channel for agents that prefer writing text), and a canvas-owned scene model (only its instant feedback is kept, for edits that do not change the layout).

## Key Assumptions to Validate

- [x] `d2oracle` edits keep my formatting and comments: **printed whole, only for files already in `d2 fmt` form; published as a checked patch, for all 90 files tested (one blank line in one file), with a guard for one D2 formatter bug.** See the probe results below.
- [ ] Small edits move the layout little: measure each object's displacement per edit on TALA, ELK and dagre.
- [ ] A grouped compile stays under about 500 ms on the editing engine: time ELK and dagre against TALA on the AWS demo (TALA took about 1.5-1.9 s).
- [ ] IDs survive edits: rename and delete-a-parallel-edge sequences keep highlights and comments on the right objects.
- [ ] Classes from an imported file appear in the association with their source, so the palette can show where each item comes from.
- [ ] Drop targets map cleanly to a parent or a connection; decide what dropping between two nodes or onto a connection means, or disallow it.
- [ ] An agent can drive it: a minimal MCP tool (list objects, list palette, apply operations, read and write comments) edits the AWS demo end to end.

## MVP Scope

In: one diagram file; one human plus agents; inspect and restyle with "where does this value come from"; add, connect, delete, rename; the palette of document classes plus read-only imported classes, with drop-to-create, drop-into-container, drop-onto-node-to-connect and save-selection-as-item; grouped compile; layout snap animation; change highlights with author; comments on objects; an agent connection; a round-trip check on every save.

## Not Doing (and Why)

- Free drag-to-position: D2 owns layout; fighting it breaks round-trip and the engine choice.
- Two humans editing at once (CRDT): one ordered log is enough for me plus agents.
- Editing imported files and multi-file workspaces, including the shared palette file: the edit API has no evidence there yet; the shared palette is read-only.
- Palette items that are whole sub-diagrams or templates: D2 has no single construct for them short of an import, which needs its own design.
- Palette defaults D2 cannot express: every item must be a D2 class.
- Accounts, sharing and hosting: personal tool first.
- A React rewrite of the painter: d2web's native DOM is the canvas; React can come later as a binding.
- Growing the imported Studio: d2editor is a clean consumer, as ADR 0007 planned.

## Open Questions

- Does an edit that reformats the file count as damage, or only one that changes meaning? The probe shows 10 of 90 files would be reformatted and one formatter bug changes labels; the patch approach avoids both, if its conflicts can be resolved.
- Edit on ELK or dagre and render the final picture on TALA, or always TALA?
- Agent protocol: MCP tools, a WebSocket operation stream, or both?
- Where do comments live: in the D2 file as D2 comments, in a sidecar file, or only in the session?
- How are dropped objects named (`svc_1`, or ask for a label right after the drop)?
- Should the palette also offer D2's built-in shapes (cylinder, person, ...) as fixed items?

## Probe results: does editing keep the text? (2 November 2026)

`mise run test:research:roundtrip` (`research/roundtrip.go`) applies nine editor edits (restyle, relabel, create, connect, rename, delete a shape, delete an edge, create a class, create and apply a class) through `d2oracle` to a fresh graph for each of 96 files (the 17 demo diagrams and 79 `examples/files`), prints the AST with `d2format` as d2web's transaction probe does, and counts changed lines. 90 files were editable (6 have no plain leaf shape); 28 edge deletions had no edge to delete. No edit errored or panicked.

- **80 of 90 files: every edit changes only its own lines** (median 1-3 lines, at most 17 for deleting a shape with its connections). Comments are kept. These files are already in `d2 fmt` form.
- **10 of 90 files: the first edit, whatever it is, reformats the whole file** (up to 271 lines in `mocha_soc.d2`), because the edit API prints the whole file. Changes: indentation normalised (including inside markdown/code block strings), `{ class: x }` to `{class: x}`, `a -> b {` to `a -> b: {`, double blank lines removed, `|` to `|md`. Three demo diagrams are among them (`Animated, links and tooltips`, `Layers (boards)`, `Markdown, code, LaTeX`).
- **A D2 formatter bug changes meaning:** `d2format` lowercases labels that spell a keyword. `testing: Scenarios` prints as `testing: scenarios`, `x: Layers` as `x: layers`, `STEPS` as `steps`, and the rendered label changes with it (checked with the `d2` CLI). Any edit to such a file renames those labels on the canvas. Upstream D2 issue not filed.
- **Merging the edit onto the original text instead** (three-way: formatted original, edited output, your original; `git merge-file`) on the 10 reformatted files: 61 of 89 edits merge cleanly, change only the edited lines, and print to exactly the edit API's result. 28 conflict, always where the edit touches a line the formatter also rewrote (mostly in files of 3-10 lines). None produced a different meaning.

What this means for the direction: round-trip without damage is reachable, but not by publishing `d2format` output. The edit API should publish a **patch to the author's text**: run the `d2oracle` edit, take the change between the formatted original and the edited result, apply it to the original, and accept it only if the patched text formats to the edit API's result (the check used above). On a conflict, fall back to a smaller unit (an AST-range splice of the edited declaration) or ask before reformatting. The keyword-lowercasing bug needs a guard either way: refuse or warn when a patch would touch a keyword-spelled label, and report it upstream.

## Probe results: publishing edits as patches (2 November 2026)

The same task now also publishes every edit as a patch to the author's text (`merge3` in `research/roundtrip.go`, plain Go, no `git`, so it can run in the worker): a three-way merge with the formatted original as base, the author's text as ours and the edit API's printed result as theirs. Where formatting and the edit touch the same region, the author's spelling of each line the edit kept is preserved line for line when formatting only respelled those lines; only otherwise does the edit's text win for that region. Every published patch is checked two ways: it must print exactly as the edit API's result (equivalence), and no label the edit did not target may change (the label guard).

- **782 of 782 edits are equivalent.** On the 80 files in `d2 fmt` form, all 693 patches change only the edit's own lines.
- **On the 10 reformatted files, the reformatting disappears.** The only leftover is one blank line, in the demo's `Layers (boards)` example, where `d2 fmt` adds a blank line right beside every edit (9 edits, 1 line each).
- A first version took the edit's text for a whole overlapping region; on `mocha_soc.d2` that mixed two indentations inside a markdown block, which would have changed its content. The equivalence check rejected it, and the line-for-line rule fixed it. Equivalence must stay a hard gate.
- **Keyword labels:** in a fixture with `testing: Scenarios { a }`, eight of nine edits keep `Scenarios`. Deleting `a` rewrites the `testing:` line itself, so D2's printer writes `scenarios`; the label guard reports `"Scenarios" -> "scenarios"`. The editor must refuse or ask in that case (or repair the spelling), until D2's formatter is fixed.
- Relabel edits can change several labels at once when the label is set by a glob or a shared declaration: that is D2's ownership semantics through `d2oracle`, not text damage, and the editor should show it as one change to the owning declaration.

Design consequence for the d2web edit API: compile, run the `d2oracle` edit on a disposable graph, merge the printed result onto the author's text, accept only an equivalent patch that passes the label guard, otherwise return the formatted alternative for the user to approve. Publish the patch (text ranges), not the whole file, so the editor and agents see minimal changes.

## Next steps

1. ~~The formatting probe~~ and ~~patch publishing~~ done (above).
2. An ADR from the user lifting "editing is v2".
3. A spec for the d2web transactional edit API: operations in, a checked patch out (equivalence gate, label guard, crash recovery, stale-revision rejection), multi-board paths.
4. Report the keyword-lowercasing formatter bug to D2 upstream.
2. An ADR from the user lifting "editing is v2", if the probe holds.
3. A spec for the d2web transactional edit API.
