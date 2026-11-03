# 0012. Editing enters scope: a checked-patch edit API in d2web

Status: accepted (user, 2 November 2026: "Accept", after confirming in chat the scope choices: lift only "editing is v2", edit API only, offer the formatted text on a failed check, one file with its boards).
Delivery: delivered ([spec 0012](../specs/0012-edit-api.md)): set, create, rename, delete, move. "connect" is `create` with an arrow key; there is no separate op. (Audited 4 November 2026.)

Context: [ADR 0007](0007-product-scope-v1.md) made v1 read-only and deferred editing to v2 because oracle patches, undo and stale handling were unresolved. Since then:
- [ADR 0004](0004-edit-wrapper-and-patches.md) settled the mechanism: `d2oracle` edits a disposable compile behind a copy-on-write wrapper, recovers panics and publishes only text that recompiles. 17 requests give identical results in native, Node/WASM and Chromium WASM (`test:research:transaction`).
- The round-trip probes ([d2editor idea](../ideas/d2editor.md#probe-results-publishing-edits-as-patches-2-november-2026), `mise run test:research:roundtrip`) applied nine edit kinds to 90 editable files. Printing the whole file with `d2format` reformats 10 of them and lowercases keyword-spelled labels (a D2 formatter bug). Publishing each edit as a three-way patch onto the author's text gave 782 of 782 edits equivalent to the edit API's result, with one blank line of noise in one file; a label guard caught the keyword case.
- `d2editor`, the design check named in ADR 0007, now has a refined idea that needs an edit API from d2web and nothing else.

Decision:
1. **Editing is in scope for d2web.** This supersedes only ADR 0007's "Editing is v2". Chromium-only verification, the fidelity promise, the generic-embedder first consumer and the non-goals (editor UI, application state, persistence, plugin framework, implicit skins or effects) stand.
2. **d2web owns one thing: a transactional edit API in its worker.** D2 edit operations (the `d2oracle` set: set, create, delete, rename, connect, including classes) go in; a checked patch to the author's text comes out, as text ranges against a stated revision. The operation log, rename map for animation, comments, palette, change highlights and agent protocols belong to a consumer such as `d2editor`.
3. **Edits publish as patches, not as printed files.** This refines ADR 0004: the oracle edit runs as ADR 0004 says, its printed result is merged onto the author's text, and the patch is accepted only if (a) the patched text prints exactly as the edit API's result (equivalence) and (b) no label the edit did not target changes (label guard). Both are hard gates.
4. **A failed check publishes nothing.** The API returns the formatted whole-file alternative and the reason (conflict, inequivalence, guarded label) for the consumer or user to approve. It never publishes reformatted text silently.
5. **One file and its boards.** Layers, scenarios and steps inside the file are editable. Imported files are not rewritten; the local overrides `d2oracle` already writes into the entry file are allowed and reported as such.

Alternatives:
- **Keep v1 read-only** (ADR 0007): the mechanism and round-trip evidence now exist; `d2editor` cannot start without an edit API.
- **Publish `d2format` output** (ADR 0004 as first written): reformats 10 of 90 files and changes keyword-spelled labels.
- **Hand-written source rewriting**: loses D2 semantics (ADR 0004).
- **d2web also owns the log, agent tools or editor state**: couples the library to one application and reverses ADR 0007's non-goals.
- **Multi-file workspaces**: no evidence that the oracle can rewrite imported files; it writes local overrides only.
- **Reject failed patches outright**: leaves the 10 non-formatted files uneditable at their first conflict, with no path for the user to choose reformatting.

Consequences:
- A spec for the edit API follows (operations in, checked patch out, equivalence gate, label guard, crash recovery, stale-revision rejection, board paths, UTF-16 ranges). Undo is the consumer's: it replays inverse operations or restores text through the same API; the spec states which.
- The worker protocol ([spec 0001](../specs/0001-compile-protocol.md)) gains edit messages under a protocol version bump; the read-only surface stays as is.
- Still open from ADR 0004: the `d2oracle.Delete` glob-index panic and the in-board rename refusal (upstream reports drafted, not posted), edits inside imported boards (refused as not found). The keyword-lowercasing bug must be reported upstream; the label guard stays until D2 fixes it.
- ADR 0007's "Editing is v2" is superseded (its status line says so), and [product.md](../product.md) lists editing as v2 in progress.
- Reversed by evidence that patch equivalence fails on real edits, or that the edit API cannot stay free of consumer policy.
