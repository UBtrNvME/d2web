# Spec 0004: association (D2 objects, source ranges and scene nodes)

Status: **proposed**, not accepted. Builds on [spec 0001](0001-compile-protocol.md) (the `association` field of a board is `null` today), [spec 0002](0002-mount-api.md) (events carry a D2 object ID), [ADR 0002](../adr/0002-combined-boundary-and-painter.md) (scene plus a thin association layer keyed by revision, board path and ID) and [ADR 0007](../adr/0007-product-scope-v1.md) (read-only; editing is v2). Evidence: R1 in [research findings](../research-findings.md) (`test:research:identity`, `test:research:join`, `test:research:rich`).

## 1. What it is for

A consumer that gets a click or hover on object `a.b` needs to answer, without parsing IDs or D2 source itself: where in which file is it declared, what are its label and kind, which effective style values does it have and which declaration owns each, which scene nodes paint it, and what are its parents and (for connections) endpoints. The reverse also matters: given a cursor position in a source file, which objects does it belong to. Read-only: the payload describes the compiled board; it never edits.

## 2. Payload

`board.association` replaces `null`:

```
{ objects: [ Object ] }          // shapes in declaration order, then connections
Object = {
  id,                            // D2 absolute ID, e.g. "a.b" or "(a -> b)[0]"
  kind: 'shape' | 'connection',
  parent?: id,                   // containing shape; absent at the root
  label: string,
  content?: 'markdown' | 'code' | 'latex' | 'sql_table' | 'class',   // absent for plain text
  nodes: [ sceneNodeId ],        // every scene node painting this object, listed explicitly
  references: [ Source ],        // declarations that name the object
  properties: { label, fill?, stroke?, ... : { value, source: Source | null } },   // absent = D2 default
  src?: id, dst?: id             // connections only
}
Source = { path, start: Pos, end: Pos }
Pos    = { line, column, offset }  // line 0-based; column and offset in UTF-16 units, so offset is a JS string index
```

Rules:
- The join key is (revision, board path, object `id`), as decided in ADR 0002. A board's association is complete for that board only; imported and layered boards each carry their own.
- `nodes` is computed by the worker from the scene build, not left for consumers to derive by ID prefix. It lists the named scene nodes (`<id>` and `<id>:...`) of the object. Anonymous nodes (empty ID, the plain paint primitives) have no name to list; each belongs to its nearest named ancestor. Every scene node except the helpers `root` and `root:background` is covered by exactly one object (test, section 6). Owner lookup uses the observed `<ownerID>:<suffix>` convention inside the worker, where a test pins it, so consumers do not depend on it.
- `properties` has an entry for `label` and for each D2 style keyword (named as in D2's JSON: `fill`, `strokeWidth`, `fontSize`, `3d`, ...) for which D2 holds a value. The source is the declaration that owns that value, which can be a class, glob or imported-file declaration that is not in `references` (R1 finding). A value D2 holds no declaration for (theme or builder default) is absent from `properties`; `source` is null only if D2 reports no key for a held value.
- Imports: a `Source.path` is the file the declaration lives in, which can differ from the entry file.
- Ranges are D2's, compiled with its UTF-16 position option. In that mode D2's `Byte` field holds the UTF-16 offset (observed 31 October 2026: `a: "😀"; b` puts `b` at column 9, offset 9, not byte 11), so the field is named `offset` here. Diagnostic ranges (spec 0001) come from the same compile and use the same offsets from now on.

## 3. Client helpers (package `d2web`)

Pure functions over a board's `association`, no DOM and no worker:
- `getObject(association, id)` returns the Object or `undefined`.
- `objectsAt(association, { path, line, column })` returns the objects whose references or property sources contain the position, innermost first.
- Mount events (spec 0002) are unchanged; a consumer joins the event's `id` with `getObject`.

## 4. Size and cost

The payload is JSON beside the scene. Measured 31 October 2026 over the 100 boards of the 80 single-file examples: 2.4 MB of association against 26.4 MB of scene, 9.3 % overall (a tiny board can exceed its own scene: worst 105 %). The budget, enforced by `test:wasm`, is 15 % of the scene over that corpus. It is always on in v1.

## 5. What this does not do

- **Identity across edits.** A rename changes the ID, and parallel edges are indexed (`(a -> b)[1]`), so the same ID can name another object in the next revision (R1, join probe). The association is per revision; carrying identity across edits needs source ranges or a caller-supplied mapping and belongs to the v2 editing contract.
- Semantic HTML for markdown or code (the payload says which content role an object has; it does not rebuild structure).
- Animation, images and non-TALA engines beyond what the existing compile already covers.
- Any source rewriting or edit operation.

## 6. Verified, proposed, unknown

| Claim | State | Evidence |
| --- | --- | --- |
| Object and connection IDs match scene nodes; generated nodes are `<owner>:<suffix>` | verified on named cases (not guaranteed by D2) | `test:research:join` |
| Class and glob declarations own property values and are absent from `references` | verified | `test:research:identity` |
| Payload built by the worker, equal in native and Node/WASM | proposed | step 2 test |
| Every scene node belongs to exactly one object on the example corpus | verified, 100 boards from the 80 single-file examples, 0 unowned (31 October 2026) | `test:wasm` |
| Click in Chromium resolves to the declaring source text | proposed | step 5 browser test |
| Property owners (class, glob, import, scenario override) | verified on `examples/research/identity` | `test:wasm` |
| Size on the corpus | measured, 9.3 % of the scene | `test:wasm` |
| `objectsAt` precision when declarations overlap | unknown | step 5 unit tests |
| Behaviour with non-TALA engines, very large boards | unknown | |

## 7. Open questions for the user

1. Ranges as D2's position triple (recommended), or offsets only like diagnostics? Answered yes to the triple; the third member is a UTF-16 `offset`, not a byte (see section 2).
2. Include effective property sources (`properties`) in v1 (recommended; it is the part editors cannot get elsewhere), or only `references`?
3. Always on (recommended), or a request flag `association: false` to skip the cost?
4. Size budget: set after the first measurement and recorded here, unless you want a number now.
