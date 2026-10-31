# 0004. Edits through a copy-on-write wrapper; oracle fixes as an opt-in patch set

Status: accepted (user, 31 October 2026, after Checkpoint C discussion).

Context: `d2oracle` calls mutate the supplied AST on failure and can panic (`docs/upstream`). The wrapper in `research/transaction.go` edits a disposable compile, recovers panics, and publishes text only if it recompiles. 17 requests give identical results in native, Node/WASM and Chromium WASM. Edits inside layers and scenarios work; imported boards cannot be edited; editing an imported object adds a local override to the entry.

Decision:
- Native editing uses `d2oracle`/`d2format` behind a copy-on-write wrapper: a failed or non-recompiling edit publishes nothing and leaves the live document unchanged.
- Oracle fixes are carried as patches in `docs/upstream/*.patch`, applied to the pinned v0.9.0 checkout on request, and reported upstream; forking is the fallback.

Alternatives: calling the oracle on the live AST (state corruption, panics); hand-written source rewriting (loses D2 semantics); a fork (maintenance and a weaker "same as D2" claim).

Consequences: undo/stale requests, UTF-16 ranges after edits, true imported-file rewrites and one in-board rename bug with authored index references remain open. A patched build is a different artifact from stock D2 and must say so.
