package edit

import (
	"encoding/json"
	"github.com/d2lang/d2/d2format"
	"github.com/d2lang/d2/d2parser"
	"strings"
	"testing"
)

func structureOp(t *testing.T, raw string) Op {
	t.Helper()
	var op Op
	if err := json.Unmarshal([]byte(raw), &op); err != nil {
		t.Fatal(err)
	}
	return op
}
func formatted(t *testing.T, text string) string {
	t.Helper()
	ast, err := d2parser.Parse("main.d2", strings.NewReader(text), nil)
	if err != nil {
		t.Fatal(err)
	}
	return d2format.Format(ast)
}
func TestStructurePatches(t *testing.T) {
	for _, tc := range []struct{ name, before, op, after string }{
		{"unset nested keyword", "a: A {label: {near: top-center}}", `{"op":"unset","key":"a.label.near"}`, "a: A"},
		{"unset nested flat keyword", "a: A\na.label.near: top-center", `{"op":"unset","key":"a.label.near"}`, "a: A"},
		{"unset local", "g: {grid-rows: 2; a; b}", `{"op":"unset","key":"g.grid-rows"}`, "g: {a; b}"},
		{"unset flat", "g.grid-columns: 2\ng: {a; b}", `{"op":"unset","key":"g.grid-columns"}`, "g: {a; b}"},
		{"unset repeats", "g: {direction: right; a; b}\ng.direction: down", `{"op":"unset","key":"g.direction"}`, "g: {a; b}"},
		{"unset empty map", "a: {shape: circle}", `{"op":"unset","key":"a.shape"}`, "a"},
		{"unset labelled map", "a: A {shape: circle}", `{"op":"unset","key":"a.shape"}`, "a: A"},
		{"unset only flat", "a.shape: circle", `{"op":"unset","key":"a.shape"}`, "a"},
		{"flat row", "t.shape: sql_table\nt.id: int\nt.id.constraint: unique", `{"op":"row","key":"t","name":"id","type":"text"}`, "t.shape: sql_table\nt.id: text\nt.id.constraint: unique"},
		{"constraint only", "t: {shape: sql_table; id.constraint: unique}", `{"op":"row","key":"t","name":"id","type":"int"}`, "t: {shape: sql_table; id.constraint: unique; id: int}"},
		{"remove flat constraint", "t: {shape: sql_table; id: int; id.constraint: unique}", `{"op":"row","key":"t","name":"id","constraint":null}`, "t: {shape: sql_table; id: int}"},
		{"new flat table row", "t.shape: sql_table", `{"op":"row","key":"t","name":"id","type":"int"}`, "t.shape: sql_table\nt: {id: int}"},
		{"shared row local override", "t\nu\n*: {shape: sql_table; x: int}", `{"op":"row","key":"t","name":"x","type":"text"}`, "t\nu\n*: {shape: sql_table; x: int}\nt: {x: text}"},
		{"plain row", "t: {shape: sql_table; id: int}", `{"op":"row","key":"t","name":"id","type":"text"}`, "t: {shape: sql_table; id: text}"},
		{"inline constraint", "t: {shape: sql_table; id: int {constraint: primary_key}}", `{"op":"row","key":"t","name":"id","type":"text","constraint":"unique"}`, "t: {shape: sql_table; id: text {constraint: unique}}"},
		{"flat constraint", "t: {shape: sql_table; id: int; id.constraint: primary_key}", `{"op":"row","key":"t","name":"id","type":"text","constraint":["unique","not_null"]}`, "t: {shape: sql_table; id: text; id.constraint: [unique; not_null]}"},
		{"remove constraint", "t: {shape: sql_table; id: int {constraint: primary_key}}", `{"op":"row","key":"t","name":"id","constraint":null}`, "t: {shape: sql_table; id: int {}}"},
		{"keep constraint", "t: {shape: sql_table; id: int {constraint: primary_key}}", `{"op":"row","key":"t","name":"id","type":"text"}`, "t: {shape: sql_table; id: text {constraint: primary_key}}"},
		{"new row", "t: {shape: sql_table; id: int}", `{"op":"row","key":"t","name":"other","type":"varchar","constraint":["unique"]}`, "t: {shape: sql_table; id: int; other: varchar {constraint: [unique]}}"},
		{"quoted class", `c: {shape: class; "+run(x int)": bool}`, `{"op":"row","key":"c","name":"+run(x int)","type":"string"}`, `c: {shape: class; "+run(x int)": string}`},
		{"new quoted class", "c: {shape: class}", `{"op":"row","key":"c","name":"+run(x int)","type":"bool"}`, `c: {shape: class; "+run(x int)": bool}`},
		{"delete all", "t: {shape: sql_table; id: int; id.constraint: primary_key; name: text}", `{"op":"row-delete","key":"t","name":"id"}`, "t: {shape: sql_table; name: text}"},
		{"rename all", "t: {shape: sql_table; id: int; id.constraint: primary_key}", `{"op":"row-rename","key":"t","name":"id","to":"number"}`, "t: {shape: sql_table; number: int; number.constraint: primary_key}"},
		{"shapes", "a\nb\nc", `{"op":"reorder","key":"c","before":"a"}`, "c\na\nb"},
		{"end", "a\nb\nc", `{"op":"reorder","key":"a"}`, "b\nc\na"},
		{"grid cells", "g: {grid-columns: 2; a; b; c}", `{"op":"reorder","key":"g.c","before":"g.a"}`, "g: {grid-columns: 2; c; a; b}"},
		{"rows", "t: {shape: sql_table; id: int; name: text}", `{"op":"reorder","key":"t.name","before":"t.id"}`, "t: {shape: sql_table; name: text; id: int}"},
		{"class rows", "c: {shape: class; +a: int; +b: text}", `{"op":"reorder","key":"c.+b","before":"c.+a"}`, "c: {shape: class; +b: text; +a: int}"},
		{"sequence messages", "s: {shape: sequence_diagram; a; b; a -> b: one; b -> a: two}", `{"op":"reorder","key":"s.(b -> a)[0]","before":"s.(a -> b)[0]"}`, "s: {shape: sequence_diagram; a; b; b -> a: two; a -> b: one}"},
		{"indexed edge property", "a\nb\nc\na -> b\n(a -> b)[0].style.stroke: red", `{"op":"reconnect","key":"(a -> b)[0]","dst":"c"}`, "a\nb\nc\na -> c\n(a -> c)[0].style.stroke: red"},
		{"prefixed edge", "c: {a; b; d}\nc.(a -> b): hi", `{"op":"reconnect","key":"c.(a -> b)[0]","dst":"c.d"}`, "c: {a; b; d}\nc.(a -> d): hi"},
		{"parallel retarget", "a\nb\nc\na -> b\na -> b\na -> c\n(a -> b)[1].style.stroke: red", `{"op":"reconnect","key":"(a -> b)[0]","dst":"c"}`, "a\nb\nc\na -> c\na -> b\na -> c\n(a -> b)[0].style.stroke: red"},
		{"source", "a\nb\nc\na -> b: hi {style.stroke: red}", `{"op":"reconnect","key":"(a -> b)[0]","src":"c"}`, "a\nb\nc\nc -> b: hi {style.stroke: red}"},
		{"destination", "a\nb\nc\na -> b", `{"op":"reconnect","key":"(a -> b)[0]","dst":"c"}`, "a\nb\nc\na -> c"},
		{"reverse", "a\nb\na -> b: hi {source-arrowhead: {shape: diamond}; target-arrowhead: {shape: circle}}", `{"op":"reconnect","key":"(a -> b)[0]","reverse":true}`, "a\nb\nb <- a: hi {target-arrowhead: {shape: diamond}; source-arrowhead: {shape: circle}}"},
		{"reverse both", "a\nb\na <-> b", `{"op":"reconnect","key":"(a <-> b)[0]","reverse":true}`, "a\nb\nb <-> a"},
		{"reverse plain", "a\nb\na -- b", `{"op":"reconnect","key":"(a -- b)[0]","reverse":true}`, "a\nb\nb -- a"},
		{"container edge", "c: {a; b; d; a -> b: hi}", `{"op":"reconnect","key":"c.(a -> b)[0]","dst":"c.d"}`, "c: {a; b; d; a -> d: hi}"},
		{"container to root", "x\nc: {a; b; a -> b}", `{"op":"reconnect","key":"c.(a -> b)[0]","dst":"x"}`, "x\nc: {a; b; a -> _.x}"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := formatted(t, tc.before)
			res := apply(t, before, structureOp(t, tc.op))
			if res.Error != nil {
				t.Fatalf("%+v", res.Error)
			}
			if res.Patch == nil {
				t.Fatal("no checked patch")
			}
			if got, want := res.Patch.Text, formatted(t, tc.after); got != want {
				t.Fatalf("got:\n%swant:\n%s", got, want)
			}
			if applyEdits(before, res.Patch.Edits) != res.Patch.Text {
				t.Fatal("ranges do not rebuild text")
			}
			if strings.Contains(tc.op, `"op":"reconnect"`) && len(res.IDs.Renamed) == 0 {
				t.Fatal("missing connection ID mapping")
			}
		})
	}
}
func TestStructureRefusals(t *testing.T) {
	for _, tc := range []struct{ name, text, op string }{
		{"shared edge properties", "a -> b\n(a -> b)[*].style.stroke: red", `{"op":"reconnect","key":"(a -> b)[0]","reverse":true}`},
		{"chain refused", "a -> b -> c", `{"op":"reconnect","key":"(a -> b)[0]","dst":"c"}`},
		{"unset missing", "a", `{"op":"unset","key":"a.shape"}`},
		{"unset nonkeyword", "a: {child}", `{"op":"unset","key":"a.child"}`},
		{"unset style", "a: {style.stroke: red}", `{"op":"unset","key":"a.style.stroke"}`},
		{"unset style map", "a: {style.stroke: red}", `{"op":"unset","key":"a.style"}`},
		{"missing shape", "a", `{"op":"row","key":"missing","name":"x"}`},
		{"not table", "a", `{"op":"row","key":"a","name":"x"}`},
		{"missing row", "t: {shape: sql_table; id: int}", `{"op":"row-delete","key":"t","name":"missing"}`},
		{"class constraint", "c: {shape: class; x: int}", `{"op":"row","key":"c","name":"x","constraint":null}`},
		{"bad constraint", "t: {shape: sql_table; x: int}", `{"op":"row","key":"t","name":"x","constraint":3}`},
		{"name taken", "t: {shape: sql_table; x: int; y: int}", `{"op":"row-rename","key":"t","name":"x","to":"y"}`},
		{"row referenced", "t: {shape: sql_table; id: int}\nu: {shape: sql_table; id: int}\nt.id -> u.id", `{"op":"row-rename","key":"t","name":"id","to":"number"}`},
		{"different parents", "a: {x}\nb: {y}", `{"op":"reorder","key":"a.x","before":"b.y"}`},
		{"different kinds", "a\nb\na -> b", `{"op":"reorder","key":"a","before":"(a -> b)[0]"}`},
		{"missing reorder", "a", `{"op":"reorder","key":"x"}`},
		{"missing endpoint", "a -> b", `{"op":"reconnect","key":"(a -> b)[0]","dst":"x"}`},
		{"keyword endpoint alias", "a -> b", `{"op":"reconnect","key":"(a -> b)[0]","dst":"a.shape"}`},
		{"keyword scope alias", "c: {a -> b}", `{"op":"reconnect","key":"c.shape.(a -> b)[0]","reverse":true}`},
		{"missing edge", "a -> b", `{"op":"reconnect","key":"(b -> a)[0]","reverse":true}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			res := apply(t, tc.text, Op{Op: "set", Key: "a", Value: str("changed")}, structureOp(t, tc.op))
			if res.Error == nil || res.Error.Code != "edit" || res.Error.Op == nil || *res.Error.Op != 1 || res.Patch != nil {
				t.Fatalf("%+v", res)
			}
		})
	}
	for _, raw := range []string{
		`{"op":"unset","key":"t.shape"}`, `{"op":"row","key":"t","name":"x","type":"text"}`, `{"op":"row-delete","key":"t","name":"x"}`, `{"op":"row-rename","key":"t","name":"x","to":"y"}`, `{"op":"reorder","key":"t"}`, `{"op":"reconnect","key":"(a -> b)[0]","reverse":true}`,
	} {
		for _, board := range []string{"", "/layers/l"} {
			req := Request{Entry: "main.d2", Files: map[string]string{"main.d2": "...@shared\nlayers: {l: {t: {shape: sql_table; x: int}; a -> b}}", "shared.d2": "t: {shape: sql_table; x: int}\na -> b"}, Board: board, Ops: []Op{structureOp(t, raw)}}
			res := Apply(req)
			if res.Error == nil || res.Error.Code != "edit" || res.Patch != nil {
				t.Fatalf("board %s op %s: %+v", board, raw, res)
			}
		}
	}
}

func TestReconnectIDs(t *testing.T) {
	res := apply(t, "a\nb\nc\na -> b\na -> b\na -> c\n", structureOp(t, `{"op":"reconnect","key":"(a -> b)[0]","dst":"c"}`))
	if res.Error != nil || res.Patch == nil {
		t.Fatalf("%+v", res)
	}
	for old, want := range map[string]string{"(a -> b)[0]": "(a -> c)[0]", "(a -> b)[1]": "(a -> b)[0]", "(a -> c)[0]": "(a -> c)[1]"} {
		if got := res.IDs.Renamed[old]; got != want {
			t.Errorf("%s -> %s, want %s", old, got, want)
		}
	}
}

func TestStructureImportSpreadRefused(t *testing.T) {
	for _, raw := range []string{`{"op":"row","key":"t","name":"x","type":"text"}`, `{"op":"row-delete","key":"t","name":"x"}`, `{"op":"row-rename","key":"t","name":"x","to":"y"}`, `{"op":"reorder","key":"t.x"}`, `{"op":"unset","key":"t.shape"}`} {
		for _, text := range []string{"t: {shape: sql_table; ...@rows}", "t: @rows; t.shape: sql_table"} {
			res := Apply(Request{Entry: "main.d2", Files: map[string]string{"main.d2": text, "rows.d2": "x: int"}, Ops: []Op{structureOp(t, raw)}})
			if res.Error == nil || res.Error.Code != "edit" || res.Patch != nil {
				t.Fatalf("%s: %+v", raw, res)
			}
		}
	}
}

func TestStructureTransaction(t *testing.T) {
	res := apply(t, formatted(t, "t: {shape: sql_table; id: int; name: text}\ng: {grid-rows: 2; a; b}\na\nb\nc\na -> b"),
		structureOp(t, `{"op":"row","key":"t","name":"id","type":"text","constraint":"unique"}`),
		structureOp(t, `{"op":"row-rename","key":"t","name":"id","to":"number"}`),
		structureOp(t, `{"op":"row-delete","key":"t","name":"name"}`),
		structureOp(t, `{"op":"reorder","key":"g.b","before":"g.a"}`),
		structureOp(t, `{"op":"unset","key":"g.grid-rows"}`),
		structureOp(t, `{"op":"reconnect","key":"(a -> b)[0]","dst":"c"}`),
		structureOp(t, `{"op":"reconnect","key":"(a -> c)[0]","reverse":true}`))
	if res.Error != nil || res.Patch == nil {
		t.Fatalf("%+v", res)
	}
	want := formatted(t, "t: {shape: sql_table; number: text {constraint: unique}}\ng: {b; a}\na\nb\nc\nc <- a")
	if res.Patch.Text != want {
		t.Fatalf("got %s want %s", res.Patch.Text, want)
	}
	if res.IDs.Renamed["(a -> b)[0]"] != "(c <- a)[0]" {
		t.Fatalf("IDs %+v", res.IDs)
	}
}
