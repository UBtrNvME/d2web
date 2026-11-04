# Spec 0019: edit API, structure operations

Status: **accepted** (user, 4 November 2026: all three groups of new ops allowed, in answer to the ask-first rule of [spec 0018](0018-element-kinds.md) §6). Amends [spec 0012](0012-edit-api.md); protocol version stays 2 (additive: an old worker answers `unknown operation`).
Delivered: delivered 4 November 2026 (built by a Codex worker, reviewed and merged here): the six ops, association `rows`, TS types and validation. Limits: root board only. A spec is a short-lived brief: it must end `delivered` (or be marked not delivered); an agent that finds it otherwise tells the user.

## 1. Why

Probed 4 November 2026 against `packages/d2web-wasm/edit` (`rows_probe_test.go`): for `sql_table` and `class` children the oracle's `set` appends a duplicate line instead of editing the row, and `delete` and `rename` do nothing or fail; `d2oracle` has no way to change a connection's endpoints or to reorder declarations. Slices 2 (tables, classes), 4 (grid, sequence) and 5 (retarget, reverse) of spec 0018 need them.

## 2. Operations (all act on the root board or the request's `board`; every op keeps the checked-patch pipeline of spec 0012 §4)

```
{ op: 'row', key, name, type?, constraint? }       // upsert one row of a sql_table or class
{ op: 'row-delete', key, name }
{ op: 'row-rename', key, name, to }
{ op: 'reorder', key, before? }                     // move a declaration within its parent's map
{ op: 'reconnect', key, src?, dst?, reverse? }      // change a connection's endpoints or direction
{ op: 'unset', key }                                // remove a reserved keyword (shape, grid-rows, direction, …)
```

2.1 **`row`.** `key` is the table or class object. The row `name` is edited in place (type replaced, not appended); an absent row is appended. `type` omitted keeps the type; for a `sql_table`, `constraint` sets it (a string, or a list written as D2's array), `null` removes it, omitted keeps it. A `class` row ignores `constraint` (error if given). Written in the form the row already has (`name: type`, `name: type {constraint: x}`, or `name.constraint: x`); a new row is `name: type` and `name: type {constraint: x}` only when a constraint is given. The name is quoted when D2 needs it (`"+run(x int)"`).

2.2 **`row-delete`** removes every declaration of the row (including a separate `name.constraint` line). **`row-rename`** changes the name in every declaration of the row; refused when a connection references the row, or the new name is taken.

2.3 **`reorder`.** `key` addresses an object, a connection (`(a -> b)[0]`) or a row (`table.name` when `table` is a sql_table or class). It moves its first declaration to just before the declaration of `before` (same kind and same parent), or to the end of the parent's map when `before` is absent. Refused when the two do not share a parent, or when either is declared in an imported file. Order is meaningful in D2 for grid cells (their order is the cell order), sequence diagram messages, and rows.

2.4 **`reconnect`.** `key` is a connection id. `src` and `dst` are shape ids (absolute); each given end is replaced. `reverse: true` swaps the ends and the arrowheads' sides (`->` becomes `<-`, `<->` and `--` stay). Refused when the connection is declared in an imported file, when an end does not exist, or when the result would not compile. The reply's `ids.renamed` maps the old connection id to the new one (its endpoints are in the id).

2.5 **`unset`.** Probed 4 November 2026: `delete` of `a.shape`, `g.grid-rows`, `g.grid-columns` or `g.direction` reports success and changes nothing. `unset` removes every declaration of that reserved keyword under its object (`key` is `object.keyword`); only reserved keywords outside `style` are accepted (style keys keep using `delete`). Added with the others (user: new ops allowed).

2.6 **All six** are refused with `code: 'edit'` and the failing op's index when: the key does not exist; the board is not the root board (shortcut: nested boards later); the target is declared in an imported file. They never leave a half-applied edit.

## 3. Testing

- Go (`packages/d2web-wasm/edit`): per op, a table of before/after texts through `Apply`, including in-place edit of each row form, a quoted class member, a constraint list, rename refused with a connection reference, `reorder` of grid cells, rows, shapes and sequence messages, and each reconnect case (retarget source, retarget destination, reverse `->`, reverse `<->`, edge inside a container, refused import). Each result must equal `d2format` of the expected D2 and pass the checked-patch merge (`res.Patch` set, no `unchecked`). The probe in `rows_probe_test.go` is replaced by these.
- Association: `rows` on `sql_table` and `class` objects (§4), tested in `packages/d2web-wasm/compile`.
- TypeScript: the `EditOp` union and request validation accept the five ops and refuse malformed ones (`packages/d2web/tests/request.test.mjs`).
- `mise run check` passes.

## 4. Association rows

`association.objects[i].rows` (additive, spec 0004): for `content: 'sql_table'`, `[{ name, type, constraint?: string[] }]`; for `content: 'class'`, `[{ name, type }]` where `name` is the member as written (`+name`, `+run(x int)`) and `type` its value. In declaration order. Absent for other objects.

## 5. Boundaries

- Always: ops go through the oracle's AST and the checked-patch pipeline; the editor never edits text itself.
- Ask first: nested boards (`layers`, `scenarios`, `steps`) for these ops; any new public client method.
- Never: guess a row form; leave a duplicate declaration.
