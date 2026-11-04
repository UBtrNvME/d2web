package edit

import (
	"strings"
	"testing"
)

// Plan 0018 task 1: the kind-defining writes the editor's Type picker will rely on, pinned against D2 so a D2 upgrade that changes them fails here.
func TestKindWrites(t *testing.T) {
	cases := []struct {
		name string
		text string
		ops  []Op
		want string // substring of the patched text
	}{
		{"label->md keeps style", "a: Hi {style.fill: red}\n", []Op{{Op: "set", Key: "a", Value: str("# Title\n\nbody"), Tag: str("md")}}, "a: |md\n  # Title\n\n  body\n| {style.fill: red}"},
		{"label->code", "a: Hi\n", []Op{{Op: "set", Key: "a", Value: str("print(1)\nprint(2)"), Tag: str("python")}}, "a: |python\n  print(1)\n  print(2)\n|"},
		{"label->latex", "a: Hi\n", []Op{{Op: "set", Key: "a", Value: str("x^2"), Tag: str("latex")}}, "|latex x^2 |"},
		{"md->label", "a: |md\n  # Title\n|\n", []Op{{Op: "set", Key: "a", Value: str("Plain")}}, "a: Plain"},
		{"md->code", "a: |md\n  # Title\n|\n", []Op{{Op: "set", Key: "a", Value: str("x = 1"), Tag: str("python")}}, "|python x = 1 |"},
		{"code language switch", "a: |python\n  x = 1\n|\n", []Op{{Op: "set", Key: "a", Value: str("x = 1"), Tag: str("go")}}, "|go x = 1 |"},
		{"label->table", "a: Users\n", []Op{{Op: "set", Key: "a.shape", Value: str("sql_table")}, {Op: "set", Key: "a.id", Value: str("int")}, {Op: "set", Key: "a.id.constraint", Value: str("primary_key")}}, "id.constraint: primary_key"},
		{"label->class", "a: Users\n", []Op{{Op: "set", Key: "a.shape", Value: str("class")}, {Op: "set", Key: "a.name", Value: str("string")}}, "shape: class"},
		{"text keeps children", "a: Hi\na.b\n", []Op{{Op: "set", Key: "a", Value: str("body"), Tag: str("md")}}, "a.b"},
		{"text leaves the shape keyword", "a: {shape: cylinder}\n", []Op{{Op: "set", Key: "a", Value: str("hi"), Tag: str("md")}}, "shape: cylinder"},
		{"shape reset is an explicit rectangle", "a: {shape: cylinder}\n", []Op{{Op: "set", Key: "a.shape", Value: str("rectangle")}}, "shape: rectangle"},
	}
	for _, c := range cases {
		res := Apply(Request{ID: 1, Files: map[string]string{"main.d2": c.text}, Entry: "main.d2", Ops: c.ops})
		if res.Error != nil {
			t.Errorf("%s: %s: %s", c.name, res.Error.Code, res.Error.Message)
		} else if !strings.Contains(res.Patch.Text, c.want) {
			t.Errorf("%s: want %q in\n%s", c.name, c.want, res.Patch.Text)
		}
	}
}

// Known limits that slice 2 (table and class to other kinds) must design around: the edit API reports success but changes nothing for `delete` of a
// reserved `shape` or a table column, and `set` with no value on `shape` is refused. The Type picker therefore sets `shape: rectangle` explicitly
// and must compare the recompiled kind with the requested one instead of trusting a published patch.
func TestKindDeleteLimits(t *testing.T) {
	text := "a: {shape: sql_table\n  id: int\n}\n"
	for _, key := range []string{"a.shape", "a.id"} {
		res := Apply(Request{ID: 1, Files: map[string]string{"main.d2": text}, Entry: "main.d2", Ops: []Op{{Op: "delete", Key: key}}})
		if res.Error != nil || res.Patch == nil || res.Patch.Text != text {
			t.Errorf("delete %s: expected a silent no-op, got %+v", key, res)
		}
	}
	if res := Apply(Request{ID: 1, Files: map[string]string{"main.d2": text}, Entry: "main.d2", Ops: []Op{{Op: "set", Key: "a.shape"}}}); res.Error == nil {
		t.Error("set shape with no value should be refused")
	}
}
