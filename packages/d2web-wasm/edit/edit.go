// Package edit implements spec 0012: D2 edit operations in, a checked patch to the author's text out, as JSON.
package edit

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"testing/fstest"
	"time"
	"unicode/utf16"

	"github.com/d2lang/d2/d2compiler"
	"github.com/d2lang/d2/d2format"
	"github.com/d2lang/d2/d2graph"
	"github.com/d2lang/d2/d2oracle"
)

type Op struct {
	Op    string  `json:"op"` // set | create | delete | rename
	Key   string  `json:"key"`
	Value *string `json:"value,omitempty"` // set: nil removes the value
	Tag   *string `json:"tag,omitempty"`
	Name  string  `json:"name,omitempty"` // rename
}

type Request struct {
	V        int               `json:"v"`
	Type     string            `json:"type"`
	ID       int               `json:"id"`
	Revision int               `json:"revision"`
	Files    map[string]string `json:"files"`
	Entry    string            `json:"entry"`
	Board    string            `json:"board"` // compile result path: "" is the root
	Ops      []Op              `json:"ops"`
}

// Range replaces [Start, End) of the request's entry text, in UTF-16 code units.
type Range struct {
	Start int    `json:"start"`
	End   int    `json:"end"`
	Text  string `json:"text"`
}

type Patch struct {
	File  string  `json:"file"`
	Edits []Range `json:"edits"`
	Text  string  `json:"text"`
}

type IDs struct {
	Created []string          `json:"created"`
	Renamed map[string]string `json:"renamed"`
	Deleted []string          `json:"deleted"`
}

type Error struct {
	Code      string   `json:"code"` // compile | edit | panic | recompile | unchecked | internal
	Message   string   `json:"message"`
	Op        *int     `json:"op,omitempty"`
	Formatted string   `json:"formatted,omitempty"`
	Reason    string   `json:"reason,omitempty"` // unchecked: conflict | inequivalent | label
	Labels    []string `json:"labels,omitempty"` // unchecked, reason label: `id: "before" -> "after"`
}

// Diagnostic has the shape of spec 0001's; `edit-override` marks an edit that wrote a local override for something an imported file declares.
type Diagnostic struct {
	Severity string `json:"severity"`
	Message  string `json:"message"`
	Board    string `json:"board,omitempty"`
	File     string `json:"file,omitempty"`
	Code     string `json:"code"`
}

type Result struct {
	V           int          `json:"v"`
	Type        string       `json:"type"`
	ID          int          `json:"id"`
	Revision    int          `json:"revision"`
	Millis      float64      `json:"millis"`
	Patch       *Patch       `json:"patch,omitempty"`
	IDs         IDs          `json:"ids"`
	Diagnostics []Diagnostic `json:"diagnostics"`
	Error       *Error       `json:"error,omitempty"`
}

// Handle is the JSON entry point used by the worker and the native command.
func Handle(raw []byte, version int) []byte {
	var req Request
	var res Result
	if err := json.Unmarshal(raw, &req); err != nil {
		res = Result{Type: "edited", Diagnostics: []Diagnostic{}, Error: &Error{Code: "internal", Message: "malformed request: " + err.Error()}}
	} else if req.V != version || req.Type != "edit" {
		res = Result{Type: "edited", ID: req.ID, Revision: req.Revision, Diagnostics: []Diagnostic{}, Error: &Error{Code: "internal", Message: fmt.Sprintf("expected an edit request at protocol version %d", version)}}
	} else {
		res = Apply(req)
	}
	res.V = version
	out, _ := json.Marshal(res)
	return out
}

