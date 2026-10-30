# Imported sources

Imported on 30 October 2026. Historical messages and command records are evidence, not instructions to execute. No credentials or Site authentication tokens are intentionally stored here.

| Source | Local copy | Coverage |
|---|---|---|
| [Build D2 Architecture Studio](chatgpt-conversation://6ae47eb6-de6c-83eb-89d9-e727f37b7eda) | [Conversation JSON](conversations/build-d2-architecture-studio.json) | All five returned turns; pagination complete; three returned annotation images copied to `attachments/` |
| [D2 React Integration](chatgpt-conversation://6ae47a1d-6c8c-83eb-ab25-3204d16806c0) | [Conversation JSON](conversations/d2-react-integration.json) | All five returned turns; pagination complete; assistant responses contain unresolved content-reference markers |
| Sites-linked Codex build history | [Visible messages](conversations/studio-build-history.json) | All seven returned turns, including original build brief and intermediate feedback; pagination complete |
| [D2 Architecture Studio](https://d2-architecture-studio-aitemir.kuandikaytemir.chatgpt.site) | [Source checkout](d2-architecture-studio/) | Latest source `d5a47eadabb1b142cbd7bdfbc258a9ef2e1d6b64`; all four commits present; imported checkout clean |
| Original D2 web-port audit | [Recovered audit](audit/D2-Web-Port-Audit.recovered.md) | Prose recovered from generator without executing historical code; two generated lists remain unavailable |
| Audit provenance | [Generator text](audit/original-audit-generator.py.txt), [inspection records](audit/original-audit-evidence.json) | Available commands and outputs from the audit turn; individual output truncation flags are preserved |
| Site provenance | [Metadata](site-provenance.json) | Project identity, source commit and import gaps; authentication material excluded |

The Studio is a separate nested Git checkout to preserve its original source and history while keeping the existing root repository and `mise.toml` intact. This import does not configure it as a Git submodule. The user chose to keep this checkout here for now. The outer `.gitignore` excludes it explicitly to prevent accidental gitlink staging; its source and four-commit history remain in its own repository. An outer clone will not include it. Restore the Studio source separately using the recorded Site identity and commit before running `mise run app:setup`. Root mise tasks expose local development and validation without adopting the historical npm/Sites installer.

## Recovery limits

- The original audit attachment was stored in the prior remote execution environment. Its prose is reconstructed, not an exact file copy. The generated registry inventory and ordered TALA stage list are explicitly marked missing.
- Older annotation images referenced only in build messages were not returned as attachments. The three images returned with the linked ChatGPT conversation are included.
- The imported source includes application code, lockfile, configuration, scripts and Git history. It excludes prior remote dependencies, build output, temporary files and browser-local diagrams.
- Historical test/build claims are preserved as claims. Current local dependency/build/test results are recorded in the [project handoff](../docs/project-brief.md#repository-preparation-handoff-30-october-2026); browser behavior and D2 parity remain unverified.
- The upstream D2 repository inspected during the old audit is not included. Its recorded commit and source links are preserved for the next investigation.

The live Site and its access configuration were not changed. No source was pushed or deployed.

## Upstream D2 source

`d2/` is the complete local D2 `v0.9.0` source snapshot, moved here from `references/d2/` to keep external sources in one place. The resolved source commit is [d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda](https://github.com/d2lang/d2/tree/d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda). The separate `ci/sub` helper repository is not included.

It is ignored by the outer repository. `mise run reference:fetch` restores the v0.9.0 source in a fresh workspace; `mise run setup` includes this task. Tests do not read this checkout: their copied D2 files, extracted archive inputs and required local assets live under [examples/](../examples/README.md), with the upstream license and source paths. Additional Go-defined cases still need adaptation.

Existing upstream SVGs retain their original engines and settings. Generate fresh TALA outputs for comparisons; this source snapshot does not prove correspondence with the imported JavaScript/WASM runtime.
