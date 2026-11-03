package edit

import (
	"os"
	"strings"
	"testing"
	"unicode/utf16"
)

func str(s string) *string { return &s }

func apply(t *testing.T, text string, ops ...Op) Result {
	t.Helper()
	return Apply(Request{ID: 1, Revision: 7, Files: map[string]string{"main.d2": text}, Entry: "main.d2", Ops: ops})
}

func TestRestyleChangesOnlyItsOwnLine(t *testing.T) {
	text := "# keep me\na: A\nb: B\na -> b\n"
	res := apply(t, text, Op{Op: "set", Key: "a.style.fill", Value: str("red")})
	if res.Error != nil {
		t.Fatal(res.Error)
	}
	if res.Revision != 7 || res.Type != "edited" {
		t.Fatalf("echo: %+v", res)
	}
	want := "# keep me\na: A {style.fill: red}\nb: B\na -> b\n"
	if res.Patch.Text != want {
		t.Fatalf("got %q", res.Patch.Text)
	}
	if len(res.Patch.Edits) != 1 || applyEdits(text, res.Patch.Edits) != want {
		t.Fatalf("edits %+v", res.Patch.Edits)
	}
}

// mocha_soc.d2 is not in d2 fmt form: printing the whole file would rewrite up to 271 lines (docs/ideas/d2editor.md).
func TestEditKeepsAnUnformattedFile(t *testing.T) {
	raw, err := os.ReadFile("../../../examples/files/mocha_soc.d2")
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	res := apply(t, text, Op{Op: "create", Key: "probe_new"})
	if res.Error != nil {
		t.Fatal(res.Error)
	}
	added := 0
	for _, e := range res.Patch.Edits {
		added += strings.Count(e.Text, "\n")
		if e.End != e.Start {
			t.Fatalf("an insertion replaced author text: %+v", e)
		}
	}
	if added != 1 || applyEdits(text, res.Patch.Edits) != res.Patch.Text {
		t.Fatalf("edits %+v", res.Patch.Edits)
	}
}

func TestOffsetsAreUTF16(t *testing.T) {
	text := "x: \"😀😀\"\na\n"
	res := apply(t, text, Op{Op: "set", Key: "a.style.fill", Value: str("red")})
	if res.Error != nil {
		t.Fatal(res.Error)
	}
	// "x: \"😀😀\"\n" is 10 UTF-16 code units (each emoji is two).
	if e := res.Patch.Edits[0]; e.Start != 10 || e.End != 12 {
		t.Fatalf("edit %+v", e)
	}
}

func TestOperationsAndIDs(t *testing.T) {
	text := "a\nb\na -> b\n"
	res := apply(t, text, Op{Op: "rename", Key: "a", Name: "c"}, Op{Op: "create", Key: "b"}, Op{Op: "delete", Key: "(c -> b)[0]"})
	if res.Error != nil {
		t.Fatal(res.Error)
	}
	if res.IDs.Renamed["a"] != "c" || len(res.IDs.Created) != 1 || res.IDs.Created[0] == "b" {
		t.Fatalf("ids %+v", res.IDs)
	}
	if !strings.Contains(res.Patch.Text, "c\n") || strings.Contains(res.Patch.Text, "->") {
		t.Fatalf("text %q", res.Patch.Text)
	}
}

func TestFailuresPublishNothing(t *testing.T) {
	cases := []struct {
		text string
		ops  []Op
		code string
		op   int
	}{
		{"a -> \n{", []Op{{Op: "create", Key: "b"}}, "compile", -1},
		{"a\n", []Op{{Op: "create", Key: "b"}, {Op: "set", Key: "a.style.opacity", Value: str("2")}}, "edit", 1},
		{"a\n", []Op{{Op: "reconnect", Key: "a"}}, "edit", 0},
		// d2oracle.Delete dereferences nil here unless docs/upstream/d2oracle-delete-glob-index.patch is applied (research/transaction.test.mjs).
		{"x -> y\nx -> y\n(* -> *)[*].style.opacity: 0.8\n", []Op{{Op: "delete", Key: "(x -> y)[0]"}}, "panic", 0},
	}
	for _, c := range cases {
		res := apply(t, c.text, c.ops...)
		if c.code == "panic" && res.Error == nil {
			t.Log("oracle patched: the glob-index delete no longer panics")
			continue
		}
		if res.Patch != nil || res.Error == nil || res.Error.Code != c.code {
			t.Fatalf("%q: %+v %+v", c.text, res.Patch, res.Error)
		}
		if c.op >= 0 && (res.Error.Op == nil || *res.Error.Op != c.op) {
			t.Fatalf("%q: op %v", c.text, res.Error.Op)
		}
	}
	// The instance is not poisoned: the next request succeeds.
	if res := apply(t, "a\n", Op{Op: "create", Key: "b"}); res.Error != nil {
		t.Fatal(res.Error)
	}
}

