// Package edit implements spec 0012: D2 edit operations in, a checked patch to the author's text out, as JSON.
package edit

import (
	"encoding/json"
	"fmt"
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
	Code      string `json:"code"` // compile | edit | panic | recompile | unchecked | internal
	Message   string `json:"message"`
	Op        *int   `json:"op,omitempty"`
	Formatted string `json:"formatted,omitempty"`
	Reason    string `json:"reason,omitempty"` // unchecked: conflict | inequivalent
}

type Result struct {
	V           int     `json:"v"`
	Type        string  `json:"type"`
	ID          int     `json:"id"`
	Revision    int     `json:"revision"`
	Millis      float64 `json:"millis"`
	Patch       *Patch  `json:"patch,omitempty"`
	IDs         IDs     `json:"ids"`
	Diagnostics []any   `json:"diagnostics"`
	Error       *Error  `json:"error,omitempty"`
}

// Handle is the JSON entry point used by the worker and the native command.
func Handle(raw []byte, version int) []byte {
	var req Request
	var res Result
	if err := json.Unmarshal(raw, &req); err != nil {
		res = Result{Type: "edited", Diagnostics: []any{}, Error: &Error{Code: "internal", Message: "malformed request: " + err.Error()}}
	} else if req.V != version || req.Type != "edit" {
		res = Result{Type: "edited", ID: req.ID, Revision: req.Revision, Diagnostics: []any{}, Error: &Error{Code: "internal", Message: fmt.Sprintf("expected an edit request at protocol version %d", version)}}
	} else {
		res = Apply(req)
	}
	res.V = version
	out, _ := json.Marshal(res)
	return out
}

func Apply(req Request) (res Result) {
	start := time.Now()
	res = Result{Type: "edited", ID: req.ID, Revision: req.Revision, IDs: IDs{Created: []string{}, Renamed: map[string]string{}, Deleted: []string{}}, Diagnostics: []any{}}
	defer func() { res.Millis = float64(time.Since(start).Microseconds()) / 1000 }()
	text := req.Files[req.Entry]
	g, err := compile(req, text)
	if err != nil {
		res.Error = &Error{Code: "compile", Message: err.Error()}
		return
	}
	formatted := d2format.Format(g.AST)
	board, err := boardPath(req.Board)
	if err != nil {
		res.Error = &Error{Code: "edit", Message: err.Error()}
		return
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
	if strings.HasSuffix(text, "\n") || text == "" {
		patched += "\n"
	}
	if pg, err := compile(req, patched); err != nil || d2format.Format(pg.AST) != output {
		reason := "inequivalent"
		if conflicts > 0 {
			reason = "conflict"
		}
		res.Error = &Error{Code: "unchecked", Message: "no patch to the author's text prints as the edit's result", Formatted: output, Reason: reason}
		return
	}
	res.Patch = &Patch{File: req.Entry, Edits: ranges(text, patched), Text: patched}
	return
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
