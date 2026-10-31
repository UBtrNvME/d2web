# d2oracle.Delete panics on a later edge with a glob index reference

Draft for the user to review and post; nothing has been sent. Found against D2 v0.9.0 (commit d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda); the code at the panic site was not compared with newer releases.

## Reproduction

Source:

```d2
x -> y
x -> y
(* -> *)[*].style.opacity: 0.8
```

Call `d2oracle.Delete(g, nil, "(x -> y)[0]")` on the compiled graph. It panics with a nil pointer dereference at `d2oracle/edit.go:1031` (`*ref.MapKey.EdgeIndex.Int--`). Deleting the last edge (`(x -> y)[1]`) works, and so does the same delete without the glob line.

## Cause

When an edge is deleted, later parallel edges have their authored index references decremented. The glob reference `[*]` has `EdgeIndex.Glob` set and `EdgeIndex.Int == nil`, so the decrement dereferences nil.

## Suggested fix

```diff
-							if ref.MapKey.EdgeIndex != nil {
+							if ref.MapKey.EdgeIndex != nil && ref.MapKey.EdgeIndex.Int != nil {
```

With this change the delete returns `x -> y` plus the glob line, and `go test ./d2oracle/` passes. A regression test for the case above is not included.


Applying: `mise run reference:patch` applies this patch to `imports/d2` (HEAD stays v0.9.0); `mise run reference:unpatch` reverts it. Probes only; native TALA renders do not use this source.
