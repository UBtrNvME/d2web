# Spec 0012: edit API (edits published as checked patches)

Status: **accepted** (user, 2 November 2026: "Approve", as drafted; the questions in section 7 stay open). Build in progress: tasks 1-3 of the [plan](../../tasks/todo.md) (edit core, operations, worker message, protocol version 2) are done. Scope set by [ADR 0012](../adr/0012-editing-in-scope.md); mechanism by [ADR 0004](../adr/0004-edit-wrapper-and-patches.md); transport by [spec 0001](0001-compile-protocol.md). Evidence: `test:research:transaction`, `test:research:roundtrip` and the probe results in the [d2editor idea](../ideas/d2editor.md#probe-results-publishing-edits-as-patches-2-november-2026).

## 1. Purpose and non-goals

A consumer sends D2 text and a list of D2 edit operations to the worker and receives either a **patch to its own text** that has passed two checks, or nothing published and a reason, with D2's formatted text offered as an alternative. The consumer owns the text: it applies the patch and then compiles through the existing `compile` request. The edit path never lays out.

Not in this spec: operation logs, rename maps for animation, comments, palettes, change highlights, agent protocols (all `d2editor`, ADR 0012); editing imported files; free positioning; undo beyond what section 6 states; new layout behaviour.

## 2. Participants

Unchanged from spec 0001: the host client owns revisions and the worker's life; the worker serves one request at a time on one wasm thread. The worker keeps **no document state**: every `edit` carries the files, as `compile` does. The live document is the consumer's text, so a failed or crashed edit cannot change it (ADR 0004's copy-on-write rule holds by construction).

## 3. Messages

Protocol version becomes **2** (ADR 0012). Existing messages are unchanged; `ready` gains `edit: true`.

### 3.1 Host to worker: `edit`
```
{ v, type: 'edit', id, revision,
  files: { '<path>': '<text>' },     // as compile; only `entry` may change
  entry: 'main.d2',
  board: '' | '/layers/x' | ...,      // compile result path; default '' (root)
  ops: [ Op, ... ] }                  // 1..256, applied in order as one transaction
```
`revision` is the revision of the text in `files`, echoed untouched.

**Operations** map one to one onto `d2oracle`; keys are D2 keys exactly as `d2oracle` takes them.

| `op` | Fields | `d2oracle` call | Covers |
| --- | --- | --- | --- |
| `set` | `key`, `value: string \| null`, `tag?` | `Set(g, board, key, tag, value)` | restyle, relabel (`key` with no property), class define (`classes.x.style.fill`) and apply (`x.class`); `null` removes the value |
| `create` | `key` | `Create(g, board, key)` | new shape (`svc`), connection (`a -> b`) |
| `delete` | `key` | `Delete(g, board, key)` | shape with its connections, one connection (`(a -> b)[0]`) |
| `rename` | `key`, `name` | `Rename(g, board, key, name)` | rename an ID; authored index references renumbered |

`create` may return a different key than requested (D2 picks a free one); the result reports it (section 3.2).

### 3.2 Worker to host: `edited`
Success:
```
{ v, type: 'edited', id, revision, millis,
  patch: { file: 'main.d2',
           edits: [ { start, end, text } ],   // UTF-16 offsets into the request's text, ascending, non-overlapping
           text: '<whole patched text>' },    // the same result, so a consumer need not apply edits itself
  ids: { created: ['<key>'], renamed: { '<old>': '<new>' }, deleted: ['<id>'] },   // from the oracle's *IDDeltas calls
  diagnostics: [ ... ] }                      // e.g. 'edit-override' (section 4.4)
```
Failure carries `error` and **no** `patch`:
```
error: { code, message, op?,          // op: index of the failing operation
         formatted?, reason? }        // only when code is 'unchecked'
```

| `code` | Meaning | `formatted` |
| --- | --- | --- |
| `compile` | the text in `files` does not compile before any edit | no |
| `edit` | `d2oracle` refused an operation (invalid value, unwritable reference, missing board, unknown `op`). `delete` of a key that does not exist is a no-op in `d2oracle`, not a refusal, and is passed through as such | no |
| `panic` | `d2oracle` panicked; recovered, the instance stays usable | no |
| `recompile` | the edited text does not compile | no |
| `unchecked` | the edit is valid but no patch passed section 4; `reason` is `conflict`, `inequivalent` or `label` (with the changed labels) | yes: D2's formatted whole file |
| `stale` | raised by the host client, never by the worker (section 5) | no |

`formatted` is offered, never applied: the consumer may show it and, if the user approves, set it as its text. d2web has no "approve" message (ADR 0012 decision 4).

## 4. How a patch is made and checked

For each request, in the worker:
1. Compile `files` with UTF-16 positions (no layout). If the original does not compile, return `compile` with D2's diagnostics, as the `compile` request would.
2. Apply the operations in order to that disposable graph, each under `recover()`. Any failure stops the transaction; nothing is published.
3. Print the edited AST with `d2format` (**the edit API's result**) and compile it; failure is `recompile`.
4. Three-way merge, line based: base is `d2format` of the original, ours is the author's text, theirs is the edit API's result. Where formatting and the edit touch the same region, keep the author's spelling of each line the edit only respelled; otherwise the edit's text wins for that region (`merge3` in `research/roundtrip.go`, plain Go, no `git`).
5. **Equivalence gate:** `d2format` of the patched text must equal the edit API's result byte for byte.
6. **Label guard:** compile the patched text; every object present before and after must keep its label, unless an operation's key names that object's label (section 7, question 1).
7. Both pass: publish `patch` (minimal UTF-16 ranges from the line diff of author's text against patched text). Either fails: `unchecked` with `formatted`.

### 4.1 Boards
`board` uses compile result paths. The worker turns it into `d2oracle`'s board path, which names boards only (`/layers/x/scenarios/y` to `['x', 'y']`); `d2oracle` looks each name up among layers, then scenarios, then steps, so a layer and a scenario with the same name under one parent resolve to the layer (D2's behaviour, checked in `d2oracle/get.go`). Layers, scenarios and steps inside the entry are editable. A board defined in an imported file (`layers: { x: @x }`) is editable too, as `d2oracle` does it: the entry's declaration becomes a local override (`x: { ...@x; new_in_x }`), the imported file is untouched, and the result carries the `edit-override` warning (§4.4). Decided by the user 2 November 2026, after the build found that the oracle does not refuse these boards as ADR 0004 recorded.

### 4.2 Positions
All offsets are UTF-16 code units, as association ranges (spec 0004), so they are JS string indices into `files[entry]`.

### 4.3 What is never published
Reformatting the author's text, changes to any file other than `entry`, a patch that failed either gate, partial transactions.

### 4.4 Imported objects
Editing an object declared in an imported file writes a local override into the entry (oracle behaviour). The result carries a `warning` diagnostic, `code: 'edit-override'`, naming the object and the imported file.

## 5. Ordering and stale edits (host client)

- `client.edit(request): Promise<EditResult>` is added beside `compile`. Edits are **never coalesced**: every one is sent, first in first out.
- The client remembers the highest `revision` it has been given in any `compile` or `edit`. An edit whose `revision` is lower is resolved at once with `stale` and not sent; a result whose `revision` is lower than that highest value when it arrives is resolved with `stale` and its patch dropped. A consumer that wants to chain edits sends the next one with the patched text and a new revision.
- An edit runs ahead of a waiting compile but behind a running one on the single worker (TALA can take seconds). The edit does not abort that compile: the consumer's compile of the patched text, a newer revision, supersedes it under the existing respawn policy (spec 0001 §3.4).
- Edits run no layout; their cost is two compiles and two prints of the file.

## 6. Undo

d2web provides no inverse operations. A consumer undoes by restoring an earlier text it kept, as a new revision, and compiling. `ids` lets it keep highlights and comments on the right objects across a rename or delete; mapping them back on undo is the consumer's.

## 7. Open questions

Answered with the build plan (user, 2 November 2026): question 1 as proposed; question 3, `move` stays out until a consumer needs it; question 4, bump to 2 as ADR 0012 says. Questions 2, 5 and 6 stay open.

1. **Label guard and shared declarations.** A relabel through a glob or shared declaration changes several labels at once; that is D2 ownership, not damage. Proposed: an object's label change is allowed when the association says its label's source is the declaration the operation edited. Unverified.
2. **Blank-line noise.** `d2 fmt` adds a blank line beside every edit in one probe file (`Layers (boards)`). Accept as is (equivalent, one line), or strip blank-only additions the author's text did not have?
3. **Move.** `d2oracle.Move` (reparent, `a` into `b.a`) is not listed. Add now, or when a consumer needs drop-into-container?
4. **Protocol version.** ADR 0012 asks for a bump to 2. The change is additive; keep 1 and advertise `edit: true` instead?
5. **A second worker for edits**, so an edit never waits behind TALA. Measure the wait on the AWS demo first.
6. **Keyword labels.** Until D2's formatter is fixed, should the worker repair the spelling (restore the author's casing on the guarded line) instead of returning `unchecked`?

## 8. Build and verification

Code: `packages/d2web-wasm/edit` (operations under recover, `merge3` moved from `research/roundtrip.go`, the two gates), wired into the existing wasm entry; `packages/d2web/src/{protocol,request,client}.ts` (types, validation, `client.edit`, stale rule). The research probes stay as evidence.

| Claim | Check |
| --- | --- |
| Every operation kind publishes a patch that changes only its own lines on a `d2 fmt` file | Go unit tests in `packages/d2web-wasm/edit` |
| Reformatted files publish without their reformatting; equivalence is a hard gate | the 90-file round-trip corpus moved into a product test (782 edits, equivalence required, per-file extra-line counts recorded) |
| Keyword label case returns `unchecked` with `formatted` and the changed label | Go unit test with `testing: Scenarios { a }`, delete `a` |
| A panic is recovered, reported as `panic`, and the next request succeeds | the `d2oracle.Delete` glob-index fixture from `test:research:transaction` |
| Board paths, refused imported boards, `edit-override` warning | `packages/d2web-wasm/tests/protocol.test.mjs`, native and Node/WASM |
| Identical results native, Node/WASM and Chromium WASM | extend `test:wasm` and a Chromium spec in `packages/d2web/tests/browser` |
| Patch offsets are UTF-16 (non-BMP text before the edit) | Go and JS unit tests |
| `stale` at send and at result; edits not coalesced | `client.test.mjs` |

Gates: `mise run check` (Go, unit and Node/WASM tests), `mise run check:browser` (Chromium), `mise run check:full` before handoff.