func applyEdits(text string, edits []Range) string {
	u := toUTF16(text)
	var out []uint16
	at := 0
	for _, e := range edits {
		out = append(append(out, u[at:e.Start]...), toUTF16(e.Text)...)
		at = e.End
	}
	return fromUTF16(append(out, u[at:]...))
}

func toUTF16(s string) []uint16   { return utf16.Encode([]rune(s)) }
func fromUTF16(u []uint16) string { return string(utf16.Decode(u)) }

// d2format lowercases a label that spells a keyword (docs/ideas/d2editor.md): deleting `a` rewrites the `testing:` line and `Scenarios` would
// become `scenarios` on the canvas. The guard refuses the patch and offers D2's formatted text.
func TestLabelGuardRefusesAKeywordLabelChange(t *testing.T) {
	res := apply(t, "testing: Scenarios {\n  a\n}\n", Op{Op: "delete", Key: "testing.a"})
	if res.Patch != nil || res.Error == nil || res.Error.Code != "unchecked" || res.Error.Reason != "label" {
		t.Fatalf("%+v %+v", res.Patch, res.Error)
	}
	if len(res.Error.Labels) != 1 || !strings.Contains(res.Error.Labels[0], `"Scenarios" -> "scenarios"`) || res.Error.Formatted == "" {
		t.Fatalf("%+v", res.Error)
	}
}

// A label owned by a shared declaration changes on every object that uses it: D2's semantics, not damage.
func TestLabelGuardAllowsAnOwnedRelabel(t *testing.T) {
	text := "classes: {c: {label: Old}}\na.class: c\nb.class: c\nd: Keep\n"
	res := apply(t, text, Op{Op: "set", Key: "classes.c.label", Value: str("New")})
	if res.Error != nil {
		t.Fatal(res.Error)
	}
	if !strings.Contains(res.Patch.Text, "label: New") {
		t.Fatalf("%q", res.Patch.Text)
	}
}

func TestNestedBoardPath(t *testing.T) {
	text := "layers: {\n  x: {\n    scenarios: {\n      y: {\n        a\n      }\n    }\n  }\n}\n"
	ops := []Op{{Op: "set", Key: "a.style.fill", Value: str("red")}}
	res := Apply(Request{Files: map[string]string{"main.d2": text}, Entry: "main.d2", Board: "/layers/x/scenarios/y", Ops: ops})
	if res.Error != nil || !strings.Contains(res.Patch.Text, "        a: {style.fill: red}\n") {
		t.Fatalf("%+v %+v", res.Patch, res.Error)
	}
	if res := Apply(Request{Files: map[string]string{"main.d2": text}, Entry: "main.d2", Board: "/layers/x/y", Ops: ops}); res.Error == nil || res.Error.Code != "edit" {
		t.Fatalf("a path without keywords is refused: %+v", res.Error)
	}
}

// ADR 0012 decision 5 and spec 0012 §4.1/§4.4: editing what an imported file declares writes a local override into the entry, with a warning.
func TestImportedBoardsAndObjectsWarn(t *testing.T) {
	read := func(dir string, names ...string) map[string]string {
		files := map[string]string{}
		for _, n := range names {
			raw, err := os.ReadFile("../../../examples/" + dir + "/" + n)
			if err != nil {
				t.Fatal(err)
			}
			files[n] = string(raw)
		}
		return files
	}
	cases := []struct {
		files map[string]string
		board string
		op    Op
		warn  []string // substrings of the one warning, or none
	}{
		{read("boards", "main.d2", "x.d2", "y.d2"), "/layers/x", Op{Op: "create", Key: "new_in_x"}, []string{"/layers/x", "x.d2"}},
		{map[string]string{"main.d2": "s: @shared\n", "shared.d2": "a\n"}, "", Op{Op: "set", Key: "s.a.style.fill", Value: str("red")}, []string{"s.a", "shared.d2"}},
		// imp.a is declared in shared.d2 but also referenced in main.d2 (`imp.a -> imp.b`): the entry already declares it, so no warning.
		{read("research/join/imports", "main.d2", "shared.d2"), "", Op{Op: "set", Key: "imp.a.style.fill", Value: str("red")}, nil},
		{read("research/join/imports", "main.d2", "shared.d2"), "", Op{Op: "set", Key: "x.style.fill", Value: str("red")}, nil},
	}
	for _, c := range cases {
		res := Apply(Request{Files: c.files, Entry: "main.d2", Board: c.board, Ops: []Op{c.op}})
		if res.Error != nil {
			t.Fatalf("%v: %+v", c.op, res.Error)
		}
		if strings.Contains(res.Patch.Text, "meow") || res.Patch.File != "main.d2" {
			t.Fatalf("imported text copied into the entry: %q", res.Patch.Text)
		}
		if len(c.warn) == 0 {
			if len(res.Diagnostics) != 0 {
				t.Fatalf("%v: %+v", c.op, res.Diagnostics)
			}
			continue
		}
		if len(res.Diagnostics) != 1 || res.Diagnostics[0].Code != "edit-override" || res.Diagnostics[0].Severity != "warning" {
			t.Fatalf("%v: %+v", c.op, res.Diagnostics)
		}
		for _, w := range c.warn {
			if !strings.Contains(res.Diagnostics[0].Message, w) {
				t.Fatalf("%v: %q lacks %q", c.op, res.Diagnostics[0].Message, w)
			}
		}
	}
}

