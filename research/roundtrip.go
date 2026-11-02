// Diagnostic experiment for the d2editor idea (docs/ideas/d2editor.md): does editing through d2oracle keep the author's text? For each file it
// applies typical editor edits on a fresh graph, prints the AST with d2format (as the transaction probe publishes it) and counts changed lines
// against the original. "format" lines change when the untouched file is only parsed and printed; an edit's damage is what it changes beyond
// the lines the same edit changes in the already formatted file.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing/fstest"

	"github.com/d2lang/d2/d2compiler"
	"github.com/d2lang/d2/d2format"
	"github.com/d2lang/d2/d2graph"
	"github.com/d2lang/d2/d2oracle"
)

type editResult struct {
	Name     string `json:"name"`
	Error    string `json:"error,omitempty"`
	Total    int    `json:"total"`    // lines changed against the original
	EditOnly int    `json:"editOnly"` // lines changed against the formatted original
	Damage   int    `json:"damage"`   // lines changed beyond the edit: total - editOnly
	Comments int    `json:"comments"` // comment lines lost
	// Patch publishing: the edit merged onto the original text instead of the whole formatted file (merge3 below).
	Equivalent bool     `json:"equivalent"`             // the patched text prints exactly as the edit API's result
	Extra      int      `json:"extra"`                  // lines the patch changes beyond the edit's own lines
	Conflicts  int      `json:"conflicts"`              // regions where the formatter and the edit overlap; the edit's text wins there
	Labels     []string `json:"labelChanges,omitempty"` // labels of objects the edit did not target that changed
}

type fileResult struct {
	File     string       `json:"file"`
	Error    string       `json:"error,omitempty"`
	Lines    int          `json:"lines"`
	Format   int          `json:"format"`   // lines changed by parse and print alone
	Examples []string     `json:"examples"` // first few original lines that printing changes
	Edits    []editResult `json:"edits"`
}

func main() {
	var out []fileResult
	for _, path := range os.Args[1:] {
		raw, err := os.ReadFile(path)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		out = append(out, probe(path, string(raw)))
	}
	_ = json.NewEncoder(os.Stdout).Encode(out)
}

func compile(path, text string) (*d2graph.Graph, error) {
	// Imports resolve beside the file; the probe only reads them.
	fs := fstest.MapFS{}
	dir := filepath.Dir(path)
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".d2") {
			data, _ := os.ReadFile(filepath.Join(dir, e.Name()))
			fs[e.Name()] = &fstest.MapFile{Data: data}
		}
	}
	g, _, err := d2compiler.Compile(filepath.Base(path), strings.NewReader(text), &d2compiler.CompileOptions{FS: fs, UTF16Pos: true})
	return g, err
}

func probe(path, text string) fileResult {
	r := fileResult{File: path, Lines: len(lines(text))}
	g, err := compile(path, text)
	if err != nil {
		r.Error = err.Error()
		return r
	}
	formatted := d2format.Format(g.AST)
	r.Format = changed(lines(text), lines(formatted))
	r.Examples = removed(lines(text), lines(formatted), 4)

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
		r.Error = "no leaf shape to edit"
		return r
	}
	value := func(s string) *string { return &s }
	edits := []struct {
		name string
		run  func(*d2graph.Graph) (*d2graph.Graph, error)
	}{
		{"restyle", func(g *d2graph.Graph) (*d2graph.Graph, error) {
			return d2oracle.Set(g, nil, shape+".style.fill", nil, value("#123456"))
		}},
		{"relabel", func(g *d2graph.Graph) (*d2graph.Graph, error) {
			return d2oracle.Set(g, nil, shape, nil, value("probe label"))
		}},
		{"create", func(g *d2graph.Graph) (*d2graph.Graph, error) {
			g, _, err := d2oracle.Create(g, nil, "probe_new")
			return g, err
		}},
		{"connect", func(g *d2graph.Graph) (*d2graph.Graph, error) {
			g, _, err := d2oracle.Create(g, nil, shape+" -> probe_new")
			return g, err
		}},
		{"rename", func(g *d2graph.Graph) (*d2graph.Graph, error) {
			g, _, err := d2oracle.Rename(g, nil, shape, "probe_renamed")
			return g, err
		}},
		{"delete-shape", func(g *d2graph.Graph) (*d2graph.Graph, error) { return d2oracle.Delete(g, nil, shape) }},
		{"delete-edge", func(g *d2graph.Graph) (*d2graph.Graph, error) {
			if edge == "" {
				return nil, fmt.Errorf("no edge")
			}
			return d2oracle.Delete(g, nil, edge)
		}},
		{"class-create", func(g *d2graph.Graph) (*d2graph.Graph, error) {
			return d2oracle.Set(g, nil, "classes.probe_cls.style.fill", nil, value("#abcdef"))
		}},
		{"class-apply", func(g *d2graph.Graph) (*d2graph.Graph, error) {
			g, err := d2oracle.Set(g, nil, "classes.probe_cls.style.fill", nil, value("#abcdef"))
			if err != nil {
				return nil, err
			}
			return d2oracle.Set(g, nil, shape+".class", nil, value("probe_cls"))
		}},
	}
	for _, e := range edits {
		res := editResult{Name: e.name}
		func() {
			defer func() {
				if p := recover(); p != nil {
					res.Error = fmt.Sprint("panic: ", p)
				}
			}()
			fresh, err := compile(path, text)
			if err != nil {
				res.Error = err.Error()
				return
			}
			edited, err := e.run(fresh)
			if err != nil {
				res.Error = err.Error()
				return
			}
			output := d2format.Format(edited.AST)
			if dir := os.Getenv("ROUNDTRIP_OUT"); dir != "" { // inputs for the three-way merge check in roundtrip.test.mjs
				base := filepath.Join(dir, strings.TrimSuffix(filepath.Base(path), ".d2")+"."+e.name)
				_ = os.WriteFile(base+".formatted.d2", []byte(formatted), 0o644)
				_ = os.WriteFile(base+".edited.d2", []byte(output), 0o644)
			}
			res.Total = changed(lines(text), lines(output))
			res.EditOnly = changed(lines(formatted), lines(output))
			res.Damage = res.Total - res.EditOnly
			res.Comments = comments(text) - comments(output)
			patched, conflicts := merge3(lines(formatted), lines(text), lines(output))
			res.Conflicts = conflicts
			res.Extra = max(0, changed(lines(text), patched)-res.EditOnly)
			published := strings.Join(patched, "\n") + "\n"
			if dir := os.Getenv("ROUNDTRIP_OUT"); dir != "" {
				_ = os.WriteFile(filepath.Join(dir, strings.TrimSuffix(filepath.Base(path), ".d2")+"."+e.name+".patched.d2"), []byte(published), 0o644)
			}
			if pg, err := compile(path, published); err == nil {
				res.Equivalent = d2format.Format(pg.AST) == output
				res.Labels = labelChanges(g, pg, shape)
			}
		}()
		r.Edits = append(r.Edits, res)
	}
	return r
}

