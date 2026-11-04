---
title: "Don't commit or merge on a red or pending check run"
author: Aitemir
date: 2026-11-04
standing: true
id: l-5f15ede4
scope: repo
status: active
src: init-sessions
---

## Watch out
- A task was committed before its check result was read, and it had failed with a timeout. Two PRs were merged while CI was pending, and a later docs check then failed in CI on a clean checkout.
- In the code: Read the `mise run check` log before `git commit`. Wait for `gh pr checks` before merging. test:wasm can hit ETIMEDOUT under parallel load, a known Go/Node WASM hang, so rerun it alone. docs:check must skip dist and artifacts paths.

_From past Claude sessions here, Nov 3._
