# 0008. Repository layout: multi-language monorepo

Status: accepted (user, 31 October 2026, agreed in chat).

Context: slice 1 starts product code in TypeScript and Go while about 40 research probes, the conformance corpus and shared helpers sit in `tests/`. Product code must not be tangled with experiments. D2 fixes are carried as opt-in patches ([ADR 0004](0004-edit-wrapper-and-patches.md)).

Decision:
- `packages/d2web`: TypeScript package (host client, painter, protocol). A pnpm workspace member.
- `packages/d2web-wasm`: Go module with the wasm entry and scene encoder, created with slice 1 step 2. Its `go.mod` requires D2 v0.9.0 and uses `replace` to the pinned checkout `imports/d2`, which stays pristine by default; patches apply only through `mise run reference:patch`, so a patched wasm build is always an explicit choice.
- `research/`: probes moved from `tests/research-*` (names lose the `research-` prefix), Playwright specs in `research/browser/`, the earlier React geometry adapter in `research/geometry/`. Inputs stay in `examples/`.
- `tests/`: shared helpers and the corpus/parity machinery. `docs/`, `tasks/`, `imports/` unchanged.
- mise remains the only entry point; gates are `check` (fast), `check:browser`, `check:full`.

Alternatives: keep everything in `tests/` (product and probes mixed); one package for both languages (Go and npm toolchains differ); require D2 from the module proxy with no `replace` (reproducible, but the patch workflow would not apply to product builds).

Consequences: moves are mechanical and verified by `check` and `check:browser`; a package `go.mod` with `replace` needs the checkout, which `mise run setup` already fetches. Adding `d2web-react` or an editor consumer means a new directory under `packages/`.
