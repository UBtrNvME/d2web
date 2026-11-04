---
title: Moving a shape into a zone is refused in four risky cases
author: Aitemir
date: 2026-11-04
standing: true
id: l-17ad5ae8
scope: repo
status: active
src: init-sessions
---

## Watch out
- D2's move helper only rewrites your own file. It can overflow the stack, leave duplicate shapes behind, or break scenarios, so the worker refuses these cases up front.
- In the code: The `move` op in packages/d2web-wasm/edit refuses: a move into itself or a descendant, any declaration in an imported file (including children and connections), a name already in the target, and a key that a scenario or step references. Spec 0012 documents it.

_From past Claude sessions here, Nov 3._