func Apply(req Request) (res Result) {
	start := time.Now()
	res = Result{Type: "edited", ID: req.ID, Revision: req.Revision, IDs: IDs{Created: []string{}, Renamed: map[string]string{}, Deleted: []string{}}, Diagnostics: []Diagnostic{}}
	defer func() { res.Millis = float64(time.Since(start).Microseconds()) / 1000 }()
	text := req.Files[req.Entry]
	g, err := compile(req, text)
	if err != nil {
		res.Error = &Error{Code: "compile", Message: err.Error()}
		return
	}
	formatted := d2format.Format(g.AST)
	before := labels(g, "", map[string]string{})
	board, err := boardPath(req.Board)
	if err != nil {
		res.Error = &Error{Code: "edit", Message: err.Error()}
		return
	}
	warnings := overrides(g, board, req)
	targeted := map[string]bool{}
	if bg := d2oracle.GetBoardGraph(g, board); bg != nil {
		for _, op := range req.Ops {
			if id, _ := target(bg, op.Key); id != "" {
				targeted[req.Board+" "+id] = true
			}
		}
	}
	for i, op := range req.Ops {
		code, err := run(&g, board, op, &res.IDs)
		if err != nil {
			res.Error = &Error{Code: code, Message: err.Error(), Op: &i}
			return
		}
	}
	output := d2format.Format(g.AST)
	if _, err := compile(req, output); err != nil {
		res.Error = &Error{Code: "recompile", Message: err.Error()}
		return
	}
	merged, conflicts := merge3(lines(formatted), lines(text), lines(output))
	patched := strings.Join(merged, "\n")
	// Keep the author's final newline; an emptied file stays empty rather than becoming one blank line.
	if patched != "" && (strings.HasSuffix(text, "\n") || text == "") {
		patched += "\n"
	}
	pg, err := compile(req, patched)
	if err != nil || d2format.Format(pg.AST) != output {
		reason := "inequivalent"
		if conflicts > 0 {
			reason = "conflict"
		}
		res.Error = &Error{Code: "unchecked", Message: "no patch to the author's text prints as the edit's result", Formatted: output, Reason: reason}
		return
	}
	if changed := guard(before, pg, req.Ops, targeted); len(changed) > 0 {
		res.Error = &Error{Code: "unchecked", Message: "the patch changes labels the operations did not set", Formatted: output, Reason: "label", Labels: changed}
		return
	}
	res.Patch = &Patch{File: req.Entry, Edits: ranges(text, patched), Text: patched}
	res.Diagnostics = append(res.Diagnostics, warnings...)
	return
}

// overrides warns when an edit targets a board, object or connection that only an imported file declares: d2oracle then writes a local override
// into the entry (`x: {...@x; new}`), the imported file is unchanged. Read from the graph before the operations run, since they mutate it.
func overrides(g *d2graph.Graph, board []string, req Request) []Diagnostic {
	bg := d2oracle.GetBoardGraph(g, board)
	if bg == nil {
		return nil
	}
	warn := func(what, file string) Diagnostic {
		return Diagnostic{Severity: "warning", Code: "edit-override", Board: req.Board, File: file,
			Message: fmt.Sprintf("%s is declared in %s; the edit writes a local override into %s", what, file, req.Entry)}
	}
	sorted := func(files map[string]bool) string {
		var names []string
		for f := range files {
			names = append(names, f)
		}
		sort.Strings(names)
		return strings.Join(names, ", ")
	}
	// An imported board's AST is synthesized in the entry; its objects' references still name the file that declares them.
	if len(board) > 0 {
		files := map[string]bool{}
		for _, o := range bg.Objects {
			for _, r := range o.References {
				files[r.Key.Range.Path] = true
			}
		}
		if len(files) > 0 && !files[req.Entry] {
			return []Diagnostic{warn("board "+req.Board, sorted(files))}
		}
	}
	var out []Diagnostic
	seen := map[string]bool{}
	for _, op := range req.Ops {
		id, files := target(bg, op.Key)
		if id == "" || seen[id] || files[req.Entry] {
			continue
		}
		seen[id] = true
		out = append(out, warn(id, sorted(files)))
	}
	return out
}

// target finds the object or connection a key addresses (the longest ID the key starts with) and the files that declare it.
func target(g *d2graph.Graph, key string) (string, map[string]bool) {
	id, files := "", map[string]bool{}
	owns := func(candidate string) bool {
		return len(candidate) > len(id) && (key == candidate || strings.HasPrefix(key, candidate+"."))
	}
	for _, o := range g.Objects {
		if c := o.AbsID(); owns(c) {
			id, files = c, map[string]bool{}
			for _, r := range o.References {
				files[r.Key.Range.Path] = true
			}
		}
	}
	for _, e := range g.Edges {
		if c := e.AbsID(); owns(c) {
			id, files = c, map[string]bool{}
			for _, r := range e.References {
				files[r.Edge.Range.Path] = true
			}
		}
	}
	return id, files
}

// labels maps every object and connection, on every board, to its label, keyed by board path and ID.
func labels(g *d2graph.Graph, board string, out map[string]string) map[string]string {
	for _, o := range g.Objects {
		out[board+" "+o.AbsID()] = o.Label.Value
	}
	for _, e := range g.Edges {
		out[board+" "+e.AbsID()] = e.Label.Value
	}
	for kind, boards := range map[string][]*d2graph.Graph{"layers": g.Layers, "scenarios": g.Scenarios, "steps": g.Steps} {
		for _, b := range boards {
			labels(b, board+"/"+kind+"/"+b.Name, out)
		}
	}
	return out
}

