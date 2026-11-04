package keywords

import (
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/alecthomas/chroma/v2/lexers"
	"github.com/d2lang/d2/d2ast"
	"github.com/d2lang/d2/d2compiler"
)

const golden = "../../d2editor/src/keywords.json"

func accepts(src string) bool {
	_, _, err := d2compiler.Compile("", strings.NewReader(src), nil)
	return err == nil
}

func decl(k Keyword, value string) string {
	if k.Style {
		return fmt.Sprintf("x: {style.%s: %s}", k.Name, value)
	}
	return fmt.Sprintf("x: {%s: %s}", k.Name, value)
}

// Every keyword D2 reserves has a domain here, and none is invented: an upstream addition fails this test.
func TestCoversEveryReservedKeyword(t *testing.T) {
	want := map[string]bool{}
	for k := range d2ast.SimpleReservedKeywords {
		want[k] = true
	}
	for k := range d2ast.StyleKeywords {
		want[k] = true
	}
	// The arrowhead holders are composite keywords; the rest of the composites are keywords already listed or not fields.
	for _, k := range []string{"source-arrowhead", "target-arrowhead"} {
		if _, ok := d2ast.CompositeReservedKeywords[k]; !ok {
			t.Errorf("%s is no longer a D2 composite keyword", k)
		}
		want[k] = true
	}
	for _, k := range Table().Keywords {
		if !want[k.Name] {
			t.Errorf("%s is not a D2 keyword", k.Name)
		}
		delete(want, k.Name)
	}
	for k := range want {
		t.Errorf("D2 keyword %s has no domain", k)
	}
}

// Each domain is checked against D2's own validator, at and just outside its edges.
func TestDomainsMatchD2(t *testing.T) {
	for _, k := range Table().Keywords {
		d := k.Domain
		switch d.Kind {
		case "number":
			// Only style numbers are validated by D2; half a unit outside each edge must be refused.
			if !k.Style {
				continue
			}
			if d.Min != nil && (!accepts(decl(k, fmt.Sprint(*d.Min))) || accepts(decl(k, fmt.Sprint(*d.Min-0.5)))) {
				t.Errorf("%s: minimum %v", k.Name, *d.Min)
			}
			if d.Max != nil && (!accepts(decl(k, fmt.Sprint(*d.Max))) || accepts(decl(k, fmt.Sprint(*d.Max+0.5)))) {
				t.Errorf("%s: maximum %v", k.Name, *d.Max)
			}
		case "boolean":
			if k.Style && (!accepts(decl(k, "true")) || !accepts(decl(k, "false")) || accepts(decl(k, "maybe"))) {
				t.Errorf("%s: boolean", k.Name)
			}
		case "enum":
			for _, v := range d.Values {
				if k.Style && !accepts(decl(k, v)) {
					t.Errorf("%s: D2 rejects %s", k.Name, v)
				}
			}
			if k.Validated && accepts(decl(k, "no-such-value")) {
				t.Errorf("%s: D2 accepts a value outside the enum", k.Name)
			}
		}
	}
	// Shape restrictions: the compiler accepts a restricted keyword on exactly the listed shapes (Not is checked by the editor test, which compiles the scene).
	for _, k := range Table().Keywords {
		if len(k.Only) == 0 {
			continue
		}
		for _, s := range Table().Shapes {
			icon := ""
			if s == "image" {
				icon = "\nicon: https://example.com/i.svg"
			}
			ok := accepts(fmt.Sprintf("x: {shape: %s%s\nstyle.%s: true}", s, icon, k.Name))
			if want := slices.Contains(k.Only, s); ok != want {
				t.Errorf("%s on %s: D2 accepts %v, table says %v", k.Name, s, ok, want)
			}
		}
	}
	for _, s := range Table().Shapes {
		if !accepts("x: {shape: " + s + "\nicon: https://example.com/i.svg}") { // image needs an icon
			t.Errorf("shape %s", s)
		}
	}
	for _, a := range Table().Arrowheads {
		if !accepts("a -> b: {target-arrowhead: {shape: " + a + "}}") {
			t.Errorf("arrowhead %s", a)
		}
	}
}

// D2 highlights a code block with lexers.Get(tag), so every exported tag must resolve to a real lexer and the common ones must be exported.
func TestLanguagesResolveInD2sHighlighter(t *testing.T) {
	all := map[string]bool{}
	for _, l := range Table().Languages {
		all[l] = true
		if lexers.Get(l) == nil {
			t.Errorf("language %q has no lexer", l)
		}
	}
	for _, l := range Table().Common {
		if !all[l] {
			t.Errorf("common language %q is not exported", l)
		}
	}
	if len(all) < 100 {
		t.Errorf("only %d languages", len(all))
	}
}

// The editor imports a checked-in copy so it needs no fetch; UPDATE=1 rewrites it.
func TestGoldenIsCurrent(t *testing.T) {
	got, err := json.MarshalIndent(Table(), "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	got = append(got, '\n')
	if os.Getenv("UPDATE") != "" {
		if err := os.WriteFile(golden, got, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile(golden)
	if err != nil || string(want) != string(got) {
		t.Fatalf("%s is stale: run UPDATE=1 go test ./keywords", golden)
	}
}
