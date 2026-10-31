# d2oracle.Rename refuses to rename an edge endpoint inside a layer or scenario

Draft for the user to review and post; nothing has been sent. Found against D2 v0.9.0 (commit d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda); newer releases were not compared.

## Reproduction

```d2
layers: {
  d: {
    a -> b: one
    a -> b: two
  }
}
```

`d2oracle.Rename(g, []string{"d"}, "a", "z")` returns `operation would modify AST outside of given scope`. A node with no edges renames fine in the same layer, and the same rename on the root board succeeds.

## Cause

`Rename` calls `move`, which for a non-root board requires `len(GetWriteableRefs(obj, baseAST)) == len(obj.References)`. `GetWriteableRefs` skips references with `len(ref.MapKey.Edges) != 0`, so every node that is an edge endpoint looks as if some of its references were outside the board. The rewrite loop below that check already handles references inside edge keys.

## Suggested fix

In `move`, test each reference's scope directly instead of using `GetWriteableRefs` (see `d2oracle-board-rename-edge-endpoints.patch`). With it, the delta map is `{"(a -> b)[0]":"(z -> b)[0]","(a -> b)[1]":"(z -> b)[1]","a":"z"}` and `go test ./d2oracle/` passes. No regression test is included; I also did not change the other `GetWriteableRefs` callers (`Set`, `Delete`), whose intent I did not verify.

## Not fixed

If the layer also contains an authored index reference such as `(a -> b)[1].style.stroke: red`, the rename still yields text that does not recompile (`stroke must be style.stroke`). The cause of this second failure is not isolated.