func lines(s string) []string { return strings.Split(strings.TrimRight(s, "\n"), "\n") }

func comments(s string) int {
	n := 0
	for _, l := range lines(s) {
		if strings.HasPrefix(strings.TrimSpace(l), "#") {
			n++
		}
	}
	return n
}

// labelChanges lists objects present before and after whose label changed, other than the edited shape and the probe's own objects.
func labelChanges(before, after *d2graph.Graph, target string) []string {
	old := map[string]string{}
	for _, o := range before.Objects {
		old[o.AbsID()] = o.Label.Value
	}
	var out []string
	for _, o := range after.Objects {
		id := o.AbsID()
		if prev, ok := old[id]; ok && prev != o.Label.Value && id != target && !strings.HasPrefix(id, "probe_") {
			out = append(out, fmt.Sprintf("%s: %q -> %q", id, prev, o.Label.Value))
		}
	}
	return out
}

// merge3 applies the change base -> theirs onto ours (diff3 over lines). Where ours and theirs both differ from base in one region, the
// author's lines are kept line for line when formatting only respelled them; otherwise theirs wins for that region, which is counted.
func merge3(base, ours, theirs []string) ([]string, int) {
	toOurs, toTheirs := match(base, ours), match(base, theirs)
	var out []string
	conflicts, i, a, b := 0, 0, 0, 0
	for {
		// The next base line kept on both sides is stable; everything before it is one region.
		k := i
		for k < len(base) && (toOurs[k] < 0 || toTheirs[k] < 0) {
			k++
		}
		oe, te := len(ours), len(theirs)
		if k < len(base) {
			oe, te = toOurs[k], toTheirs[k]
		}
		o, t, bs := ours[a:oe], theirs[b:te], base[i:k]
		switch {
		case equal(o, bs):
			out = append(out, t...)
		case equal(t, bs), equal(o, t):
			out = append(out, o...)
		case len(o) == len(bs):
			// Formatting changed these lines one for one: keep the author's spelling of each line the edit kept, take only its new lines.
			kept := map[int]int{}
			for j, at := range match(bs, t) {
				if at >= 0 {
					kept[at] = j
				}
			}
			for at, line := range t {
				if j, ok := kept[at]; ok {
					line = o[j]
				}
				out = append(out, line)
			}
		default:
			out = append(out, t...)
			conflicts++
		}
		if k == len(base) {
			return out, conflicts
		}
		out = append(out, base[k])
		i, a, b = k+1, oe+1, te+1
	}
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// match maps each line of a to the line of b it is kept as (longest common subsequence), or -1.
func match(a, b []string) []int {
	m := make([][]int, len(a)+1)
	for i := range m {
		m[i] = make([]int, len(b)+1)
	}
	for i := len(a) - 1; i >= 0; i-- {
		for j := len(b) - 1; j >= 0; j-- {
			if a[i] == b[j] {
				m[i][j] = m[i+1][j+1] + 1
			} else {
				m[i][j] = max(m[i+1][j], m[i][j+1])
			}
		}
	}
	to := make([]int, len(a))
	for i := range to {
		to[i] = -1
	}
	for i, j := 0, 0; i < len(a) && j < len(b); {
		switch {
		case a[i] == b[j]:
			to[i] = j
			i, j = i+1, j+1
		case m[i+1][j] >= m[i][j+1]:
			i++
		default:
			j++
		}
	}
	return to
}

// lcs marks which lines of a are kept in b.
func lcs(a, b []string) []bool {
	kept := make([]bool, len(a))
	for i, j := range match(a, b) {
		kept[i] = j >= 0
	}
	return kept
}

// changed counts removed plus added lines.
func changed(a, b []string) int {
	k := 0
	for _, kept := range lcs(a, b) {
		if kept {
			k++
		}
	}
	return len(a) + len(b) - 2*k
}

func removed(a, b []string, limit int) []string {
	var out []string
	for i, kept := range lcs(a, b) {
		if !kept && len(out) < limit {
			out = append(out, a[i])
		}
	}
	return out
}
