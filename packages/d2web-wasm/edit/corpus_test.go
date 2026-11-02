package edit

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/d2lang/d2/d2format"
)

// Spec 0012 §8, the corpus gate: the round-trip probe's nine editor edits (research/roundtrip.go) through the product edit API, on every
// examples/files diagram. Every published patch must apply to the author's text, and on files already in d2 fmt form change nothing but the
// edit's own lines. The demo's diagrams stay covered by `mise run test:research:roundtrip`.
func TestCorpusEditsPublishCheckedPatches(t *testing.T) {
	paths, _ := filepath.Glob("../../../examples/files/*.d2")
	if len(paths) < 70 {
		t.Fatalf("%d corpus files", len(paths))
	}
	edited, extra := 0, 0
	var unchecked []string
	for _, path := range paths {
		raw, _ := os.ReadFile(path)
		text := string(raw)
		files := map[string]string{}
		siblings, _ := filepath.Glob(filepath.Join(filepath.Dir(path), "*.d2"))
		for _, s := range siblings {
			b, _ := os.ReadFile(s)
			files[filepath.Base(s)] = string(b)
		}
		entry := filepath.Base(path)
		req := Request{Files: files, Entry: entry}
		g, err := compile(req, text)
		if err != nil {
			continue
		}
		var shape, edge string
		for _, o := range g.Objects {
			if len(o.ChildrenArray) == 0 && o.SQLTable == nil && o.Class == nil {
				shape = o.AbsID()
				break
			}
		}
		if len(g.Edges) > 0 {
			edge = g.Edges[0].AbsID()
		}
		if shape == "" {
			continue
		}
		inFmt := d2format.Format(g.AST) == text
		edits := map[string][]Op{
			"restyle":      {{Op: "set", Key: shape + ".style.fill", Value: str("#123456")}},
			"relabel":      {{Op: "set", Key: shape, Value: str("probe label")}},
			"create":       {{Op: "create", Key: "probe_new"}},
			"connect":      {{Op: "create", Key: "probe_new"}, {Op: "create", Key: shape + " -> probe_new"}},
			"rename":       {{Op: "rename", Key: shape, Name: "probe_renamed"}},
			"delete-shape": {{Op: "delete", Key: shape}},
			"class-create": {{Op: "set", Key: "classes.probe_cls.style.fill", Value: str("#abcdef")}},
			"class-apply":  {{Op: "set", Key: "classes.probe_cls.style.fill", Value: str("#abcdef")}, {Op: "set", Key: shape + ".class", Value: str("probe_cls")}},
		}
		if edge != "" {
			edits["delete-edge"] = []Op{{Op: "delete", Key: edge}}
		}
		for name, ops := range edits {
			req.Ops = ops
			res := Apply(req)
			if res.Error != nil {
				if res.Error.Code != "unchecked" {
					t.Errorf("%s %s: %s %s", entry, name, res.Error.Code, res.Error.Message)
				}
				unchecked = append(unchecked, entry+" "+name+" "+res.Error.Reason+" "+strings.Join(res.Error.Labels, "; "))
				continue
			}
			edited++
			if applyEdits(text, res.Patch.Edits) != res.Patch.Text {
				t.Errorf("%s %s: the ranges do not rebuild the patched text", entry, name)
			}
			// Lines the patch changes in the author's text, against lines the edit changes in the formatted text.
			after, err := compile(req, res.Patch.Text)
			if err != nil {
				t.Errorf("%s %s: patched text does not compile: %v", entry, name, err)
				continue
			}
			beyond := changed(lines(text), lines(res.Patch.Text)) - changed(lines(d2format.Format(g.AST)), lines(d2format.Format(after.AST)))
			if inFmt && beyond != 0 {
				t.Errorf("%s %s: %d lines changed beyond the edit in a d2 fmt file", entry, name, beyond)
			}
			if beyond > 0 {
				extra++
			}
		}
	}
	t.Logf("%d patches published, %d unchecked, %d with lines beyond the edit", edited, len(unchecked), extra)
	if edited < 600 {
		t.Errorf("expected at least 600 published patches, got %d", edited)
	}
	// Recorded 2 November 2026: d2oracle.Set relabelling `start`, whose label comes from a `**: {&label: start; label: ⬤}` glob, rewrites the
	// first glob's filter `&label: end` instead, so `Check PIN.end` loses its ⬤. The label guard refuses it; if this changes, D2 fixed the oracle.
	want := []string{`glob_dimensions.d2 relabel label Check PIN.end: "⬤" -> "end"`}
	if strings.Join(unchecked, "\n") != strings.Join(want, "\n") {
		t.Errorf("unchecked edits:\n%s\nwant:\n%s", strings.Join(unchecked, "\n"), strings.Join(want, "\n"))
	}
}

// changed counts removed plus added lines (as research/roundtrip.go does).
func changed(a, b []string) int {
	kept := 0
	for _, j := range match(a, b) {
		if j >= 0 {
			kept++
		}
	}
	return len(a) + len(b) - 2*kept
}
