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
		{"a\n", []Op{{Op: "move", Key: "a"}}, "edit", 0},
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