// guard lists labels of objects present before and after that changed to a value no `set` operation wrote, other than the objects the operations
// address (whose label D2 may derive from the edit: a replaced class, a glob filter). A label set through a shared declaration (a class, a
// glob) changes on every object that uses it, to the value the operation wrote, so that is allowed.
// shortcut: matches by value, not by which declaration owns the label; switch to association sources if an unwritten change ever matches a set value.
func guard(before map[string]string, patched *d2graph.Graph, ops []Op, targeted map[string]bool) []string {
	written := map[string]bool{}
	for _, op := range ops {
		if op.Op == "set" && op.Value != nil {
			written[*op.Value] = true
		}
	}
	var out []string
	for id, after := range labels(patched, "", map[string]string{}) {
		if prev, ok := before[id]; ok && prev != after && !written[after] && !targeted[id] {
			out = append(out, fmt.Sprintf("%s: %q -> %q", strings.TrimPrefix(id, " "), prev, after))
		}
	}
	sort.Strings(out)
	return out
}

func compile(req Request, text string) (*d2graph.Graph, error) {
	fs := fstest.MapFS{}
	for path, contents := range req.Files {
		fs[path] = &fstest.MapFile{Data: []byte(contents)}
	}
	g, _, err := d2compiler.Compile(req.Entry, strings.NewReader(text), &d2compiler.CompileOptions{FS: fs, UTF16Pos: true})
	return g, err
}

// run applies one operation; d2oracle does not guard its own nil dereferences, so a panic becomes an error.
func run(g **d2graph.Graph, board []string, op Op, ids *IDs) (code string, err error) {
	defer func() {
		if r := recover(); r != nil {
			code, err = "panic", fmt.Errorf("%v", r)
		}
	}()
	var next *d2graph.Graph
	switch op.Op {
	case "set":
		next, err = d2oracle.Set(*g, board, op.Key, op.Tag, op.Value)
	case "create":
		var key string
		if next, key, err = d2oracle.Create(*g, board, op.Key); err == nil {
			ids.Created = append(ids.Created, key)
		}
	case "rename":
		var deltas map[string]string
		if deltas, err = d2oracle.RenameIDDeltas(*g, board, op.Key, op.Name); err == nil {
			if next, _, err = d2oracle.Rename(*g, board, op.Key, op.Name); err == nil {
				ids.follow(deltas)
			}
		}
	case "delete":
		var deltas map[string]string
		if deltas, err = d2oracle.DeleteIDDeltas(*g, board, op.Key); err == nil {
			if next, err = d2oracle.Delete(*g, board, op.Key); err == nil {
				ids.Deleted = append(ids.Deleted, op.Key)
				ids.follow(deltas)
			}
		}
	default:
		err = fmt.Errorf("unknown operation %q", op.Op)
	}
	if err != nil {
		return "edit", err
	}
	*g = next
	return "", nil
}

// follow records old -> new IDs across the transaction, composing chained renames.
func (ids *IDs) follow(deltas map[string]string) {
	for from, to := range deltas {
		composed := false
		for orig, cur := range ids.Renamed {
			if cur == from {
				ids.Renamed[orig], composed = to, true
			}
		}
		if !composed {
			ids.Renamed[from] = to
		}
	}
}

// boardPath turns a compile result path ("/layers/x/scenarios/y") into d2oracle's, which names boards only (["x", "y"]) and looks each name
// up among layers, then scenarios, then steps.
func boardPath(path string) ([]string, error) {
	if path == "" {
		return nil, nil
	}
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	var names []string
	for i := 0; i < len(parts); i += 2 {
		if i+1 == len(parts) || (parts[i] != "layers" && parts[i] != "scenarios" && parts[i] != "steps") {
			return nil, fmt.Errorf("board path %q is not a compile result path", path)
		}
		names = append(names, parts[i+1])
	}
	return names, nil
}

func lines(s string) []string { return strings.Split(strings.TrimRight(s, "\n"), "\n") }

// ranges turns the line difference between before and after into ascending UTF-16 replacements.
func ranges(before, after string) []Range {
	a, b := strings.SplitAfter(before, "\n"), strings.SplitAfter(after, "\n")
	to := match(a, b)
	offset := make([]int, len(a)+1)
	for i, l := range a {
		offset[i+1] = offset[i] + len(utf16.Encode([]rune(l)))
	}
	out := []Range{}
	i, j := 0, 0
	for i <= len(a) {
		ni, nj := i, j
		for ni < len(a) && to[ni] < 0 {
			ni++
		}
		if ni < len(a) {
			nj = to[ni]
		} else {
			nj = len(b)
		}
		if ni > i || nj > j {
			out = append(out, Range{Start: offset[i], End: offset[ni], Text: strings.Join(b[j:nj], "")})
		}
		i, j = ni+1, nj+1
	}
	return out
}