// Found by the d2editor keyboard test: deleting the only object left "\n" instead of an empty file.
func TestDeletingEverythingLeavesAnEmptyFile(t *testing.T) {
	res := apply(t, "a: A\n", Op{Op: "delete", Key: "a"})
	if res.Error != nil || res.Patch.Text != "" || applyEdits("a: A\n", res.Patch.Edits) != "" {
		t.Fatalf("%+v %+v", res.Patch, res.Error)
	}
}

func TestMove(t *testing.T) {
	for _, c := range []struct{ name, text, key, parent, want, renamed string }{
		{"into a container rewrites connections", "vpc\na\ndb\na -> db\n", "a", "vpc", "vpc: {\n  a\n}\n\ndb\nvpc.a -> db\n", "a=vpc.a"},
		{"carries descendants", "vpc\nsvc: {a; b; a -> b}\nsvc.a -> db\n", "svc", "vpc", "vpc: {\n  svc: {a; b; a -> b}\n}\n\nvpc.svc.a -> db\n", "svc.a=vpc.svc.a"},
		{"out to the root", "vpc: {a}\ndb\nvpc.a -> db\n", "vpc.a", "", "vpc\ndb\na -> db\na\n", "vpc.a=a"},
		{"clears pins", "vpc\na: {top: 40; left: 60; style.fill: red}\n", "a", "vpc", "vpc: {\n  a: {style.fill: red}\n}\n", "a=vpc.a"},
		{"same parent is a no-op", "vpc: {a}\n", "vpc.a", "vpc", "vpc: {a}\n", ""},
	} {
		t.Run(c.name, func(t *testing.T) {
			res := apply(t, c.text, Op{Op: "move", Key: c.key, Parent: c.parent})
			if res.Error != nil {
				t.Fatal(res.Error)
			}
			if res.Patch.Text != c.want {
				t.Fatalf("got %q", res.Patch.Text)
			}
			if c.renamed != "" {
				from, to, _ := strings.Cut(c.renamed, "=")
				if res.IDs.Renamed[from] != to {
					t.Fatalf("renamed %v", res.IDs.Renamed)
				}
			}
		})
	}
}

func TestMoveRefusals(t *testing.T) {
	files := map[string]string{"shared.d2": "a -> x\n"}
	for _, c := range []struct{ name, text, key, parent, want string }{
		{"into itself", "vpc: {sub}\n", "vpc", "vpc", "into itself"},
		{"into a descendant (d2oracle overflows the stack)", "vpc: {sub}\n", "vpc", "vpc.sub", "into itself"},
		{"imported object", "...@shared\nvpc\n", "a", "vpc", "imported file"},
		{"imported object with a local override", "...@shared\nvpc\na.style.fill: red\n", "a", "vpc", "imported file"},
		{"imported connection to a local object", "...@shared\nvpc\nx\n", "x", "vpc", "imported file"},
		{"imported descendant", "svc: {...@shared}\nsvc.local\nvpc\n", "svc", "vpc", "imported file"},
		{"name collision", "vpc: {a}\na\n", "a", "vpc", "already has a a"},
		{"referenced in a scenario", "vpc\na\nscenarios: {s: {a -> b}}\n", "a", "vpc", "referenced in scenarios/s"},
		{"referenced in a nested step", "vpc\na\nsteps: {1: {b}; 2: {a.style.fill: red}}\n", "a", "vpc", "referenced in steps/2"},
		{"a connection", "a -> b\nvpc\n", "(a -> b)[0]", "vpc", "not a shape key"},
	} {
		t.Run(c.name, func(t *testing.T) {
			f := map[string]string{"main.d2": c.text}
			for k, v := range files {
				f[k] = v
			}
			res := Apply(Request{Files: f, Entry: "main.d2", Ops: []Op{{Op: "move", Key: c.key, Parent: c.parent}}})
			if res.Error == nil || res.Patch != nil || !strings.Contains(res.Error.Message, c.want) {
				t.Fatalf("error %+v patch %+v", res.Error, res.Patch)
			}
		})
	}
}

func TestMoveLeavesLayersAlone(t *testing.T) {
	// Layers do not inherit, so their own `a` is a different object and stays.
	res := apply(t, "vpc\na\nlayers: {l: {a -> b}}\n", Op{Op: "move", Key: "a", Parent: "vpc"})
	if res.Error != nil || !strings.Contains(res.Patch.Text, "layers: {l: {a -> b}}") {
		t.Fatalf("%+v %+v", res.Error, res.Patch)
	}
}
